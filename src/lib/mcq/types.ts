export type SubjectId = "os" | "coa" | "net" | "cpp" | "db" | "web" | "php" | "linux";

export interface Subject { id: SubjectId; label: string; short: string }

export const SUBJECTS: Subject[] = [
  { id: "os", label: "Operating System", short: "OS" },
  { id: "coa", label: "Computer Organization & Architecture", short: "COA" },
  { id: "net", label: "Computer Networking", short: "Networking" },
  { id: "cpp", label: "C, C++ & OOP", short: "C/C++/OOP" },
  { id: "db", label: "DBMS, MariaDB & MySQL", short: "DBMS/SQL" },
  { id: "web", label: "HTML, CSS & JavaScript", short: "Web" },
  { id: "php", label: "PHP", short: "PHP" },
  { id: "linux", label: "Linux Commands", short: "Linux" },
];

export const subjectLabel = (id: SubjectId) => SUBJECTS.find((s) => s.id === id)!.label;

export interface Question {
  id: string;
  subject: SubjectId;
  q: string;
  code?: string; // a program or table shown above the options
  options: string[];
  answer: number; // index into options
  why?: string;
  paper?: string; // set for questions that come from a real question paper
}

type Letter = "A" | "B" | "C" | "D";
type Options = [string, string, string, string];

// question, options, correct letter, optional explanation, optional code block
export type Row = [q: string, options: Options, answer: Letter, why?: string, code?: string];
export type PaperRow = [subject: SubjectId, ...Row];

const index = (l: Letter) => "ABCD".indexOf(l);

// Options such as "Both" or "None of the above" only make sense in the position they were written in.
const POSITIONAL = /^(both|none|neither|all of)/i;

// A small deterministic generator, so the shuffled order of an option list never changes between page loads.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleOptions(options: string[], answer: number, seed: number): { options: string[]; answer: number } {
  if (options.some((o) => POSITIONAL.test(o))) return { options, answer };
  const rand = mulberry32(seed);
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { options: order.map((i) => options[i]), answer: order.indexOf(answer) };
}

export function build(subject: SubjectId, prefix: string, rows: Row[]): Question[] {
  return rows.map(([q, options, answer, why, code], i) => {
    const seed = [...prefix].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) + i * 7919;
    const s = shuffleOptions(options, index(answer), seed);
    return { id: `${prefix}${i + 1}`, subject, q, options: s.options, answer: s.answer, why, code };
  });
}

export function buildPaper(paper: string, prefix: string, rows: PaperRow[]): Question[] {
  return rows.map(([subject, q, options, answer, why, code], i) => ({ id: `${prefix}${i + 1}`, subject, q, options, answer: index(answer), why, code, paper }));
}
