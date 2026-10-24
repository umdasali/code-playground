"use client";

import { Circle, CircleCheck, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { loadSqlJs } from "@/lib/browser-sql";
import { Maria } from "@/lib/mariadb";
import { MARIA_EXERCISES, MARIA_GROUPS, mariaExerciseById } from "@/lib/mariadblab";
import CliConsole from "./CliConsole";
import { Button, cn } from "./ui";

const TIPS = [
  "End every statement with ; (or \\G for one block per row). A statement can span several lines: the prompt changes to ->.",
  "Type help, status or exit. Outside the client (after exit) you get a shell with mysql, mysqldump and mysqladmin.",
  "This server runs on SQLite in your browser and translates MariaDB syntax, so output, errors and SHOW/DESCRIBE look like MariaDB's. Not simulated: stored procedures, triggers, views, joins that write across databases, full-text search.",
];

function start(m: Maria, id: string) {
  const ex = mariaExerciseById(id);
  m.reset();
  ex.setup(m);
}

export default function MariaDbLab() {
  const [exId, setExId] = useState(() => {
    try { const v = localStorage.getItem("pg:mariaex"); if (v && MARIA_EXERCISES.some((e) => e.id === v)) return v; } catch {}
    return MARIA_EXERCISES[0].id;
  });
  const [m, setM] = useState<Maria | null>(null); // a mutable engine: it is changed in event handlers, then `tick` re-renders
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const ex = mariaExerciseById(exId);

  useEffect(() => {
    let cancelled = false;
    loadSqlJs().then((SQL) => {
      if (cancelled) return;
      const engine = new Maria(SQL);
      start(engine, exId);
      setM(engine);
    }).catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
    // the engine is created once; changing the exercise goes through pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (id: string) => {
    setExId(id);
    try { localStorage.setItem("pg:mariaex", id); } catch {}
    if (m) { start(m, id); setTick((t) => t + 1); }
  };

  const run = (line: string) => { m?.input(line); setTick((t) => t + 1); };

  const checks = m ? ex.checks(m) : [];
  const done = checks.filter((c) => c.done).length;

  return (
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:overflow-hidden">
      <div className="space-y-4 border-zinc-800 p-4 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-500">
            Exercise
            <select value={exId} onChange={(e) => pick(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-500 focus:border-sky-500">
              {MARIA_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {MARIA_EXERCISES.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <Button icon={RotateCcw} onClick={() => pick(exId)} className="self-end" title="Start this exercise again from a fresh server">Reset</Button>
        </div>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <h2 className="text-sm font-semibold text-zinc-200">{ex.title}</h2>
          <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">{ex.brief.map((p) => <p key={p}>{p}</p>)}</div>
        </section>

        <section aria-label="Checks" className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <h3 className="flex items-center text-sm font-semibold text-zinc-200">Checks<span className="ml-auto text-xs font-normal text-zinc-400">{done} / {checks.length}</span></h3>
          <ul className="mt-2 space-y-1.5">
            {checks.map((c) => (
              <li key={c.text} className={cn("flex items-start gap-2 text-xs", c.done ? "text-emerald-300" : "text-zinc-400")}>
                {c.done ? <CircleCheck size={14} className="mt-px shrink-0" aria-label="done" /> : <Circle size={14} className="mt-px shrink-0 text-zinc-600" aria-label="not done" />}{c.text}
              </li>
            ))}
          </ul>
          {m && done === checks.length && <p className="mt-2 text-xs font-medium text-emerald-300" role="status">All checks pass. Pick the next exercise.</p>}
        </section>

        <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-200">How this works</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-4">{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      </div>

      <div className="flex min-h-[28rem] min-w-0 flex-col lg:min-h-0">
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-300">
          <span className="font-mono text-xs text-zinc-500">{m ? (m.mode === "shell" ? "student@lab (shell)" : `${m.currentUser()}@localhost (mariadb client)`) : "starting"}</span>
          <span className="ml-auto text-xs text-zinc-500">MariaDB 11.4 (simulated)</span>
        </div>
        {error ? <p className="p-4 text-sm text-rose-400" role="alert">Could not load the SQL engine: {error}</p> : !m ? (
          <p className="flex items-center gap-2 p-4 text-sm text-zinc-400"><Loader2 size={14} className="animate-spin" aria-hidden />Loading the SQL engine…</p>
        ) : (
          <CliConsole key={exId} id={`maria:${exId}`} lines={m.lines} tick={tick} prompt={m.prompt()} hints={ex.hints} label="MariaDB command line" onRun={run} />
        )}
      </div>
    </div>
  );
}
