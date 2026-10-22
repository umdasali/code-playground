// In-browser execution: C/C++ through clang compiled to WebAssembly, and bash + coreutils, all via the Wasmer SDK.
// Everything runs inside the visitor's browser, so there is no server, Docker or environment configuration.
// Client-side only: import this from client components.
import type { Process, Sandbox, Wasmer as WasmerClient } from "@wasmer/sdk";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

// Called with a human message and a 0-100 percent while large packages download (null = unknown).
export type Status = (message: string, percent: number | null) => void;

const SDK_URL = "/wasmer-sdk/dist/index.js"; // copied from node_modules by scripts/copy-wasmer.mjs
const COMPILE_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 10_000;
const OUTPUT_LIMIT = 64 * 1024;

const SHELL_PACKAGES = ["wasmer/bash", "wasmer/grep", "wasmer/findutils", "wasmer/tar", "wasmer/sed", "wasmer/less", "wasmer/gzip"];

// The clang package's libc++ hangs the compiler when thread support is on, so C++ uses a config_site without threads.
const CXX_CONFIG_SITE = `#ifndef _LIBCPP___CONFIG_SITE
#define _LIBCPP___CONFIG_SITE
#define _LIBCPP_ABI_VERSION 2
#define _LIBCPP_ABI_NAMESPACE __2
#define _LIBCPP_HAS_NO_THREADS
#define _LIBCPP_HAS_MUSL_LIBC
#define _LIBCPP_HAS_NO_VENDOR_AVAILABILITY_ANNOTATIONS
#define _LIBCPP_HAS_NO_FILESYSTEM_LIBRARY
#define _LIBCPP_ENABLE_ASSERTIONS_DEFAULT 0
#endif
`;

// libc++ is not linked in this toolchain, so operator new/delete (and the pure-virtual hook) are supplied here.
const CXX_RUNTIME_SHIM = `#include <cstdlib>
#include <cstddef>
void *operator new(std::size_t n) { void *p = std::malloc(n ? n : 1); if (!p) std::abort(); return p; }
void *operator new[](std::size_t n) { return operator new(n); }
void operator delete(void *p) noexcept { std::free(p); }
void operator delete[](void *p) noexcept { std::free(p); }
void operator delete(void *p, std::size_t) noexcept { std::free(p); }
void operator delete[](void *p, std::size_t) noexcept { std::free(p); }
extern "C" void __cxa_pure_virtual() { std::abort(); }
`;

// Headers known to compile with this toolchain. Anything else (iostream, vector, string, algorithm, ...) hangs clang.
const CXX_OK_HEADERS = new Set([
  // the C library, C++ spelling
  "cassert", "cctype", "cerrno", "cfenv", "cfloat", "cinttypes", "climits", "clocale", "cmath", "csetjmp", "csignal",
  "cstdarg", "cstddef", "cstdint", "cstdio", "cstdlib", "cstring", "ctime", "cwchar", "cwctype",
  // language support and small utilities
  "utility", "optional", "limits", "type_traits", "new", "array", "initializer_list", "typeinfo", "exception",
  "stdexcept", "iterator", "version", "compare", "concepts", "bit", "ratio", "iosfwd",
]);

export const CXX_LIMIT_NOTE =
  "In the browser, C++ supports the full language (classes, templates, lambdas, new/delete, virtual functions) plus the C library (<cstdio>, <cstdlib>, <cstring>, <cmath>, ...), <array>, <optional> and <utility>. <iostream>, STL containers, smart pointers and exceptions are not available yet.";

const SEED_FILES: Record<string, string> = {
  "notes.txt": Array.from({ length: 12 }, (_, i) => `line ${i + 1}: ${["hello world", "linux is fun", "practice makes perfect", "grep me", "the quick brown fox"][i % 5]}`).join("\n") + "\n",
  "fruits.txt": "apple\nbanana\ncherry\nbanana\napple\napple\ndate\nelderberry\ncherry\n",
  "a.txt": "red\ngreen\nblue\nyellow\n",
  "b.txt": "red\ngreen\nviolet\nyellow\norange\n",
  "people.csv": "id,name,city,age\n1,Asha,Pune,31\n2,Ben,Austin,27\n3,Chen,Shanghai,45\n4,Dana,Berlin,38\n5,Eli,Austin,22\n",
  "server.log": ["INFO service started", "INFO user login alice", "WARN disk at 85%", "ERROR db timeout", "INFO user login bob", "ERROR db timeout", "INFO request /home 200", "WARN slow query 2.1s", "ERROR payment failed"].map((l, i) => `2025-01-0${(i % 9) + 1} 10:0${i} ${l}`).join("\n") + "\n",
  "docs/readme.md": "# Docs\nWelcome to the playground.\nTODO: read the manual.\n",
  "docs/todo.txt": "buy milk\nwrite code\nTODO: learn find\n",
  "projects/app/main.c": '#include <stdio.h>\nint main(void) { puts("hi"); return 0; }\n',
  "projects/app/Makefile": "all:\n\tgcc -o app main.c\n",
  "projects/lib/util.c": "int add(int a, int b) { return a + b; }\n",
  "scripts/hello.sh": '#!/bin/bash\necho "hello from script"\n',
};

type Sdk = { Wasmer: new () => WasmerClient };
let sdkPromise: Promise<Sdk> | null = null;
let clientPromise: Promise<WasmerClient> | null = null;

async function client(): Promise<WasmerClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!window.crossOriginIsolated) {
        throw new Error("This page is not cross-origin isolated, so WebAssembly threads are unavailable. Open it over HTTPS (or localhost) in a current Chrome, Edge, Firefox or Safari.");
      }
      sdkPromise ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ SDK_URL) as Promise<Sdk>;
      const { Wasmer } = await sdkPromise;
      return new Wasmer();
    })().catch((e) => { clientPromise = null; sdkPromise = null; throw e; });
  }
  return clientPromise;
}

function progressReporter(label: string, status?: Status) {
  return (p: { phase: string; download: { percent?: number | null } }) => {
    if (!status) return;
    if (p.phase === "downloading") status(`Downloading ${label} (first visit only)…`, p.download.percent ?? null);
    else if (p.phase === "resolving") status(`Looking up ${label}…`, null);
    else if (p.phase === "loading") status(`Loading ${label}…`, 100);
  };
}

// ---------- C / C++ ----------

let compiler: Promise<Sandbox> | null = null;

async function getCompiler(status?: Status): Promise<Sandbox> {
  if (!compiler) {
    compiler = client()
      .then((w) => w.sandboxes.create({
        packages: ["clang/clang"],
        files: { "/workspace/pgcfg/__config_site": CXX_CONFIG_SITE, "/workspace/pgcfg/shim.cpp": CXX_RUNTIME_SHIM },
        onPackageProgress: progressReporter("the C/C++ compiler", status),
      }))
      .catch((e) => { compiler = null; throw e; });
  }
  return compiler;
}

async function dropCompiler() {
  const old = compiler;
  compiler = null;
  try { await (await old)?.close(); } catch {}
}

function cxxHeaderProblem(code: string): string | null {
  const bad = new Set<string>();
  for (const m of code.matchAll(/^\s*#\s*include\s*<([A-Za-z0-9_./]+)>/gm)) {
    const h = m[1];
    if (h.includes(".")) continue; // C headers such as <stdio.h>
    if (!CXX_OK_HEADERS.has(h)) bad.add(h);
  }
  return bad.size === 0 ? null : `Not available in the browser yet: ${[...bad].map((h) => `<${h}>`).join(", ")}.\n${CXX_LIMIT_NOTE}\nUse printf from <cstdio> for output.`;
}

const tidy = (s: string) =>
  s.split("\n").filter((l) => !/^clang-16: warning: -Wl,/.test(l)).join("\n").replaceAll("/workspace/", "").trim();

export async function runNative(lang: "c" | "cpp", code: string, stdin: string, status?: Status): Promise<RunResult> {
  const started = Date.now();
  const fail = (stderr: string, extra: Partial<RunResult> = {}): RunResult => ({ stdout: "", stderr, exitCode: null, timedOut: false, durationMs: Date.now() - started, ...extra });

  if (lang === "cpp") {
    const problem = cxxHeaderProblem(code);
    if (problem) return fail(problem, { exitCode: 1 });
  }

  try {
    const sb = await getCompiler(status);
    status?.("Compiling…", null);
    const file = lang === "c" ? "main.c" : "main.cpp";
    await sb.fs.writeText(`/workspace/${file}`, code);
    await sb.fs.remove("/workspace/main.wasm").catch(() => {});

    const args = lang === "c"
      ? [`/workspace/${file}`, "-o", "/workspace/main.wasm", "-O1", "-Wall", "-Wextra", "-lm"]
      : ["-I/workspace/pgcfg", "-std=c++20", "-fno-rtti", `/workspace/${file}`, "/workspace/pgcfg/shim.cpp", "-o", "/workspace/main.wasm", "-O1", "-Wall", "-Wextra"];
    const proc = await sb.command("clang", args, { cwd: "/workspace" }).spawn({ stdout: "capture", stderr: "capture" });
    const waited = await Promise.race([
      proc.wait({ check: false }),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), COMPILE_TIMEOUT_MS)),
    ]);
    if (waited === "timeout") {
      await proc.kill().catch(() => {});
      await dropCompiler();
      return fail("The compiler timed out. This usually means the program includes a header the in-browser toolchain cannot handle.", { timedOut: true });
    }
    const diagnostics = tidy(waited.stderr.text());
    if (waited.exitCode !== 0) return fail(diagnostics || "Compilation failed.", { exitCode: waited.exitCode });

    status?.("Running…", null);
    const wasm = await sb.fs.readFile("/workspace/main.wasm");
    const run = await runWasm(wasm, stdin);
    if (run.exitCode !== 0 && /\b(fork|vfork|pipe|execl|execlp|execle|execv|execvp|execve|system|popen)\s*\(/.test(code)) {
      run.stderr = [run.stderr, "Note: fork, exec, pipe and system need a real operating system. The browser's WebAssembly runtime cannot create processes, so programs that call them cannot run here. (getpid, getppid and exit work.)"].filter(Boolean).join("\n");
    }
    // Compiler warnings are shown first, like a terminal would.
    return { ...run, stderr: [diagnostics, run.stderr].filter(Boolean).join("\n"), durationMs: Date.now() - started };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

async function runWasm(bytes: Uint8Array, stdin: string): Promise<RunResult> {
  const started = Date.now();
  const w = await client();
  const pkg = await w.packages.load(bytes);
  const sb = await w.sandboxes.create({ packages: [pkg] });
  try {
    const out = await sb.command(pkg).run({ stdin, timeoutMs: RUN_TIMEOUT_MS, outputBytes: OUTPUT_LIMIT, check: false });
    return {
      stdout: out.stdout.text(),
      stderr: out.stderr.text(),
      exitCode: out.reason === "exited" ? out.exitCode : null,
      timedOut: out.reason === "timeout",
      durationMs: Date.now() - started,
    };
  } finally {
    await sb.close().catch(() => {});
  }
}

// ---------- Bash ----------

let shell: Promise<Sandbox> | null = null;

async function getShell(status?: Status): Promise<Sandbox> {
  if (!shell) {
    shell = (async () => {
      const [w, rc] = await Promise.all([client(), fetch("/playground.rc.sh").then((r) => r.text())]);
      const files: Record<string, string> = { "/workspace/.pgrc": rc };
      for (const [name, text] of Object.entries(SEED_FILES)) files[`/workspace/${name}`] = text;
      return w.sandboxes.create({
        packages: SHELL_PACKAGES,
        files,
        env: { HOME: "/workspace", TERM: "xterm-256color", USER: "learner" },
        onPackageProgress: progressReporter("the Linux tools", status),
      });
    })().catch((e) => { shell = null; throw e; });
  }
  return shell;
}

// Throw away the shell sandbox (and every file in it); the next use starts from the seed files again.
export async function resetShell() {
  const old = shell;
  shell = null;
  try { await (await old)?.close(); } catch {}
}

export async function runBash(code: string, stdin: string, status?: Status): Promise<RunResult> {
  const started = Date.now();
  try {
    const sb = await getShell(status);
    status?.("Running…", null);
    await sb.fs.writeText("/workspace/script.sh", code);
    // BASH_ENV makes the stand-in commands (chmod, diff, ps, ...) available inside scripts too.
    const out = await sb.command("bash", ["/workspace/script.sh"], { cwd: "/workspace", env: { BASH_ENV: "/workspace/.pgrc" } })
      .run({ stdin, timeoutMs: RUN_TIMEOUT_MS, outputBytes: OUTPUT_LIMIT, check: false });
    return {
      stdout: out.stdout.text(),
      stderr: out.stderr.text(),
      exitCode: out.reason === "exited" ? out.exitCode : null,
      timedOut: out.reason === "timeout",
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return { stdout: "", stderr: e instanceof Error ? e.message : String(e), exitCode: null, timedOut: false, durationMs: Date.now() - started };
  }
}

// Interactive login-style shell for the Terminal tab; the caller wires the returned streams to xterm.
export async function startShell(cols: number, rows: number, status?: Status): Promise<Process> {
  const sb = await getShell(status);
  status?.("Starting shell…", null);
  return sb.command("bash", ["--rcfile", "/workspace/.pgrc", "-i"], { cwd: "/workspace" })
    .spawn({ terminal: { columns: cols, rows } });
}
