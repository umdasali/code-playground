// MCQ practice: picking questions for a test, grading it, and keeping the record of every test in localStorage.
import { MOCK_MIX, PAPERS, QUESTIONS, questionById, questionsOf, SUBJECTS, type Question, type SubjectId } from "./mcq";

export type TestKind = "mock" | "paper" | "subject" | "quick" | "mistakes" | "retry";

export interface ActiveTest {
  id: string;
  kind: TestKind;
  title: string;
  subject?: SubjectId;
  instant: boolean; // show the right answer and explanation right after each answer
  startedAt: number;
  limitSec: number | null;
  questionIds: string[];
  answers: (number | null)[];
  flagged: boolean[];
  current: number;
}

export interface Attempt {
  id: string;
  kind: TestKind;
  title: string;
  subject?: SubjectId;
  instant: boolean;
  startedAt: number;
  finishedAt: number;
  durationSec: number;
  limitSec: number | null;
  timedOut: boolean;
  questionIds: string[];
  answers: (number | null)[];
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  score: number; // 1 mark per correct answer, no negative marking
  bySubject: Partial<Record<SubjectId, { correct: number; total: number }>>;
}

export const EXAM_MINUTES = 120;
const HISTORY_KEY = "pg:mcq:history";
const ACTIVE_KEY = "pg:mcq:active";
const MAX_HISTORY = 200;

const read = <T,>(key: string): T | null => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } };

// ---------- storage ----------

export const loadHistory = (): Attempt[] => (read<Attempt[]>(HISTORY_KEY) ?? []).filter((a) => a && Array.isArray(a.questionIds));
export function saveAttempt(a: Attempt): Attempt[] {
  const list = [a, ...loadHistory().filter((x) => x.id !== a.id)].slice(0, MAX_HISTORY);
  write(HISTORY_KEY, list);
  return list;
}
export function deleteAttempt(id: string): Attempt[] {
  const list = loadHistory().filter((a) => a.id !== id);
  write(HISTORY_KEY, list);
  return list;
}
export function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } }

export const loadActive = (): ActiveTest | null => { const t = read<ActiveTest>(ACTIVE_KEY); return t && Array.isArray(t.questionIds) && t.questionIds.length ? t : null; };
export const saveActive = (t: ActiveTest) => write(ACTIVE_KEY, t);
export function clearActive() { try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }

// ---------- what the history says about the user ----------

// For every question the user has answered: was the most recent answer right?
export function lastOutcomes(history: Attempt[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const a of [...history].reverse()) {
    a.questionIds.forEach((id, i) => {
      const q = questionById(id);
      const chosen = a.answers[i];
      if (q && chosen !== null && chosen !== undefined) out.set(id, chosen === q.answer);
    });
  }
  return out;
}

export const mistakeIds = (history: Attempt[]) => [...lastOutcomes(history)].filter(([, ok]) => !ok).map(([id]) => id);

export function summarize(history: Attempt[]) {
  const n = history.length;
  const pct = (a: Attempt) => (a.total ? (a.correct / a.total) * 100 : 0);
  const subjects: Partial<Record<SubjectId, { correct: number; answered: number }>> = {};
  for (const a of history) a.questionIds.forEach((id, i) => {
    const q = questionById(id);
    const chosen = a.answers[i];
    if (!q || chosen === null || chosen === undefined) return;
    const s = (subjects[q.subject] ??= { correct: 0, answered: 0 });
    s.answered++;
    if (chosen === q.answer) s.correct++;
  });
  const exams = history.filter((a) => a.kind === "mock" || a.kind === "paper");
  return {
    attempts: n,
    best: n ? Math.max(...history.map(pct)) : 0,
    average: n ? history.reduce((t, a) => t + pct(a), 0) / n : 0,
    bestExam: exams.length ? Math.max(...exams.map((a) => a.score)) : null,
    practised: lastOutcomes(history).size,
    subjects,
  };
}

// ---------- building a test ----------

const shuffle = <T,>(a: T[]): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

// Random questions, preferring the ones the user has seen the least so that repeated tests cover the whole bank.
function pick(pool: Question[], n: number, seen: Map<string, number>): Question[] {
  return shuffle(pool).sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0)).slice(0, n);
}

const seenCounts = (history: Attempt[]) => {
  const m = new Map<string, number>();
  for (const a of history) a.questionIds.forEach((id, i) => { if (a.answers[i] !== null && a.answers[i] !== undefined) m.set(id, (m.get(id) ?? 0) + 1); });
  return m;
};

export interface StartOptions { kind: TestKind; subject?: SubjectId; count?: number; instant?: boolean; ids?: string[]; title?: string }

export function startTest(opts: StartOptions, history: Attempt[]): ActiveTest {
  const seen = seenCounts(history);
  let ids: string[];
  let title: string;
  let limitSec: number | null = null;
  let instant = opts.instant ?? false;
  switch (opts.kind) {
    case "mock": {
      ids = shuffle(SUBJECTS.flatMap((s) => pick(questionsOf(s.id), MOCK_MIX[s.id], seen))).map((q) => q.id);
      title = "Full mock test (100 marks)";
      limitSec = EXAM_MINUTES * 60;
      instant = false;
      break;
    }
    case "paper": {
      ids = PAPERS[0].questions.map((q) => q.id);
      title = `Previous paper: ${PAPERS[0].title}`;
      limitSec = EXAM_MINUTES * 60;
      instant = false;
      break;
    }
    case "subject": {
      const pool = questionsOf(opts.subject!);
      ids = pick(pool, opts.count && opts.count > 0 ? opts.count : pool.length, seen).map((q) => q.id);
      title = `${SUBJECTS.find((s) => s.id === opts.subject)!.label} practice`;
      break;
    }
    case "quick": {
      ids = pick(QUESTIONS, opts.count ?? 10, seen).map((q) => q.id);
      title = "Quick quiz (mixed subjects)";
      instant = opts.instant ?? true;
      break;
    }
    default: {
      ids = shuffle(opts.ids ?? []);
      title = opts.title ?? (opts.kind === "mistakes" ? "Practice my mistakes" : "Retry");
    }
  }
  return {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: opts.kind, title, subject: opts.subject, instant, startedAt: Date.now(), limitSec,
    questionIds: ids, answers: ids.map(() => null), flagged: ids.map(() => false), current: 0,
  };
}

// ---------- grading ----------

export function grade(t: ActiveTest, timedOut = false): Attempt {
  const finishedAt = Date.now();
  let correct = 0, wrong = 0, skipped = 0;
  const bySubject: Attempt["bySubject"] = {};
  t.questionIds.forEach((id, i) => {
    const q = questionById(id);
    if (!q) return;
    const s = (bySubject[q.subject] ??= { correct: 0, total: 0 });
    s.total++;
    const chosen = t.answers[i];
    if (chosen === null || chosen === undefined) skipped++;
    else if (chosen === q.answer) { correct++; s.correct++; }
    else wrong++;
  });
  const elapsed = Math.round((finishedAt - t.startedAt) / 1000);
  return {
    id: t.id, kind: t.kind, title: t.title, subject: t.subject, instant: t.instant, startedAt: t.startedAt, finishedAt,
    durationSec: t.limitSec ? Math.min(elapsed, t.limitSec) : elapsed, limitSec: t.limitSec, timedOut,
    questionIds: t.questionIds, answers: t.answers, total: t.questionIds.length, correct, wrong, skipped, score: correct, bySubject,
  };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, "0"), rr = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}
