"use client";

import Editor from "@monaco-editor/react";
import { Database, FilePlus2, Globe, Loader2, Play, RotateCcw, Send, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  databaseName, deleteProjectFile, getProject, laravelArtisan, laravelRequest, laravelTinker, loadTemplate, parseArtisan, setProjectFile,
  type JobResult, type Project,
} from "@/lib/laravel";
import { LARAVEL_TEMPLATES, templateById } from "@/lib/laravel-templates";
import CliConsole from "./CliConsole";
import { Button, cn } from "./ui";

interface Props {
  openWeb: (web: { html: string; css: string; js: string }) => void;
  openMariaDb: () => void;
}

// Starting code for files created with the + button, chosen by folder.
function stubFor(path: string): string {
  const name = path.split("/").pop()!.replace(/\.php$/, "");
  const ns = (dir: string) => `App\\${dir}`;
  if (path.startsWith("app/Models/")) return `<?php\n\nnamespace ${ns("Models")};\n\nuse Illuminate\\Database\\Eloquent\\Model;\n\nclass ${name} extends Model\n{\n    protected $fillable = [];\n}\n`;
  if (path.startsWith("app/Http/Controllers/")) return `<?php\n\nnamespace ${ns("Http\\Controllers")};\n\nuse Illuminate\\Http\\Request;\n\nclass ${name} extends Controller\n{\n    public function index()\n    {\n        return [];\n    }\n}\n`;
  if (path.startsWith("app/Http/Requests/")) return `<?php\n\nnamespace ${ns("Http\\Requests")};\n\nuse Illuminate\\Foundation\\Http\\FormRequest;\n\nclass ${name} extends FormRequest\n{\n    public function rules(): array\n    {\n        return [\n            //\n        ];\n    }\n}\n`;
  if (path.startsWith("app/Http/Resources/")) return `<?php\n\nnamespace ${ns("Http\\Resources")};\n\nuse Illuminate\\Http\\Request;\nuse Illuminate\\Http\\Resources\\Json\\JsonResource;\n\nclass ${name} extends JsonResource\n{\n    public function toArray(Request $request): array\n    {\n        return parent::toArray($request);\n    }\n}\n`;
  if (path.startsWith("database/migrations/")) return `<?php\n\nuse Illuminate\\Database\\Migrations\\Migration;\nuse Illuminate\\Database\\Schema\\Blueprint;\nuse Illuminate\\Support\\Facades\\Schema;\n\nreturn new class extends Migration\n{\n    public function up(): void\n    {\n        Schema::create('table_name', function (Blueprint $table) {\n            $table->id();\n            $table->timestamps();\n        });\n    }\n\n    public function down(): void\n    {\n        Schema::dropIfExists('table_name');\n    }\n};\n`;
  if (path.startsWith("database/seeders/")) return `<?php\n\nnamespace Database\\Seeders;\n\nuse Illuminate\\Database\\Seeder;\n\nclass ${name} extends Seeder\n{\n    public function run(): void\n    {\n        //\n    }\n}\n`;
  if (path.startsWith("database/factories/")) return `<?php\n\nnamespace Database\\Factories;\n\nuse Illuminate\\Database\\Eloquent\\Factories\\Factory;\n\nclass ${name} extends Factory\n{\n    public function definition(): array\n    {\n        return [\n            'name' => $this->faker->name(),\n        ];\n    }\n}\n`;
  return path.endsWith(".php") ? "<?php\n\n" : "";
}

const languageOf = (path: string) => (path.endsWith(".php") ? "php" : path.endsWith(".json") ? "json" : path === ".env" ? "ini" : path.endsWith(".md") ? "markdown" : "plaintext");

const STATUS_STYLE = (s: number) => (s < 300 ? "bg-emerald-500/15 text-emerald-300" : s < 400 ? "bg-sky-500/15 text-sky-300" : s < 500 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function pretty(body: string): string {
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

export default function LaravelLab({ openWeb, openMariaDb }: Props) {
  const [proj, setProj] = useState<Project>(() => getProject());
  const [selected, setSelected] = useState(() => (getProject().files["routes/api.php"] !== undefined ? "routes/api.php" : Object.keys(getProject().files)[0]));
  const [adding, setAdding] = useState<string | null>(null);
  const [panel, setPanel] = useState<"request" | "console">("request");
  const [busy, setBusy] = useState<string | null>(null);
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("/api/ping");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<(JobResult & { sent?: string }) | null>(null);
  const [resTab, setResTab] = useState<"body" | "headers" | "queries" | "logs">("body");
  const [lines, setLines] = useState<string[]>(["Laravel console. Type an artisan command (php artisan migrate) or PHP to run, for example App\\Models\\Product::count()"]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const template = templateById(proj.template);
  const files = Object.keys(proj.files).sort();
  const dbName = databaseName(proj.files);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const edit = (path: string, value: string) => {
    setProj((p) => ({ ...p, files: { ...p.files, [path]: value } }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setProjectFile(path, value), 300);
  };

  const pickTemplate = (id: string) => {
    if (!window.confirm("Replace the files in this project with the template? Your changes will be lost.")) return;
    const p = loadTemplate(id);
    setProj({ ...p, files: { ...p.files } });
    setSelected(p.files["routes/api.php"] !== undefined ? "routes/api.php" : Object.keys(p.files)[0]);
    const first = templateById(id).requests[0];
    if (first) { setMethod(first.method); setUrl(first.url); setBody(first.body ?? ""); }
    setResult(null);
    setLines((l) => [...l, "", `Loaded template: ${templateById(id).title}`]);
  };

  const addFile = (e: React.FormEvent) => {
    e.preventDefault();
    const path = (adding ?? "").trim().replace(/^\/+/, "");
    if (!path || path in proj.files) { setAdding(null); return; }
    const content = stubFor(path);
    setProjectFile(path, content);
    setProj((p) => ({ ...p, files: { ...p.files, [path]: content } }));
    setSelected(path);
    setAdding(null);
  };
  const removeFile = (path: string) => {
    if (!window.confirm(`Delete ${path}?`)) return;
    deleteProjectFile(path);
    setProj((p) => { const f = { ...p.files }; delete f[path]; return { ...p, files: f }; });
    if (selected === path) setSelected(files.find((f) => f !== path) ?? "");
  };

  const send = async (m = method, u = url, b = body) => {
    setBusy("Sending…");
    setPanel("request");
    try {
      const r = await laravelRequest({ method: m, url: u, headers: b && m !== "GET" ? { "Content-Type": "application/json" } : {}, body: m === "GET" ? "" : b }, setBusy);
      setResult({ ...r, sent: `${m} ${u}` });
      setResTab(r.status === undefined ? "body" : "body");
    } finally { setBusy(null); }
  };

  const runConsole = async (line: string) => {
    const text = line.trim();
    if (!text) return;
    const echo = `>>> ${text}`;
    setPanel("console");
    setBusy("Running…");
    try {
      const art = parseArtisan(text);
      const r = art ? await laravelArtisan(art.command, art.options, setBusy) : await laravelTinker(text, setBusy);
      const out = r.ok ? (r.output ?? "") : `${r.error}${r.file ? `\n  at ${r.file}:${r.line}` : ""}`;
      setLines((l) => [...l, echo, ...(out ? out.split("\n") : []), ...r.dumps, ""].slice(-600));
      if (art) setResult((prev) => prev && { ...prev, queries: prev.queries });
    } finally { setBusy(null); }
  };

  const consoleHints = useMemo(() => template.console ?? ["php artisan migrate", "php artisan route:list"], [template]);
  const reqChips = template.requests;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          Template
          <select value={proj.template} onChange={(e) => pickTemplate(e.target.value)} aria-label="Project template"
            className="h-8 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none hover:border-zinc-500 focus:border-sky-500">
            {LARAVEL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <Button size="sm" icon={Play} onClick={() => void runConsole("php artisan migrate")} disabled={!!busy} title="Run the pending migrations">Migrate</Button>
        <Button size="sm" icon={RotateCcw} onClick={() => void runConsole("php artisan migrate:fresh --seed")} disabled={!!busy} title="Drop every table, migrate again and run the seeders">Fresh + seed</Button>
        <Button size="sm" icon={Wand2} onClick={() => void runConsole("php artisan route:list")} disabled={!!busy} iconOnlyOnSmall title="List the routes">Routes</Button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400" title="DB_DATABASE in .env: the same database the MariaDB tab shows"><Database size={13} aria-hidden />{dbName}</span>
          <Button size="sm" icon={Database} onClick={openMariaDb} title="Open this database in the MariaDB tab">MariaDB</Button>
          <Button size="sm" variant="primary" icon={Globe} onClick={() => openWeb(template.web)} title="Put this template's test page in the HTML/CSS/JS tab; its fetch('/api/...') calls reach this Laravel app">Test page in HTML tab</Button>
        </span>
      </div>
      <p className="border-b border-zinc-800 bg-zinc-900/20 px-3 py-1.5 text-xs text-zinc-500">{template.description}</p>

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[13rem_minmax(0,1fr)_minmax(0,28rem)] lg:overflow-hidden">
        <nav aria-label="Project files" className="max-h-56 overflow-y-auto border-b border-zinc-800 py-1 text-xs lg:max-h-none lg:border-b-0 lg:border-r">
          <div className="flex items-center px-3 py-1">
            <span className="font-semibold uppercase tracking-wide text-zinc-500">Files</span>
            <button onClick={() => setAdding("app/")} title="New file" aria-label="New file" className="ml-auto cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"><FilePlus2 size={14} aria-hidden /></button>
          </div>
          {adding !== null && (
            <form onSubmit={addFile} className="px-2 pb-1">
              <input autoFocus value={adding} onChange={(e) => setAdding(e.target.value)} onBlur={() => setAdding(null)} aria-label="New file path" placeholder="app/Models/Order.php"
                className="w-full rounded border border-sky-600 bg-zinc-900 px-2 py-1 font-mono text-[11px] outline-none" />
            </form>
          )}
          {files.map((f, i) => {
            const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
            const showDir = i === 0 || (files[i - 1].includes("/") ? files[i - 1].slice(0, files[i - 1].lastIndexOf("/")) : "") !== dir;
            return (
              <div key={f}>
                {showDir && dir && <div className="truncate px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-zinc-600">{dir}</div>}
                <div className={cn("group flex items-center border-l-2 pr-1 transition-colors hover:bg-zinc-900", f === selected ? "border-sky-500 bg-zinc-900 text-sky-300" : "border-transparent text-zinc-300")}>
                  <button onClick={() => setSelected(f)} title={f} className="min-w-0 flex-1 cursor-pointer truncate py-1 pl-3 text-left font-mono">{f.split("/").pop()}</button>
                  <button onClick={() => removeFile(f)} title={`Delete ${f}`} aria-label={`Delete ${f}`} className="cursor-pointer rounded p-1 text-zinc-600 opacity-0 transition hover:text-rose-400 focus:opacity-100 group-hover:opacity-100"><Trash2 size={12} aria-hidden /></button>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="flex h-[26rem] min-h-0 min-w-0 flex-col border-b border-zinc-800 lg:h-auto lg:border-b-0 lg:border-r">
          <div className="truncate border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-xs text-zinc-400">{selected}</div>
          <div className="min-h-0 flex-1">
            {selected in proj.files ? (
              <Editor height="100%" theme="vs-dark" language={languageOf(selected)} path={`laravel:${selected}`} value={proj.files[selected]} onChange={(v) => edit(selected, v ?? "")}
                options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4 }} />
            ) : <p className="p-4 text-sm text-zinc-500">Pick a file on the left, or create one with +.</p>}
          </div>
        </div>

        <div className="flex min-h-[30rem] min-w-0 flex-col lg:min-h-0">
          <div role="tablist" className="flex border-b border-zinc-800 bg-zinc-900/60">
            {(["request", "console"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={panel === t} onClick={() => setPanel(t)}
                className={cn("cursor-pointer border-b-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors", panel === t ? "border-sky-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-100")}>
                {t === "request" ? "API request" : "Console"}
              </button>
            ))}
            {busy && <span className="ml-auto flex items-center gap-1.5 pr-3 text-xs text-zinc-400"><Loader2 size={12} className="animate-spin" aria-hidden />{busy}</span>}
          </div>

          {panel === "request" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="space-y-2 border-b border-zinc-800 p-3">
                <div className="flex gap-2">
                  <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="HTTP method"
                    className="h-9 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm font-semibold text-zinc-100 outline-none focus:border-sky-500">
                    {METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="URL" placeholder="/api/products"
                    className="h-9 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 font-mono text-sm outline-none focus:border-sky-500" />
                  <Button type="submit" variant="primary" icon={Send} disabled={!!busy} className="h-9">Send</Button>
                </div>
                {method !== "GET" && (
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} aria-label="JSON body" rows={5} placeholder='{ "name": "..." }'
                    className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs outline-none focus:border-sky-500" />
                )}
                <div className="flex flex-wrap gap-1.5">
                  {reqChips.map((r) => (
                    <button key={r.label} type="button" onClick={() => { setMethod(r.method); setUrl(r.url); setBody(r.body ?? ""); void send(r.method, r.url, r.body ?? ""); }}
                      className="cursor-pointer rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-sky-600 hover:text-white active:bg-zinc-800">
                      <b className="mr-1 text-zinc-500">{r.method}</b>{r.label}
                    </button>
                  ))}
                </div>
              </form>

              <div className="flex min-h-0 flex-1 flex-col">
                {!result ? <p className="p-3 text-xs text-zinc-500">Send a request to see the response, the SQL it ran and the logs. Run <b>Migrate</b> first if the tables do not exist yet.</p> : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
                      {result.status !== undefined ? <span className={cn("rounded-full px-2 py-0.5 font-semibold", STATUS_STYLE(result.status))}>{result.status}</span> : <span className="rounded-full bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-300">PHP error</span>}
                      <span className="font-mono text-zinc-400">{result.sent}</span>
                      <span className="ml-auto text-zinc-500">{result.ms} ms</span>
                    </div>
                    <div role="tablist" className="flex border-b border-zinc-800 text-[11px]">
                      {([["body", "Body"], ["headers", "Headers"], ["queries", `Queries (${result.queries.length})`], ["logs", `Logs (${result.logs.length + result.dumps.length})`]] as const).map(([k, label]) => (
                        <button key={k} role="tab" aria-selected={resTab === k} onClick={() => setResTab(k)}
                          className={cn("cursor-pointer border-b-2 px-3 py-1 transition-colors", resTab === k ? "border-sky-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-200")}>{label}</button>
                      ))}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-black/40 p-3 font-mono text-xs">
                      {resTab === "body" && <pre className="whitespace-pre-wrap break-words text-zinc-200">{result.status === undefined ? `${result.error}${result.file ? `\n  at ${result.file}:${result.line}` : ""}` : result.body ? pretty(result.body) : "(empty body)"}</pre>}
                      {resTab === "headers" && <pre className="text-zinc-300">{Object.entries(result.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)"}</pre>}
                      {resTab === "queries" && (result.queries.length ? result.queries.map((q, i) => (
                        <div key={i} className="border-b border-zinc-900 py-1">
                          <div className={q.error ? "text-rose-300" : "text-emerald-200"}>{q.query}</div>
                          <div className="text-zinc-500">{q.bindings.length ? `bindings: ${JSON.stringify(q.bindings)} · ` : ""}{q.time} ms{q.error ? ` · ${q.error}` : ""}</div>
                        </div>
                      )) : <span className="text-zinc-500">No queries ran.</span>)}
                      {resTab === "logs" && ([...result.logs.map((l) => `[${l.level}] ${l.message}`), ...result.dumps].length ? [...result.logs.map((l) => `[${l.level}] ${l.message}`), ...result.dumps].map((l, i) => <pre key={i} className="whitespace-pre-wrap text-zinc-300">{l}</pre>) : <span className="text-zinc-500">Log::info(...) and dump(...) output appears here.</span>)}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <CliConsole id={`laravel:${proj.template}`} lines={lines} tick={lines.length} prompt=">>>" hints={consoleHints} label="Laravel console" onRun={(l) => void runConsole(l)} />
          )}
        </div>
      </div>
    </div>
  );
}
