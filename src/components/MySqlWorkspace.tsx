"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { resetLocal, runLocal, seedLocal } from "@/lib/browser-sql";
import { EXERCISES, SAMPLE_TABLES } from "@/lib/sample-data";
import { BookOpen, Database, Eraser, Play, RefreshCw, RotateCcw, Sparkles, Table2, TableProperties, Terminal as TerminalIcon } from "lucide-react";
import { Button, cn, SelectBox } from "./ui";
import SqlResults, { type SqlResult } from "./SqlResults";

type Engine = "browser" | "server";
type Kind = "ddl" | "dml";

const STARTERS: Record<Kind, string> = {
  ddl: `-- DDL: define structure (CREATE / ALTER / DROP)
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  grade INT
);
`,
  dml: `-- DML: work with data (INSERT / UPDATE / DELETE / SELECT)
INSERT INTO students (id, name, grade) VALUES (1, 'Asha', 90), (2, 'Ben', 75);
SELECT * FROM students;
`,
};

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

function sessionId() {
  let id = store.get("pg:session");
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomUUID().replaceAll("-", "");
    store.set("pg:session", id);
  }
  return id;
}

const quote = (engine: Engine, name: string) =>
  engine === "browser" ? `"${name.replaceAll('"', '""')}"` : `\`${name.replaceAll("`", "``")}\``;

async function exec(engine: Engine, query: string): Promise<{ results?: SqlResult[]; error?: string }> {
  try {
    if (engine === "browser") return { results: await runLocal(query) };
    const res = await fetch("/api/sql", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId(), query }),
    });
    return await res.json();
  } catch (e) {
    return { error: (e as Error).message || "Request failed." };
  }
}

export default function MySqlWorkspace() {
  const [engine, setEngine] = useState<Engine>(() => (store.get("pg:engine") === "server" ? "server" : "browser"));
  const [code, setCode] = useState<Record<Kind, string>>(() => ({
    ddl: store.get("pg:code:mysql-ddl") ?? STARTERS.ddl,
    dml: store.get("pg:code:mysql-dml") ?? STARTERS.dml,
  }));
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ label: string; results?: SqlResult[]; error?: string } | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<{ schema?: SqlResult; data?: SqlResult; error?: string } | null>(null);

  const refreshTables = useCallback(async () => {
    const q = engine === "browser"
      ? "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      : "SHOW TABLES";
    const r = await exec(engine, q);
    const names = (r.results?.[0]?.rows ?? []).map((row) => String(row[0]));
    setTables(names);
    setSelected((cur) => (cur && names.includes(cur) ? cur : names[0] ?? null));
  }, [engine]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      const q = quote(engine, selected);
      const schema = await exec(engine, engine === "browser" ? `PRAGMA table_info(${q})` : `DESCRIBE ${q}`);
      const data = await exec(engine, `SELECT * FROM ${q} LIMIT 100`);
      if (!cancelled) setView({ schema: schema.results?.[0], data: data.results?.[0], error: schema.error ?? data.error });
    })();
    return () => { cancelled = true; };
  }, [selected, engine, tables]);

  useEffect(() => {
    const t = setTimeout(() => void refreshTables(), 0);
    return () => clearTimeout(t);
  }, [refreshTables]);

  const run = useCallback(async (kind: Kind) => {
    setBusy(true);
    const r = await exec(engine, code[kind]);
    setOutput({ label: kind.toUpperCase(), ...r });
    await refreshTables();
    setBusy(false);
  }, [engine, code, refreshTables]);

  const admin = async (action: "seed" | "reset") => {
    setBusy(true);
    let error: string | undefined;
    try {
      if (engine === "browser") await (action === "seed" ? seedLocal() : resetLocal());
      else {
        const res = await fetch("/api/sql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionId(), action }) });
        error = (await res.json()).error;
      }
    } catch (e) { error = (e as Error).message; }
    setOutput({ label: action === "seed" ? "Sample data" : "Reset", error, results: error ? undefined : [{ columns: [], rows: [], truncated: false, info: action === "seed" ? `Sample data loaded: ${SAMPLE_TABLES}.` : "Database reset." }] });
    await refreshTables();
    setBusy(false);
  };

  // Monaco keeps the first handler it is given, so route through a ref to always call the latest run().
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });
  const mount = (kind: Kind): OnMount => (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runRef.current(kind));
  };

  const edit = (kind: Kind, v: string) => {
    setCode((c) => ({ ...c, [kind]: v }));
    store.set(`pg:code:mysql-${kind}`, v);
  };

  const pane = "flex min-h-[18rem] min-w-0 flex-col border-zinc-800 lg:min-h-0";
  const title = "flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400";
  const editorOpts = { minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true } as const;

  const editorPane = (kind: Kind, heading: string) => (
    <section className={cn(pane, "border-b lg:border-r")}>
      <div className={title}>
        <Database size={13} aria-hidden />
        {heading}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" icon={RotateCcw} onClick={() => edit(kind, STARTERS[kind])} iconOnlyOnSmall title="Restore the starter SQL">Reset</Button>
          <Button size="sm" variant="primary" icon={Play} loading={busy} onClick={() => void run(kind)} title="Run (Ctrl/⌘ + Enter)">
            <span className="normal-case tracking-normal">Run {kind.toUpperCase()}</span>
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor height="100%" theme="vs-dark" language="sql" path={`mysql-${kind}`} value={code[kind]}
          onChange={(v) => edit(kind, v ?? "")} onMount={mount(kind)} options={editorOpts} />
      </div>
    </section>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <SelectBox icon={Database} value={engine} aria-label="Database engine"
          onChange={(e) => { const v = e.target.value as Engine; setEngine(v); store.set("pg:engine", v); setOutput(null); }}>
          <option value="browser">Browser (SQLite · IndexedDB)</option>
          <option value="server">Server (MySQL)</option>
        </SelectBox>
        <Button icon={Sparkles} disabled={busy} onClick={() => void admin("seed")} iconOnlyOnSmall title="Load the sample shop and company tables">Load sample data</Button>
        <Button variant="danger" icon={Eraser} disabled={busy} onClick={() => void admin("reset")} iconOnlyOnSmall title="Drop everything and start empty">Reset DB</Button>
        <SelectBox icon={BookOpen} value="" aria-label="Practice queries"
          onChange={(e) => { const ex = EXERCISES[Number(e.target.value)]; if (ex) edit("dml", `-- ${ex.title}\n${ex.sql}\n`); }}>
          <option value="">Practice queries…</option>
          {EXERCISES.map((ex, i) => <option key={i} value={i}>{ex.title}</option>)}
        </SelectBox>
        <span className="ml-auto hidden text-[11px] text-zinc-500 xl:inline">Ctrl/⌘ + Enter runs the focused editor</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden">
        {editorPane("ddl", "1 · DDL")}
        {editorPane("dml", "2 · DML")}

        <section className={cn(pane, "border-b lg:border-r lg:border-b-0")}>
          <div className={title}>
            <Table2 size={13} aria-hidden />3 · Table view
            <Button size="sm" className="ml-auto" icon={RefreshCw} onClick={() => void refreshTables()} iconOnlyOnSmall title="Reload the table list">Refresh</Button>
          </div>
          <div className="flex min-h-0 flex-1">
            <ul className="w-32 shrink-0 overflow-y-auto border-r border-zinc-800 text-sm sm:w-40">
              {tables.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500">No tables yet. Run some DDL.</li>}
              {tables.map((t) => (
                <li key={t}>
                  <button onClick={() => setSelected(t)} title={t}
                    className={cn("flex w-full cursor-pointer items-center gap-1.5 border-l-2 px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-900 active:bg-zinc-800",
                      t === selected ? "border-sky-500 bg-zinc-900 text-sky-400" : "border-transparent text-zinc-300")}>
                    <TableProperties size={13} className="shrink-0" aria-hidden /><span className="truncate">{t}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0 flex-1 space-y-3 overflow-auto p-3 font-mono text-xs">
              {selected && view?.error && <p className="text-rose-400">{view.error}</p>}
              {selected && view?.schema && <div><p className="mb-1 text-zinc-500">Structure</p><SqlResults results={[view.schema]} /></div>}
              {selected && view?.data && <div><p className="mb-1 text-zinc-500">Data (first 100 rows)</p><SqlResults results={[view.data]} /></div>}
            </div>
          </div>
        </section>

        <section className={pane}>
          <div className={title}><TerminalIcon size={13} aria-hidden />4 · Output{output ? ` — ${output.label}` : ""}</div>
          <div className="min-h-0 flex-1 overflow-auto bg-black/40 p-3 font-mono text-xs">
            {!output && <span className="text-zinc-500">Run DDL or DML and the result appears here.</span>}
            {output?.error && <pre className="whitespace-pre-wrap text-rose-400">{output.error}</pre>}
            {output?.results && <SqlResults results={output.results} />}
          </div>
        </section>
      </div>
    </div>
  );
}
