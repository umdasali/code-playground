"use client";

import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";
import { TABS, type TabId } from "@/lib/languages";
import MySqlWorkspace from "./MySqlWorkspace";
import Terminal from "./Terminal";
import WebPlayground from "./WebPlayground";

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

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

  const cfg = TABS.find((t) => t.id === tab)!;
  const codeKey = tab;
  const starter = cfg.starter;
  const code = codes[codeKey] ?? store.get(`pg:code:${codeKey}`) ?? starter;

  const setCode = (v: string) => {
    setCodes((c) => ({ ...c, [codeKey]: v }));
    store.set(`pg:code:${codeKey}`, v);
  };
  const switchTab = (t: TabId) => {
    setTab(t);
    store.set("pg:tab", t);
    setRun(null);
  };

  const post = useCallback(async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  }, []);

  const execute = useCallback(async () => {
    setBusy(true); setRun(null);
    try {
        const data = await post("/api/run", { lang: tab, code, stdin });
        setRun(data);
    } catch {
      setRun({ stdout: "", stderr: "Network error.", exitCode: null, timedOut: false, durationMs: 0 });
    } finally {
      setBusy(false);
    }
  }, [tab, code, stdin, post]);

  const custom = tab === "mysql" || tab === "terminal" || tab === "web";
  const openInC = (src: string) => {
    setCodes((c) => ({ ...c, c: src }));
    store.set("pg:code:c", src);
    switchTab("c");
  };

  // Ctrl/Cmd+Enter runs the code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!custom && (e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!busy) execute(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, execute, custom]);

  const showStdin = tab === "c" || tab === "cpp" || tab === "bash";

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-1 border-b border-zinc-800 px-3">
        <span className="mr-4 py-3 text-sm font-semibold text-zinc-300">Coding Playground</span>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => switchTab(t.id)}
            className={`px-3 py-3 text-sm border-b-2 ${tab === t.id ? "border-sky-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 py-2">
          {!custom && <>
          <button onClick={() => setCode(starter)} className="rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">Reset code</button>
          <button disabled={busy} onClick={execute} className="rounded bg-sky-600 px-4 py-1 text-sm font-medium hover:bg-sky-500 disabled:opacity-50">
            {busy ? "Running…" : "Run ▶"}
          </button></>}
        </div>
      </header>

      {tab === "mysql" ? <MySqlWorkspace /> : tab === "terminal" ? <Terminal openInC={openInC} /> : tab === "web" ? <WebPlayground /> : <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Editor
              height="100%" theme="vs-dark" language={cfg.monaco} path={codeKey} value={code}
              onChange={(v) => setCode(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true }}
            />
          </div>
          {showStdin && (
            <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="stdin (optional)" rows={2}
              className="resize-none border-t border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs outline-none" />
          )}
          <section className="h-1/3 min-h-32 overflow-auto border-t border-zinc-800 bg-black/40 p-3 font-mono text-xs">
            <Output run={run} />
          </section>
        </main>
      </div>}
      {!custom && <footer className="border-t border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">Ctrl/⌘ + Enter to run</footer>}
    </div>
  );
}

function Output({ run }: { run: RunResult | null }) {
  if (!run) return <span className="text-zinc-500">Output appears here.</span>;
  if (run.error) return <pre className="text-rose-400">{run.error}</pre>;
  return (
    <div>
      {run.stdout && <pre className="whitespace-pre-wrap">{run.stdout}</pre>}
      {run.stderr && <pre className="whitespace-pre-wrap text-rose-400">{run.stderr}</pre>}
      <p className="mt-2 text-zinc-500">
        {run.timedOut ? "Timed out." : `Exited with code ${run.exitCode}`} · {run.durationMs} ms
      </p>
    </div>
  );
}
