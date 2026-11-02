"use client";

import { CheckCircle2, Circle, Clock, Home, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { questionById, SUBJECTS, subjectLabel } from "@/lib/mcq";
import { formatDuration, type Attempt } from "@/lib/mcq-store";
import { Button, cn } from "./ui";

type Filter = "all" | "wrong" | "skipped" | "correct";

export const percent = (a: Attempt) => (a.total ? Math.round((a.correct / a.total) * 100) : 0);
export const bar = (p: number) => (p >= 75 ? "bg-emerald-500" : p >= 50 ? "bg-sky-500" : p >= 35 ? "bg-amber-500" : "bg-rose-500");

export default function McqResult({ attempt, onHome, onRetry }: { attempt: Attempt; onHome: () => void; onRetry: (ids: string[]) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const p = percent(attempt);

  const items = useMemo(() => attempt.questionIds.map((id, i) => {
    const q = questionById(id);
    const chosen = attempt.answers[i] ?? null;
    const state: Filter = chosen === null ? "skipped" : q && chosen === q.answer ? "correct" : "wrong";
    return { i, q, chosen, state };
  }).filter((x) => x.q), [attempt]);
  const shown = items.filter((x) => filter === "all" || x.state === filter);
  const redo = items.filter((x) => x.state !== "correct").map((x) => x.q!.id);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5 p-4">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">{attempt.title}</p>
              <p className="mt-1 text-4xl font-semibold text-white">{attempt.score}<span className="text-xl text-zinc-500"> / {attempt.total}</span></p>
              <p className="text-sm text-zinc-400">{p}% · {new Date(attempt.finishedAt).toLocaleString()}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-zinc-500">Correct</dt><dd className="font-semibold text-emerald-400">{attempt.correct}</dd></div>
              <div><dt className="text-xs text-zinc-500">Wrong</dt><dd className="font-semibold text-rose-400">{attempt.wrong}</dd></div>
              <div><dt className="text-xs text-zinc-500">Skipped</dt><dd className="font-semibold text-amber-300">{attempt.skipped}</dd></div>
              <div><dt className="flex items-center gap-1 text-xs text-zinc-500"><Clock size={11} aria-hidden />Time</dt><dd className="font-semibold text-zinc-200">{formatDuration(attempt.durationSec)}{attempt.timedOut ? " (time up)" : ""}</dd></div>
            </dl>
            <div className="ml-auto flex flex-wrap gap-2">
              {redo.length > 0 && <Button icon={RotateCcw} onClick={() => onRetry(redo)} title="Practise the questions you got wrong or skipped, with instant feedback">Retry {redo.length} missed</Button>}
              <Button variant="primary" icon={Home} onClick={onHome}>Home</Button>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Score"><div className={cn("h-full", bar(p))} style={{ width: `${p}%` }} /></div>
        </section>

        <section aria-label="Score by subject" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">By subject</h3>
          <ul className="mt-3 space-y-2">
            {SUBJECTS.filter((s) => attempt.bySubject[s.id]).map((s) => {
              const v = attempt.bySubject[s.id]!;
              const sp = Math.round((v.correct / v.total) * 100);
              return (
                <li key={s.id} className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-xs sm:grid-cols-[14rem_1fr_5rem]">
                  <span className="truncate text-zinc-300" title={s.label}>{s.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-zinc-800"><span className={cn("block h-full", bar(sp))} style={{ width: `${sp}%` }} /></span>
                  <span className="text-right font-mono text-zinc-400">{v.correct}/{v.total} · {sp}%</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Answer review">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-semibold text-zinc-200">Review your answers</h3>
            {(["all", "wrong", "skipped", "correct"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={cn("cursor-pointer rounded-md border px-2.5 py-1 text-xs capitalize transition-colors", filter === f ? "border-sky-500 bg-sky-600/20 text-white" : "border-zinc-700 text-zinc-400 hover:text-zinc-100")}>
                {f} ({f === "all" ? items.length : items.filter((x) => x.state === f).length})
              </button>
            ))}
          </div>
          <ol className="space-y-3">
            {shown.map(({ i, q, chosen, state }) => (
              <li key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {state === "correct" ? <CheckCircle2 size={15} className="text-emerald-400" aria-label="Correct" /> : state === "wrong" ? <XCircle size={15} className="text-rose-400" aria-label="Wrong" /> : <Circle size={15} className="text-amber-300" aria-label="Skipped" />}
                  <b className="text-zinc-300">Q{i + 1}</b>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-500">{subjectLabel(q!.subject)}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-100">{q!.q}</p>
                {q!.code && <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-black/50 p-2.5 font-mono text-xs text-zinc-200">{q!.code}</pre>}
                <ul className="mt-2 space-y-1">
                  {q!.options.map((o, k) => (
                    <li key={k} className={cn("flex gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                      k === q!.answer ? "border-emerald-700 bg-emerald-950/30 text-emerald-100" : k === chosen ? "border-rose-800 bg-rose-950/30 text-rose-100" : "border-transparent text-zinc-400")}>
                      <b className="w-4 shrink-0">{String.fromCharCode(65 + k)}</b><span className="min-w-0 break-words">{o}</span>
                      {k === q!.answer && <span className="ml-auto shrink-0 text-xs text-emerald-400">correct</span>}
                      {k === chosen && k !== q!.answer && <span className="ml-auto shrink-0 text-xs text-rose-400">your answer</span>}
                    </li>
                  ))}
                </ul>
                {q!.why && <p className="mt-2 text-xs leading-relaxed text-zinc-400"><b className="text-zinc-300">Why: </b>{q!.why}</p>}
              </li>
            ))}
            {shown.length === 0 && <li className="text-sm text-zinc-500">Nothing in this group.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}
