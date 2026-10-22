"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, GROUPS, type CommandRef } from "@/lib/commands";

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
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const ws = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    ws.current?.close();
    const port = process.env.NEXT_PUBLIC_TERMINAL_PORT ?? "3001";
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
      fontFamily: "var(--font-geist-mono), Menlo, Consolas, monospace",
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

  const dot = status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-400" : "bg-rose-500";

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 p-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search commands…"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto text-sm">
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className="sticky top-0 bg-zinc-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{g}</div>
              {list.map((c) => (
                <div key={c.name} className="border-b border-zinc-900">
                  <button onClick={() => setOpen(open === c.name ? null : c.name)} className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-zinc-900">
                    <code className="text-sky-400">{c.name}</code>
                    <span className="truncate text-xs text-zinc-400">{c.summary}</span>
                  </button>
                  {open === c.name && (
                    <div className="space-y-1 bg-zinc-900/50 px-3 pb-2">
                      {c.examples.map((ex) => (
                        <button key={ex.cmd} onClick={() => send(ex.cmd)} title="Run in terminal" className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-800">
                          <code className="block break-all text-xs text-emerald-300">$ {ex.cmd}</code>
                          <span className="text-[11px] text-zinc-500">{ex.note}</span>
                        </button>
                      ))}
                      {c.c && (
                        <button onClick={() => openInC(c.c!)} className="mt-1 rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">Open C example in C tab →</button>
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
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span>{STATUS_LABEL[status]}</span>
          {status === "error" && <span className="text-zinc-500">· run <code>npm run dev</code> (starts it with the app)</span>}
          <div className="ml-auto flex gap-2">
            {status !== "connected" && status !== "connecting" && <button onClick={reconnect} className="rounded bg-sky-600 px-2 py-0.5 text-white hover:bg-sky-500">Reconnect</button>}
            <button onClick={resetFiles} className="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800">Reset files</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <div ref={host} className="h-full w-full" />
        </div>
      </section>
    </div>
  );
}
