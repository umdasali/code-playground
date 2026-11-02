"use client";

import { Award, Download, FileText, History, Play, RotateCcw, Shuffle, Target, Trash2, Trophy } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { PAPERS, QUESTIONS, questionById, questionsOf, SUBJECTS, type SubjectId } from "@/lib/mcq";
import {
  clearActive, clearHistory, deleteAttempt, EXAM_MINUTES, formatDuration, grade, loadActive, loadHistory, mistakeIds, saveActive, saveAttempt, startTest, summarize,
  type ActiveTest, type Attempt, type StartOptions,
} from "@/lib/mcq-store";
import McqResult, { bar, percent } from "./McqResult";
import McqRunner from "./McqRunner";
import { Button, cn } from "./ui";

const KIND_LABEL: Record<string, string> = { mock: "Full mock", paper: "Past paper", subject: "Subject", quick: "Quick quiz", mistakes: "Mistakes", retry: "Retry" };

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Trophy; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Icon size={13} aria-hidden />{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

export default function McqTest() {
  const [history, setHistory] = useState<Attempt[]>(() => loadHistory());
  const [active, setActive] = useState<ActiveTest | null>(() => loadActive());
  const [view, setView] = useState<"home" | "test" | "result">("home");
  const [result, setResult] = useState<Attempt | null>(null);
  const [subject, setSubject] = useState<SubjectId>("os");
  const [count, setCount] = useState(10);
  const [instant, setInstant] = useState(true);

  const stats = useMemo(() => summarize(history), [history]);
  const mistakes = useMemo(() => mistakeIds(history).filter((id) => questionById(id)), [history]);

  const start = (opts: StartOptions) => {
    if (active && !window.confirm("A test is already in progress. Starting a new one discards it. Continue?")) return;
    const t = startTest(opts, history);
    saveActive(t);
    setActive(t);
    setView("test");
  };

  const change = useCallback((t: ActiveTest) => { setActive(t); saveActive(t); }, []);

  const finish = useCallback((timedOut: boolean) => {
    if (!active) return;
    const a = grade(active, timedOut);
    setHistory(saveAttempt(a));
    clearActive();
    setActive(null);
    setResult(a);
    setView("result");
  }, [active]);

  const remove = (id: string) => { if (window.confirm("Delete this test from your record?")) setHistory(deleteAttempt(id)); };
  const wipe = () => { if (window.confirm("Delete the whole record of your tests and marks? This cannot be undone.")) { clearHistory(); setHistory([]); } };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mcq-test-record.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (view === "test" && active) return <McqRunner test={active} onChange={change} onFinish={finish} onExit={() => setView("home")} />;
  if (view === "result" && result) {
    return <McqResult attempt={result} onHome={() => setView("home")} onRetry={(ids) => start({ kind: "retry", ids, instant: true, title: `Retry: missed questions from "${result.title}"` })} />;
  }

  const subjectPool = questionsOf(subject).length;
  const card = "flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4">
        <header>
          <h1 className="text-lg font-semibold text-zinc-100">MCQ practice for the written test</h1>
          <p className="mt-1 text-sm text-zinc-500">{QUESTIONS.length} questions across eight subjects, including the 100 questions of the 2023 IIT (ISM) JTS (Computer) paper. 1 mark each, no negative marking. Every test and its marks are saved in this browser.</p>
        </header>

        {active && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100" role="status">
            <span className="min-w-0 flex-1"><b>{active.title}</b> is in progress ({active.answers.filter((a) => a !== null).length} of {active.questionIds.length} answered).</span>
            <Button variant="primary" icon={Play} onClick={() => setView("test")}>Resume</Button>
            <Button variant="danger" onClick={() => { if (window.confirm("Discard the test in progress?")) { clearActive(); setActive(null); } }}>Discard</Button>
          </div>
        )}

        <section aria-label="Your record" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat icon={History} label="Tests taken" value={String(stats.attempts)} />
          <Stat icon={Trophy} label="Best score" value={stats.attempts ? `${Math.round(stats.best)}%` : "-"} hint={stats.bestExam !== null ? `best exam: ${stats.bestExam}/100` : undefined} />
          <Stat icon={Award} label="Average score" value={stats.attempts ? `${Math.round(stats.average)}%` : "-"} />
          <Stat icon={Target} label="Questions practised" value={`${stats.practised}`} hint={`of ${QUESTIONS.length} in the bank`} />
        </section>

        <section aria-label="Start a test" className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><Shuffle size={15} className="text-sky-400" aria-hidden />Full mock test</h2>
            <p className="text-xs text-zinc-400">100 questions in the proportions of the real paper (DBMS and SQL the most, then C/C++/OOP, Linux, OS, networking), {EXAM_MINUTES} minutes, no answers shown until you submit.</p>
            <Button variant="primary" icon={Play} className="mt-auto self-start" onClick={() => start({ kind: "mock" })}>Start mock test</Button>
          </div>
          <div className={card}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><FileText size={15} className="text-amber-300" aria-hidden />Previous paper</h2>
            <p className="text-xs text-zinc-400">{PAPERS[0].title}: the 100 original questions in the original order, {EXAM_MINUTES} minutes. The answer key is worked out here, because the paper was published without one.</p>
            <Button icon={Play} className="mt-auto self-start" onClick={() => start({ kind: "paper" })}>Start the 2023 paper</Button>
          </div>

          <div className={cn(card, "md:col-span-2")}>
            <h2 className="text-sm font-semibold text-zinc-100">Practice one subject</h2>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Subject">
              {SUBJECTS.map((s) => (
                <button key={s.id} role="radio" aria-checked={subject === s.id} onClick={() => setSubject(s.id)}
                  className={cn("cursor-pointer rounded-md border px-2.5 py-1.5 text-xs transition-colors", subject === s.id ? "border-sky-500 bg-sky-600/20 text-white" : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100")}>
                  {s.label} <span className="text-zinc-500">({questionsOf(s.id).length})</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <label className="flex items-center gap-1.5">Questions
                <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-8 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-zinc-100 outline-none focus:border-sky-500">
                  {[10, 20, 30, 50].filter((n) => n < subjectPool).map((n) => <option key={n} value={n}>{n}</option>)}
                  <option value={0}>All {subjectPool}</option>
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={instant} onChange={(e) => setInstant(e.target.checked)} className="h-3.5 w-3.5 accent-sky-500" />Show the answer and explanation after each question</label>
              <Button variant="primary" icon={Play} className="ml-auto" onClick={() => start({ kind: "subject", subject, count: count === 0 || count >= subjectPool ? 0 : count, instant })}>Start practice</Button>
            </div>
          </div>

          <div className={card}>
            <h2 className="text-sm font-semibold text-zinc-100">Quick quiz</h2>
            <p className="text-xs text-zinc-400">10 mixed questions with instant feedback. Questions you have seen the least come first.</p>
            <Button icon={Play} className="mt-auto self-start" onClick={() => start({ kind: "quick", count: 10, instant: true })}>Start quick quiz</Button>
          </div>
          <div className={card}>
            <h2 className="text-sm font-semibold text-zinc-100">Practice my mistakes</h2>
            <p className="text-xs text-zinc-400">{mistakes.length ? `${mistakes.length} question${mistakes.length === 1 ? "" : "s"} you answered wrongly the last time you saw them.` : "Nothing yet: questions you get wrong will collect here."}</p>
            <Button icon={RotateCcw} className="mt-auto self-start" disabled={mistakes.length === 0} onClick={() => start({ kind: "mistakes", ids: mistakes, instant: true })}>Practice mistakes{mistakes.length ? ` (${mistakes.length})` : ""}</Button>
          </div>
        </section>

        {Object.keys(stats.subjects).length > 0 && (
          <section aria-label="Accuracy by subject" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="text-sm font-semibold text-zinc-100">Your accuracy by subject</h2>
            <ul className="mt-3 space-y-2">
              {SUBJECTS.filter((s) => stats.subjects[s.id]).map((s) => {
                const v = stats.subjects[s.id]!;
                const p = Math.round((v.correct / v.answered) * 100);
                return (
                  <li key={s.id} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-3 text-xs sm:grid-cols-[14rem_1fr_7rem]">
                    <span className="truncate text-zinc-300" title={s.label}>{s.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-zinc-800"><span className={cn("block h-full", bar(p))} style={{ width: `${p}%` }} /></span>
                    <span className="text-right font-mono text-zinc-400">{p}% of {v.answered}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-label="Test record">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-semibold text-zinc-100">Record of tests ({history.length})</h2>
            <Button size="sm" icon={Download} onClick={exportJson} disabled={history.length === 0}>Export</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={wipe} disabled={history.length === 0}>Clear record</Button>
          </div>
          {history.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">No tests yet. Your marks, time taken and answers will be listed here.</p> : (
            <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
              {history.map((a) => {
                const p = percent(a);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="truncate text-zinc-200" title={a.title}>{a.title}</div>
                      <div className="text-xs text-zinc-500">{new Date(a.finishedAt).toLocaleString()} · {KIND_LABEL[a.kind]} · {formatDuration(a.durationSec)}</div>
                    </div>
                    <div className="w-28 text-right">
                      <div className="font-mono text-zinc-100">{a.score}/{a.total} <span className="text-zinc-500">({p}%)</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className={cn("h-full", bar(p))} style={{ width: `${p}%` }} /></div>
                    </div>
                    <Button size="sm" onClick={() => { setResult(a); setView("result"); }}>Review</Button>
                    <button onClick={() => remove(a.id)} aria-label="Delete this test from the record" title="Delete" className="cursor-pointer rounded p-1.5 text-zinc-600 transition-colors hover:text-rose-400"><Trash2 size={14} aria-hidden /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
