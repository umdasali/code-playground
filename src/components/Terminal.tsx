"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { Process } from "@wasmer/sdk";
import { ChevronRight, ExternalLink, PanelLeftClose, PanelLeftOpen, Play, PlugZap, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, GROUPS, type CommandRef } from "@/lib/commands";
import { resetShell, startShell } from "@/lib/wasm";
import { Button, cn } from "./ui";

type Status = "loading" | "connected" | "ended" | "error";

export default function Terminal({ openInC }: { openInC: (code: string) => void }) {
  const [status, setStatus] = useState<Status>("loading");
  const [progress, setProgress] = useState<{ message: string; percent: number | null } | null>({ message: "Starting…", percent: null });
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>("ls");
  // On narrow screens the reference is a full-width panel you toggle; on large screens it is always docked.
  const [refOpen, setRefOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const proc = useRef<Process | null>(null);
  const generation = useRef(0);
  // A resize sent while bash is still starting up can kill it, so resizes wait for the first output and are debounced.
  const shellReady = useRef(false);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(async () => {
    const t = term.current;
    if (!t) return;
    const mine = ++generation.current;
    proc.current?.kill().catch(() => {});
    proc.current = null;
    shellReady.current = false;
    setStatus("loading");
    setProgress({ message: "Starting…", percent: null });
    try {
      const p = await startShell(t.cols, t.rows, (message, percent) => { if (mine === generation.current) setProgress({ message, percent }); });
      if (mine !== generation.current) { p.kill().catch(() => {}); return; }
      proc.current = p;
      t.reset();
      setStatus("connected");
      setProgress(null);
      t.focus();
      const pump = async (stream: AsyncIterable<Uint8Array> | null) => {
        if (!stream) return;
        for await (const chunk of stream) {
          t.write(chunk);
          if (!shellReady.current && mine === generation.current) {
            shellReady.current = true;
            proc.current?.resizeTerminal(t.cols, t.rows); // catch up with any layout change during startup
          }
        }
      };
      void pump(p.stdout);
      void pump(p.stderr);
      void p.wait({ check: false }).then(() => { if (proc.current === p) setStatus("ended"); });
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const t = new XTerm({
      cursorBlink: true, fontSize: 14, scrollback: 5000,
      convertEol: true, // the WebAssembly TTY emits bare "\n"
      fontFamily: "Menlo, Monaco, Consolas, \"Courier New\", monospace", lineHeight: 1.2,
      theme: { background: "#09090b", foreground: "#e4e4e7", cursor: "#38bdf8", selectionBackground: "#3f3f46" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    f.fit();
    term.current = t;
    fit.current = f;

    t.onData((d) => { void proc.current?.stdin?.write(d); });
    t.onResize(({ cols, rows }) => {
      if (!shellReady.current) return;
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => proc.current?.resizeTerminal(cols, rows), 150);
    });
    const ro = new ResizeObserver(() => { try { f.fit(); } catch {} });
    ro.observe(host.current!);

    const boot = setTimeout(() => void start(), 0);
    return () => {
      clearTimeout(boot);
      ro.disconnect();
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a plain counter, not a DOM ref
      generation.current++;
      proc.current?.kill().catch(() => {});
      proc.current = null;
      t.dispose();
    };
  }, [start]);

  // Typing into the terminal for the user: clear the current input line (Ctrl+U), then run the command.
  const send = (cmd: string) => {
    setRefOpen(false);
    if (!proc.current?.stdin) return;
    void proc.current.stdin.write(`\x15${cmd}\r`);
    term.current?.focus();
  };

  const resetFiles = async () => {
    if (!confirm("Delete your changes and restore the starting files?")) return;
    generation.current++;
    proc.current?.kill().catch(() => {});
    proc.current = null;
    await resetShell();
    void start();
  };

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? COMMANDS.filter((c) => c.name.includes(f) || c.summary.toLowerCase().includes(f)) : COMMANDS;
    return GROUPS.map((g) => [g, list.filter((c) => c.group === g)] as [string, CommandRef[]]).filter(([, l]) => l.length);
  }, [filter]);

  const dot = status === "connected" ? "bg-emerald-500" : status === "loading" ? "animate-pulse bg-amber-400" : "bg-rose-500";

  return (
    <div className="relative flex min-h-0 flex-1">
      <aside className={cn("absolute inset-0 z-10 flex-col border-zinc-800 bg-zinc-950 lg:static lg:flex lg:w-80 lg:shrink-0 lg:border-r", refOpen ? "flex" : "hidden")}>
        <label className="relative block border-b border-zinc-800 p-2">
          <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search commands…" aria-label="Search commands"
            className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 pl-8 pr-2 text-xs outline-none transition-colors hover:border-zinc-500 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400/40" />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto text-sm">
          {groups.length === 0 && <p className="p-4 text-xs text-zinc-500">No commands match “{filter}”.</p>}
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className="sticky top-0 z-10 bg-zinc-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{g}</div>
              {list.map((c) => (
                <div key={c.name} className="border-b border-zinc-900">
                  <button onClick={() => setOpen(open === c.name ? null : c.name)} aria-expanded={open === c.name}
                    className="group flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-900 active:bg-zinc-800">
                    <ChevronRight size={13} className={cn("shrink-0 text-zinc-600 transition-transform duration-150 group-hover:text-zinc-300", open === c.name && "rotate-90")} aria-hidden />
                    <code className="text-sky-400">{c.name}</code>
                    <span className="truncate text-xs text-zinc-400">{c.summary}</span>
                  </button>
                  {open === c.name && (
                    <div className="space-y-1 bg-zinc-900/50 px-3 pb-2">
                      {c.examples.map((ex) => (
                        <button key={ex.cmd} onClick={() => send(ex.cmd)} title="Run in the terminal"
                          className="group flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800 active:bg-zinc-700">
                          <Play size={12} className="mt-0.5 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-400" aria-hidden />
                          <span className="min-w-0">
                            <code className="block break-all text-xs text-emerald-300">{ex.cmd}</code>
                            <span className="text-[11px] text-zinc-500">{ex.note}</span>
                          </span>
                        </button>
                      ))}
                      {c.c && (
                        <Button size="sm" icon={ExternalLink} className="mt-1" onClick={() => openInC(c.c!)}
                          title={c.cRuns === false ? "WebAssembly has no fork/exec/pipe, so this program cannot run in the browser" : undefined}>
                          {c.cRuns === false ? "Open C example (reference only)" : "Open C example in C tab"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[#09090b]">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-400">
          <Button size="sm" className="lg:hidden" icon={refOpen ? PanelLeftClose : PanelLeftOpen} onClick={() => setRefOpen((o) => !o)} aria-expanded={refOpen}>
            {refOpen ? "Hide commands" : "Commands"}
          </Button>
          <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
          <span role="status" className="min-w-0 truncate">
            {status === "loading" && (progress?.message ?? "Starting…")}
            {status === "connected" && "Connected · files live in this tab until you reload"}
            {status === "ended" && "Shell ended"}
            {status === "error" && "Could not start the shell"}
          </span>
          {status === "loading" && progress?.percent != null && (
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={Math.round(progress.percent)}>
              <span className="block h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {(status === "ended" || status === "error") && <Button size="sm" variant="primary" icon={PlugZap} onClick={() => void start()}>Restart shell</Button>}
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => void resetFiles()} iconOnlyOnSmall title="Restore the starting files">Reset files</Button>
          </div>
        </div>
        {status === "error" && <p className="border-b border-rose-900/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">{error}</p>}
        <div className="min-h-0 flex-1 p-2">
          <div ref={host} className="h-full w-full" />
        </div>
      </section>
    </div>
  );
}
