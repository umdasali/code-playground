// The Laravel tab's runtime: real PHP 8.3 compiled to WebAssembly runs a small Laravel-style framework (public/laravel/*.php)
// against the user's project files. The database is a SQLite file copied out of, and back into, the shared MariaDB server.
import type { PHP } from "@php-wasm/universal";
import { DEFAULT_APP_DATABASE, ensureSharedDatabase } from "./shared-maria";
import { LARAVEL_TEMPLATES, templateById } from "./laravel-templates";

const PHP_LOADER_URL = "/php-wasm/php_8_3.js"; // copied from node_modules by scripts/copy-php-wasm.mjs
const FRAMEWORK_FILES = ["support", "http", "database", "model", "schema", "bootstrap", "run"];
const STORAGE_KEY = "pg:laravel:project";

export interface Project { template: string; files: Record<string, string> }
export interface QueryLogEntry { query: string; bindings: unknown[]; time: number; error?: string }
export interface JobResult {
  ok: boolean;
  error?: string;
  file?: string;
  line?: number;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  output?: string;
  queries: QueryLogEntry[];
  logs: { level: string; message: string }[];
  dumps: string[];
  ms: number;
}
export type Status = (message: string) => void;

// ---------- the project (persisted in localStorage) ----------

let project: Project | null = null;

function fromTemplate(id: string): Project {
  const t = templateById(id);
  return { template: t.id, files: { ...t.files } };
}

export function getProject(): Project {
  if (project) return project;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p?.files && typeof p.files === "object") return (project = p);
    }
  } catch { /* fall through to the default template */ }
  return (project = fromTemplate(LARAVEL_TEMPLATES[0].id));
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch { /* storage full or blocked */ }
}

export function setProjectFile(path: string, content: string) {
  const p = getProject();
  p.files[path] = content;
  persist();
}
export function deleteProjectFile(path: string) {
  delete getProject().files[path];
  persist();
}
export function loadTemplate(id: string): Project {
  project = fromTemplate(id);
  persist();
  return project;
}

export function envValue(files: Record<string, string>, key: string): string | undefined {
  const m = files[".env"]?.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
}
export const databaseName = (files: Record<string, string> = getProject().files) => envValue(files, "DB_DATABASE") || DEFAULT_APP_DATABASE;

// ---------- PHP ----------

let phpPromise: Promise<PHP> | null = null;
const written = new Map<string, string>(); // project files currently in PHP's file system

async function bootPhp(status?: Status): Promise<PHP> {
  status?.("Loading PHP (about 18 MB the first time, cached afterwards)…");
  const { PHP: PhpClass, loadPHPRuntime } = await import("@php-wasm/universal");
  const loader = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PHP_LOADER_URL);
  const id = await loadPHPRuntime(loader, { processId: 1 } as never);
  const php = new PhpClass(id);
  status?.("Installing the Laravel-style framework…");
  php.mkdir("/framework");
  await Promise.all(FRAMEWORK_FILES.map(async (f) => {
    const res = await fetch(`/laravel/${f}.php`);
    if (!res.ok) throw new Error(`Could not load the framework file ${f}.php (HTTP ${res.status}).`);
    php.writeFile(`/framework/${f}.php`, await res.text());
  }));
  for (const dir of ["/db", "/tmp"]) if (!php.fileExists(dir)) php.mkdir(dir);
  return php;
}

function getPhp(status?: Status): Promise<PHP> {
  phpPromise ??= bootPhp(status).catch((e) => { phpPromise = null; throw e; });
  return phpPromise;
}

function putFile(php: PHP, vpath: string, content: string) {
  let dir = "";
  for (const part of vpath.split("/").slice(1, -1)) { dir += `/${part}`; if (!php.fileExists(dir)) php.mkdir(dir); }
  php.writeFile(vpath, content);
}

// Make PHP's file system match the project: write what changed, remove what was deleted.
function syncProject(php: PHP, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    if (written.get(path) === content) continue;
    putFile(php, `/${path}`, content);
    written.set(path, content);
  }
  for (const path of [...written.keys()]) {
    if (path in files) continue;
    try { php.unlink(`/${path}`); } catch { /* already gone */ }
    written.delete(path);
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// Jobs run one at a time: PHP is a single instance, and every job copies the database in and out.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function runJob(job: Record<string, unknown>, status?: Status): Promise<JobResult> {
  const files = getProject().files;
  const dbName = databaseName(files);
  const maria = await ensureSharedDatabase(dbName);
  const php = await getPhp(status);
  syncProject(php, files);

  const before = maria.exportDb(dbName) ?? new Uint8Array();
  const dbPath = `/db/${dbName}.sqlite`;
  php.writeFile(dbPath, before);
  php.writeFile("/tmp/in.json", JSON.stringify(job));
  try { php.unlink("/tmp/out.json"); } catch { /* none yet */ }

  status?.("Running PHP…");
  const run = await php.run({ code: "<?php require '/framework/run.php';" });

  let result: JobResult;
  try {
    result = JSON.parse(php.readFileAsText("/tmp/out.json")) as JobResult;
  } catch {
    const text = [run.errors, run.text].filter(Boolean).join("\n").trim();
    result = { ok: false, error: text || "PHP stopped without an answer (a fatal error such as a syntax error in a file you wrote).", queries: [], logs: [], dumps: [], ms: 0 };
  }

  // Changes PHP made to the database (migrations, inserts) go back into the shared server.
  try {
    const after = php.readFileAsBuffer(dbPath);
    if (!sameBytes(before, after)) maria.importDb(dbName, after);
  } catch { /* the database file could not be read back */ }
  return result;
}

export interface ApiRequest { method: string; url: string; headers?: Record<string, string>; body?: string }

export function laravelRequest(req: ApiRequest, status?: Status): Promise<JobResult> {
  return enqueue(() => {
    const uri = req.url.replace(/^https?:\/\/[^/]+/i, "") || "/";
    return runJob({ kind: "request", method: req.method.toUpperCase(), uri, headers: { Accept: "application/json", ...req.headers }, body: req.body ?? "" }, status);
  });
}

export function laravelArtisan(command: string, options: Record<string, string | boolean> = {}, status?: Status): Promise<JobResult> {
  return enqueue(() => runJob({ kind: "artisan", command, options }, status));
}

export function laravelTinker(code: string, status?: Status): Promise<JobResult> {
  return enqueue(() => runJob({ kind: "tinker", code }, status));
}

// "php artisan migrate:fresh --seed --class=X" -> command and options.
export function parseArtisan(line: string): { command: string; options: Record<string, string | boolean> } | null {
  const m = line.trim().match(/^(?:php\s+)?artisan\s+(\S+)(.*)$/i);
  if (!m) return null;
  const options: Record<string, string | boolean> = {};
  for (const o of m[2].matchAll(/--([\w-]+)(?:=(\S+))?/g)) options[o[1]] = o[2] ?? true;
  return { command: m[1], options };
}

// Used by the HTML/CSS/JS tab: answer a fetch() call made by the preview page.
export async function handlePreviewRequest(req: ApiRequest, status?: Status): Promise<{ status: number; headers: Record<string, string>; body: string; ms: number }> {
  const r = await laravelRequest(req, status);
  if (!r.ok || r.status === undefined) {
    return { status: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: r.error ?? "The Laravel app did not answer.", file: r.file, line: r.line }), ms: r.ms };
  }
  return { status: r.status, headers: r.headers ?? {}, body: r.body ?? "", ms: r.ms };
}
