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

// libc++ is not linked in this toolchain, so operator new/delete, the pure-virtual hook and the (single-threaded)
// static-initialisation guards are supplied here.
const CXX_RUNTIME_SHIM = `#include <cstdlib>
#include <cstddef>
void *operator new(std::size_t n) { void *p = std::malloc(n ? n : 1); if (!p) std::abort(); return p; }
void *operator new[](std::size_t n) { return operator new(n); }
void operator delete(void *p) noexcept { std::free(p); }
void operator delete[](void *p) noexcept { std::free(p); }
void operator delete(void *p, std::size_t) noexcept { std::free(p); }
void operator delete[](void *p, std::size_t) noexcept { std::free(p); }
extern "C" void __cxa_pure_virtual() { std::abort(); }
extern "C" int __cxa_guard_acquire(long long *g) { return *reinterpret_cast<char *>(g) ? 0 : 1; }
extern "C" void __cxa_guard_release(long long *g) { *reinterpret_cast<char *>(g) = 1; }
extern "C" void __cxa_guard_abort(long long *) {}
`;

// libc++'s own <iostream>, <string>, <vector>, <memory> and <algorithm> hang or crash this clang build, so the playground
// ships small replacements (public/cxx/, same names, found first through -I). Exceptions need an unwinder that the
// toolchain lacks, so they are compiled out with -fno-exceptions.
const CXX_OWN_HEADERS = ["iostream", "iomanip", "string", "vector", "memory", "algorithm", "numeric"];

// Headers known to compile with this toolchain. Anything else (map, sstream, functional, ...) is not supported yet.
const CXX_OK_HEADERS = new Set([
  ...CXX_OWN_HEADERS,
  // the C library, C++ spelling
  "cassert", "cctype", "cerrno", "cfenv", "cfloat", "cinttypes", "climits", "clocale", "cmath", "csetjmp", "csignal",
  "cstdarg", "cstddef", "cstdint", "cstdio", "cstdlib", "cstring", "ctime", "cwchar", "cwctype",
  // language support and small utilities
  "utility", "optional", "limits", "type_traits", "new", "array", "initializer_list", "typeinfo", "exception",
  "stdexcept", "iterator", "version", "compare", "concepts", "bit", "ratio", "iosfwd",
]);

// The same facts as CXX_LIMIT_NOTE, split up for the notice above the C++ editor.
export const CXX_SUPPORTED = [
  "classes, templates, lambdas, virtual functions, new/delete, constexpr",
  "<iostream> (cin, cout, cerr), <iomanip>, <string>, <vector>, <algorithm>, <numeric>",
  "<memory> (unique_ptr, shared_ptr, weak_ptr), <array>, <optional>, <utility>",
  "the C library: <cstdio>, <cstdlib>, <cstring>, <cmath>, <ctime>, ...",
];
export const CXX_MISSING = [
  "<map>, <set>, <unordered_map>, <list>, <deque>, <queue>, <stack>",
  "<sstream>, <fstream>, <functional>, <tuple>, <chrono>, <random>",
  "threads, and exceptions (try, catch, throw)",
];

export const CXX_LIMIT_NOTE =
  "In the browser, C++ supports the full language (classes, templates, lambdas, new/delete, virtual functions) plus <iostream>, <iomanip>, <string>, <vector>, <memory> (unique_ptr, shared_ptr), <algorithm>, <numeric>, <array>, <optional>, <utility> and the C library (<cstdio>, <cstdlib>, <cstring>, <cmath>, ...). <map>, <set>, <sstream>, <functional>, threads and exceptions (try/catch/throw) are not available yet.";

// What to use instead of a header the browser toolchain cannot compile.
const CXX_HEADER_HINTS: Record<string, string> = {
  map: "no associative containers yet; use a std::vector of pairs or a plain array",
  unordered_map: "no associative containers yet; use a std::vector of pairs or a plain array",
  set: "no associative containers yet; keep a sorted std::vector (std::sort, std::binary_search)",
  unordered_set: "no associative containers yet; keep a sorted std::vector (std::sort, std::binary_search)",
  list: "use std::vector instead",
  deque: "use std::vector instead",
  queue: "use std::vector with an index for the front",
  stack: "use std::vector (push_back, back, pop_back)",
  sstream: "use snprintf from <cstdio> or std::to_string",
  fstream: "files are not available to C++ programs here; read input from std::cin",
  functional: "use lambdas or plain function pointers",
  tuple: "use std::pair or a small struct",
  thread: "threads are not available in the browser sandbox",
  mutex: "threads are not available in the browser sandbox",
  atomic: "threads are not available in the browser sandbox",
  chrono: "use <ctime> (clock, time)",
  random: "use rand and srand from <cstdlib>",
  regex: "not available; use <cstring> (strstr, strchr)",
  filesystem: "not available in the browser sandbox",
  bitset: "use plain integers with <bit> and bit operations",
  variant: "use a tagged struct or union",
  any: "use a template or a base class",
  span: "pass a pointer and a size, or a std::vector",
  string_view: "use const char * or const std::string &",
  format: "use printf from <cstdio> or std::cout",
  ranges: "use the iterator versions in <algorithm>",
  coroutine: "not available in the browser sandbox",
};

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

// The playground's own C++ headers, served from public/cxx/ and placed where -I/workspace/pgcfg/inc finds them.
async function cxxHeaders(): Promise<Record<string, string>> {
  const files = await Promise.all(CXX_OWN_HEADERS.map(async (h) => {
    const res = await fetch(`/cxx/${h}`);
    if (!res.ok) throw new Error(`Could not load the C++ header <${h}> (HTTP ${res.status}).`);
    return [`/workspace/pgcfg/inc/${h}`, await res.text()] as const;
  }));
  return Object.fromEntries(files);
}

async function getCompiler(status?: Status): Promise<Sandbox> {
  if (!compiler) {
    compiler = Promise.all([client(), cxxHeaders()])
      .then(([w, headers]) => w.sandboxes.create({
        packages: ["clang/clang"],
        files: { "/workspace/pgcfg/__config_site": CXX_CONFIG_SITE, "/workspace/pgcfg/shim.cpp": CXX_RUNTIME_SHIM, ...headers },
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
  const bad = new Map<string, number>(); // header -> first line it is included on
  code.split("\n").forEach((line, i) => {
    const m = line.match(/^\s*#\s*include\s*<([A-Za-z0-9_./]+)>/);
    if (!m || m[1].includes(".") || CXX_OK_HEADERS.has(m[1])) return; // C headers such as <stdio.h> contain a dot
    if (!bad.has(m[1])) bad.set(m[1], i + 1);
  });
  if (bad.size === 0) return null;
  const lines = [...bad].map(([h, line]) => {
    const hint = CXX_HEADER_HINTS[h];
    return `  line ${line}: <${h}> is not available in the browser${hint ? ` (${hint})` : ""}`;
  });
  return `${lines.join("\n")}\n\n${CXX_LIMIT_NOTE}`;
}

// Turn the compiler's wording for a language feature the toolchain cannot provide into an explanation.
function cxxDiagnosticHints(diagnostics: string): string | null {
  if (/exceptions disabled/.test(diagnostics)) {
    return "Note: exceptions (try, catch, throw) are not available in the browser yet. Return an error code or check the value before using it.";
  }
  if (/use of typeid requires -frtti|cannot use dynamic_cast|dynamic_cast.*-fno-rtti/.test(diagnostics)) {
    return "Note: run-time type information (typeid, dynamic_cast) is turned off in the browser. Use virtual functions instead.";
  }
  return null;
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
      : ["-I/workspace/pgcfg/inc", "-I/workspace/pgcfg", "-std=c++20", "-fno-rtti", "-fno-exceptions", `/workspace/${file}`, "/workspace/pgcfg/shim.cpp", "-o", "/workspace/main.wasm", "-O1", "-Wall", "-Wextra"];
    const proc = await sb.command("clang", args, { cwd: "/workspace" }).spawn({ stdout: "capture", stderr: "capture" });
    const waited = await Promise.race([
      proc.wait({ check: false }),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), COMPILE_TIMEOUT_MS)),
    ]);
    if (waited === "timeout") {
      await proc.kill().catch(() => {});
      await dropCompiler();
      return fail("The compiler timed out. This usually means the program uses a library feature the in-browser toolchain cannot handle (see the notice above the editor).", { timedOut: true });
    }
    const diagnostics = tidy(waited.stderr.text());
    if (waited.exitCode !== 0) {
      const hint = lang === "cpp" ? cxxDiagnosticHints(diagnostics) : null;
      return fail([diagnostics || "Compilation failed.", hint].filter(Boolean).join("\n\n"), { exitCode: waited.exitCode });
    }

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
