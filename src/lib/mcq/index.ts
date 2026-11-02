// The question bank: the real 2023 JTS paper (100 questions) plus original questions for every subject.
import { COA_QUESTIONS } from "./coa";
import { CPP_QUESTIONS } from "./cpp";
import { DB_QUESTIONS } from "./db";
import { JTS_2023 } from "./jts2023";
import { LINUX_QUESTIONS } from "./linux";
import { NET_QUESTIONS } from "./net";
import { OS_QUESTIONS } from "./os";
import { PHP_QUESTIONS } from "./php";
import type { Question, SubjectId } from "./types";
import { WEB_QUESTIONS } from "./web";

export { SUBJECTS, subjectLabel, type Question, type SubjectId } from "./types";

export const PAPERS = [{ id: "jts2023", title: "IIT (ISM) Dhanbad JTS (Computer), 27 Oct 2023", questions: JTS_2023 }];

export const QUESTIONS: Question[] = [
  ...JTS_2023, ...OS_QUESTIONS, ...COA_QUESTIONS, ...NET_QUESTIONS, ...CPP_QUESTIONS, ...DB_QUESTIONS, ...WEB_QUESTIONS, ...PHP_QUESTIONS, ...LINUX_QUESTIONS,
];

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
export const questionById = (id: string) => byId.get(id);

export const questionsOf = (subject: SubjectId) => QUESTIONS.filter((q) => q.subject === subject);

// How many questions of each subject a 100-question mock draws (it mirrors the spread of the real paper).
export const MOCK_MIX: Record<SubjectId, number> = { os: 12, coa: 10, net: 12, cpp: 14, db: 22, web: 10, php: 6, linux: 14 };
