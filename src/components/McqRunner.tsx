"use client";

import { ChevronLeft, ChevronRight, Clock, Flag, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { questionById, subjectLabel } from "@/lib/mcq";
import { formatDuration, type ActiveTest } from "@/lib/mcq-store";
import { Button, cn } from "./ui";

interface Props {
  test: ActiveTest;
  onChange: (t: ActiveTest) => void;
  onFinish: (timedOut: boolean) => void;
  onExit: () => void;
}

export default function McqRunner({ test, onChange, onFinish, onExit }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - test.startedAt) / 1000));
  const remaining = test.limitSec === null ? null : test.limitSec - elapsed;

  // Time is up: hand in whatever has been answered.
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !done.current) { done.current = true; onFinish(true); }
  }, [remaining, onFinish]);

  const i = test.current;
  const q = questionById(test.questionIds[i]);
  const chosen = test.answers[i];
  const locked = test.instant && chosen !== null;
  const answered = test.answers.filter((a) => a !== null).length;

  const set = (patch: Partial<ActiveTest>) => onChange({ ...test, ...patch });
  const go = (n: number) => set({ current: Math.min(test.questionIds.length - 1, Math.max(0, n)) });
  const choose = (opt: number) => {
    if (locked) return;
    set({ answers: test.answers.map((a, k) => (k === i ? opt : a)) });
  };
  const clear = () => { if (!locked) set({ answers: test.answers.map((a, k) => (k === i ? null : a)) }); };
  const flag = () => set({ flagged: test.flagged.map((f, k) => (k === i ? !f : f)) });

  const submit = () => {
    const left = test.questionIds.length - answered;
    const msg = left ? `You have ${left} unanswered question${left === 1 ? "" : "s"}. Submit the test anyway?` : "Submit the test now?";
    if (window.confirm(msg)) { done.current = true; onFinish(false); }
  };

  // Keyboard: A-D or 1-4 answer, arrows move, F flags.
  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    handler.current = (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const opt = "abcd".indexOf(k) >= 0 ? "abcd".indexOf(k) : "1234".indexOf(k);
      if (opt >= 0 && q && opt < q.options.length) { choose(opt); e.preventDefault(); }
      else if (k === "arrowright" || k === "n") go(i + 1);
      else if (k === "arrowleft" || k === "p") go(i - 1);
      else if (k === "f") flag();
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => handler.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const lowTime = remaining !== null && remaining < 300;
  const palette = useMemo(() => test.questionIds.map((_, k) => k), [test.questionIds]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-200">{test.title}</span>
        <span className="text-xs text-zinc-500">{answered} / {test.questionIds.length} answered</span>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-sm", lowTime ? "border-rose-700 bg-rose-950/40 text-rose-300" : "border-zinc-700 text-zinc-200")} role="timer" aria-label={remaining === null ? "Time spent" : "Time left"}>
          <Clock size={14} aria-hidden />{formatDuration(remaining ?? elapsed)}{remaining === null && <span className="font-sans text-[10px] text-zinc-500">elapsed</span>}
        </span>
        <Button size="sm" icon={X} onClick={() => { if (window.confirm("Leave this test? It stays saved, and you can resume it from the home screen.")) onExit(); }} iconOnlyOnSmall>Leave</Button>
        <Button size="sm" variant="primary" icon={Send} onClick={submit}>Submit</Button>
      </div>

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_17rem] lg:overflow-hidden">
        <section className="min-w-0 space-y-4 p-4 lg:overflow-y-auto" aria-live="polite">
          {!q ? <p className="text-sm text-zinc-400">This question is no longer in the bank. Use Next to continue.</p> : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="font-semibold text-zinc-300">Question {i + 1} of {test.questionIds.length}</span>
                <span className="rounded-full border border-zinc-700 px-2 py-0.5">{subjectLabel(q.subject)}</span>
                {q.paper && <span className="rounded-full border border-amber-800/60 px-2 py-0.5 text-amber-300">Previous paper</span>}
                {test.flagged[i] && <span className="inline-flex items-center gap-1 text-amber-300"><Flag size={12} aria-hidden />Marked for review</span>}
              </div>
              <h2 className="text-base leading-relaxed text-zinc-100">{q.q}</h2>
              {q.code && <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-black/50 p-3 font-mono text-xs leading-relaxed text-zinc-200">{q.code}</pre>}
              <div role="radiogroup" aria-label="Options" className="space-y-2">
                {q.options.map((o, k) => {
                  const picked = chosen === k;
                  const showRight = locked && k === q.answer;
                  const showWrong = locked && picked && k !== q.answer;
                  return (
                    <button key={k} role="radio" aria-checked={picked} onClick={() => choose(k)} disabled={locked && !picked && !showRight}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default",
                        showRight ? "border-emerald-500 bg-emerald-500/15 text-emerald-100" : showWrong ? "border-rose-500 bg-rose-500/15 text-rose-100"
                          : picked ? "border-sky-500 bg-sky-600/20 text-white" : "border-zinc-700 bg-zinc-900/40 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800/60",
                        locked && !picked && !showRight && "opacity-60",
                      )}>
                      <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold", picked || showRight ? "border-current" : "border-zinc-600 text-zinc-400")}>{String.fromCharCode(65 + k)}</span>
                      <span className="min-w-0 break-words pt-0.5">{o}</span>
                    </button>
                  );
                })}
              </div>
              {locked && (
                <p className={cn("rounded-lg border p-3 text-sm", chosen === q.answer ? "border-emerald-800 bg-emerald-950/30 text-emerald-200" : "border-rose-900 bg-rose-950/30 text-rose-200")} role="status">
                  <b>{chosen === q.answer ? "Correct." : `Not quite. The answer is ${String.fromCharCode(65 + q.answer)}.`}</b>{q.why ? ` ${q.why}` : ""}
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button icon={ChevronLeft} onClick={() => go(i - 1)} disabled={i === 0}>Previous</Button>
            <Button onClick={() => go(i + 1)} disabled={i === test.questionIds.length - 1}>Next<ChevronRight size={15} aria-hidden /></Button>
            <Button icon={Flag} onClick={flag} title="Mark for review (F)">{test.flagged[i] ? "Unmark" : "Mark for review"}</Button>
            <Button variant="ghost" onClick={clear} disabled={locked || chosen === null}>Clear answer</Button>
            <span className="ml-auto hidden text-[11px] text-zinc-500 md:inline">Keys: A-D answer, ← → move, F mark</span>
          </div>
        </section>

        <aside aria-label="Question palette" className="border-t border-zinc-800 p-3 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Questions</p>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-5">
            {palette.map((k) => (
              <button key={k} onClick={() => go(k)} aria-label={`Question ${k + 1}${test.answers[k] !== null ? ", answered" : ""}${test.flagged[k] ? ", marked" : ""}`} aria-current={k === i ? "true" : undefined}
                className={cn("relative h-8 cursor-pointer rounded-md border text-xs font-medium transition-colors",
                  test.answers[k] !== null ? "border-sky-600 bg-sky-600/30 text-white" : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500",
                  k === i && "ring-2 ring-white/70", test.flagged[k] && "border-amber-500")}>
                {k + 1}
                {test.flagged[k] && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-[11px] text-zinc-500">
            <li><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-600/60 align-middle" />answered</li>
            <li><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border border-zinc-600 align-middle" />not answered</li>
            <li><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-amber-400 align-middle" />marked for review</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
