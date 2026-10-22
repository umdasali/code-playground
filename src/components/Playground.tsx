"use client";

import Editor from "@monaco-editor/react";
import { CheckCircle2, Clock, Code2, Database, FileCode2, Globe, Info, Keyboard, Play, RotateCcw, SquareTerminal, Terminal as TerminalIcon, XCircle, Braces, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { C_EXAMPLES, CPP_EXAMPLES, type Example } from "@/lib/examples";
import { TABS, type TabId } from "@/lib/languages";
import { CXX_LIMIT_NOTE, runBash, runNative, type RunResult } from "@/lib/wasm";
import MySqlWorkspace from "./MySqlWorkspace";
import Terminal from "./Terminal";
import { Button, cn, ExamplesMenu } from "./ui";
import WebPlayground from "./WebPlayground";

const TAB_ICONS: Record<TabId, LucideIcon> = {
  c: Braces,
  cpp: FileCode2,
  bash: SquareTerminal,
  terminal: TerminalIcon,
  web: Globe,
  mysql: Database,
};

const EXAMPLES: Partial<Record<TabId, Example[]>> = { c: C_EXAMPLES, cpp: CPP_EXAMPLES };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

export default function Playground() {
  const [tab, setTab] = useState<TabId>(() => {
    const saved = store.get("pg:tab") as TabId | null;
    return saved && TABS.some((t) => t.id === saved) ? saved : "c";
  });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [stdin, setStdin] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<{ message: string; percent: number | null } | null>(null);

  const cfg = TABS.find((t) => t.id === tab)!;
  const code = codes[tab] ?? store.get(`pg:code:${tab}`) ?? cfg.starter;

  const setCode = (v: string) => {
    setCodes((c) => ({ ...c, [tab]: v }));
    store.set(`pg:code:${tab}`, v);
  };
  const switchTab = (t: TabId) => {
    setTab(t);
    store.set("pg:tab", t);
    setRun(null);
  };
  const pickExample = (ex: Example) => {
    setCode(ex.code);
    setStdin(ex.stdin ?? "");
    setRun(null);
  };

  const execute = useCallback(async () => {
    setBusy(true);
    setRun(null);
    setStatus({ message: "Starting…", percent: null });
    const onStatus = (message: string, percent: number | null) => setStatus({ message, percent });
    try {
      setRun(tab === "bash" ? await runBash(code, stdin, onStatus) : await runNative(tab === "cpp" ? "cpp" : "c", code, stdin, onStatus));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [tab, code, stdin]);

  const custom = tab === "mysql" || tab === "terminal" || tab === "web";
  const openInC = (src: string) => {
    setCodes((c) => ({ ...c, c: src }));
    store.set("pg:code:c", src);
    switchTab("c");
  };

  // Ctrl/Cmd+Enter runs the code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!custom && (e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!busy) void execute(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, execute, custom]);

  const showStdin = tab === "c" || tab === "cpp" || tab === "bash";
  const examples = EXAMPLES[tab];

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-stretch border-b border-zinc-800 bg-zinc-950">
        <div className="flex shrink-0 items-center gap-2 pl-3 pr-2 sm:pr-4">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-sky-600/20 text-sky-400"><Code2 size={16} aria-hidden /></span>
          <span className="hidden text-sm font-semibold text-zinc-200 md:inline">Coding Playground</span>
        </div>
        <nav className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto" aria-label="Playgrounds">
          {TABS.map((t) => {
            const Icon = TAB_ICONS[t.id];
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => switchTab(t.id)} aria-current={active ? "page" : undefined} title={t.label}
                className={cn(
                  "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70 active:bg-zinc-800",
                  active ? "border-sky-500 text-white" : "border-transparent text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-100",
                )}>
                <Icon size={15} className={cn("transition-colors", active ? "text-sky-400" : "text-zinc-500 group-hover:text-zinc-300")} aria-hidden />
                <span className={cn(!active && "hidden lg:inline")}>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {tab === "mysql" ? <MySqlWorkspace /> : tab === "terminal" ? <Terminal openInC={openInC} /> : tab === "web" ? <WebPlayground /> : (
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{cfg.label}</span>
            {examples && <ExamplesMenu examples={examples} onPick={pickExample} />}
            <div className="ml-auto flex items-center gap-2">
              <Button icon={RotateCcw} onClick={() => { setCode(cfg.starter); setStdin(""); setRun(null); }} iconOnlyOnSmall title="Restore the starter code">Reset</Button>
              <Button variant="primary" icon={Play} loading={busy} onClick={() => void execute()} title="Run (Ctrl/⌘ + Enter)">{busy ? "Running" : "Run"}</Button>
            </div>
          </div>

          {tab === "cpp" && (
            <p className="flex items-start gap-2 border-b border-amber-900/40 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-200/90">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />{CXX_LIMIT_NOTE}
            </p>
          )}
          <div className="min-h-0 flex-1">
            <Editor
              height="100%" theme="vs-dark" language={cfg.monaco} path={tab} value={code}
              onChange={(v) => setCode(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 8 } }}
            />
          </div>

          <div className="grid min-h-0 shrink-0 grid-rows-[auto_1fr] border-t border-zinc-800 md:h-[34%] md:min-h-40 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-rows-1">
            {showStdin && (
              <label className="flex flex-col border-b border-zinc-800 md:border-b-0 md:border-r">
                <span className="flex items-center gap-1.5 bg-zinc-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><Keyboard size={12} aria-hidden />Input (stdin)</span>
                <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Values your program reads, e.g. 17 5" rows={2}
                  className="min-h-0 flex-1 resize-none bg-zinc-950 px-3 py-2 font-mono text-xs outline-none transition-colors placeholder:text-zinc-600 hover:bg-zinc-900/60 focus:bg-zinc-900/60 md:min-h-0" />
              </label>
            )}
            <section className={cn("flex min-h-28 flex-col overflow-hidden bg-black/40 max-md:h-48", !showStdin && "md:col-span-2")}>
              <div className="flex items-center gap-1.5 bg-zinc-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><TerminalIcon size={12} aria-hidden />Output</div>
              <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs"><Output run={run} busy={busy} status={status} /></div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}

function Output({ run, busy, status }: { run: RunResult | null; busy: boolean; status: { message: string; percent: number | null } | null }) {
  if (busy) {
    return (
      <div className="max-w-sm space-y-2 text-zinc-400">
        <p>{status?.message ?? "Working…"}</p>
        {status?.percent != null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={Math.round(status.percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${status.percent}%` }} />
          </div>
        )}
      </div>
    );
  }
  if (!run) return <span className="text-zinc-500">Press Run (Ctrl/⌘ + Enter) to see output here.</span>;
  if (run.error) return <pre className="whitespace-pre-wrap text-rose-400">{run.error}</pre>;
  const ok = run.exitCode === 0 && !run.timedOut;
  const Status = run.timedOut ? Clock : ok ? CheckCircle2 : XCircle;
  return (
    <div>
      {run.stdout && <pre className="whitespace-pre-wrap">{run.stdout}</pre>}
      {run.stderr && <pre className={cn("whitespace-pre-wrap", ok ? "text-amber-300" : "text-rose-400")}>{run.stderr}</pre>}
      <p className={cn("mt-2 flex items-center gap-1.5", ok ? "text-emerald-400" : "text-amber-400")}>
        <Status size={14} aria-hidden />
        {run.timedOut ? "Timed out" : run.exitCode === null ? "Did not run" : `Exited with code ${run.exitCode}`}
        <span className="text-zinc-500">· {run.durationMs} ms</span>
      </p>
    </div>
  );
}
