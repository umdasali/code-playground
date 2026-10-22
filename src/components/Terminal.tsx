"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink, PanelLeftClose, PanelLeftOpen, Play, PlugZap, Search, Trash2 } from "lucide-react";
import { COMMANDS, GROUPS, type CommandRef } from "@/lib/commands";
import { Button, cn } from "./ui";

type Status = "connecting" | "connected" | "ended" | "error";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

function termSession() {
  let id = store.get("pg:term-session");
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomUUID().replaceAll("-", "");
    store.set("pg:term-session", id);
  }
  return id;
}

const STATUS_LABEL: Record<Status, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  ended: "Shell ended",
  error: "Cannot reach terminal server",
};

export default function Terminal({ openInC }: { openInC: (code: string) => void }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>("ls");
  // On narrow screens the reference is a full-width panel you toggle; on large screens it is always docked.
  const [refOpen, setRefOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const ws = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    ws.current?.close();
    const port = 3001; // must match PORT in server/terminal-server.mjs
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.hostname}:${port}/?session=${termSession()}`);
    ws.current = sock;
    let opened = false;
    sock.onopen = () => {
      opened = true;
      setStatus("connected");
      const t = term.current;
      if (t) {
        t.reset();
        sock.send(JSON.stringify({ t: "r", cols: t.cols, rows: t.rows }));
        t.focus();
      }
    };
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.t === "o") term.current?.write(m.d);
      else if (m.t === "exit") setStatus("ended");
    };
    sock.onclose = () => {
      if (ws.current !== sock) return; // replaced by a newer connection
      setStatus((s) => (s === "ended" ? s : opened ? "ended" : "error"));
    };
  }, []);

  useEffect(() => {
    const t = new XTerm({
      cursorBlink: true, fontSize: 14, scrollback: 5000,
      fontFamily: "Menlo, Monaco, Consolas, \"Courier New\", monospace", lineHeight: 1.2,
      theme: { background: "#09090b", foreground: "#e4e4e7", cursor: "#38bdf8", selectionBackground: "#3f3f46" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    f.fit();
    term.current = t;
    fit.current = f;

    t.onData((d) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "i", d })); });
    t.onResize(({ cols, rows }) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "r", cols, rows })); });
    const ro = new ResizeObserver(() => { try { f.fit(); } catch {} });
    ro.observe(host.current!);

    connect();
    return () => {
      ro.disconnect();
      const sock = ws.current;
      ws.current = null;
      sock?.close();
      t.dispose();
    };
  }, [connect]);

  // Typing into the terminal for the user: clear the current input line (Ctrl+U), then run the command.
  const send = (cmd: string) => {
    setRefOpen(false);
    if (ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({ t: "i", d: `\x15${cmd}\r` }));
    term.current?.focus();
  };

  const reconnect = () => { setStatus("connecting"); connect(); };
  const resetFiles = () => {
    if (!confirm("Delete your changes and restore the starting files?")) return;
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "reset" }));
    setStatus("connecting");
    setTimeout(connect, 400);
  };

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? COMMANDS.filter((c) => c.name.includes(f) || c.summary.toLowerCase().includes(f)) : COMMANDS;
    return GROUPS.map((g) => [g, list.filter((c) => c.group === g)] as [string, CommandRef[]]).filter(([, l]) => l.length);
  }, [filter]);

  const dot = status === "connected" ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-amber-400" : "bg-rose-500";

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
                      {c.c && <Button size="sm" icon={ExternalLink} className="mt-1" onClick={() => openInC(c.c!)}>Open C example in C tab</Button>}
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
          <span role="status">{STATUS_LABEL[status]}</span>
          {status === "error" && <span className="hidden text-zinc-500 sm:inline">· start it with <code>npm run dev</code></span>}
          <div className="ml-auto flex gap-2">
            {status !== "connected" && status !== "connecting" && <Button size="sm" variant="primary" icon={PlugZap} onClick={reconnect}>Reconnect</Button>}
            <Button size="sm" variant="danger" icon={Trash2} onClick={resetFiles} iconOnlyOnSmall title="Restore the starting files">Reset files</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <div ref={host} className="h-full w-full" />
        </div>
      </section>
    </div>
  );
}
