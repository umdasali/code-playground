import type { Database, SqlJsStatic } from "sql.js";
import { buildSampleSql } from "./sample-data";

// In-browser SQL engine: SQLite compiled to WebAssembly, persisted as one blob in IndexedDB.
// The dialect is SQLite's, not MySQL's (e.g. AUTOINCREMENT instead of AUTO_INCREMENT).
const DB_NAME = "coding-playground";
const STORE = "sqlite";
const KEY = "main";
const MAX_ROWS = 500;

export interface LocalSqlResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  affectedRows?: number;
  info?: string;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function load(): Promise<Uint8Array | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function save(bytes: Uint8Array | null): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    if (bytes) os.put(bytes, KEY);
    else os.delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let sqlJs: Promise<SqlJsStatic> | null = null;
let current: Promise<Database> | null = null;

async function open(): Promise<Database> {
  sqlJs ??= import("sql.js").then((m) => (m.default ?? m)({ locateFile: () => "/sql-wasm.wasm" }));
  const SQL = await sqlJs;
  const saved = await load().catch(() => undefined);
  return new SQL.Database(saved);
}

const getDb = () => (current ??= open());

export async function runLocal(query: string): Promise<LocalSqlResult[]> {
  const db = await getDb();
  const sets = db.exec(query);
  const changed = db.getRowsModified();
  // Persist after every run so tables survive reloads (a failed run throws before this).
  await save(db.export()).catch(() => {});
  if (sets.length === 0) return [{ columns: [], rows: [], truncated: false, affectedRows: changed }];
  return sets.map((s) => ({
    columns: s.columns,
    rows: s.values.slice(0, MAX_ROWS),
    truncated: s.values.length > MAX_ROWS,
  }));
}

export async function resetLocal() {
  (await getDb().catch(() => null))?.close();
  current = null;
  await save(null);
}

export async function seedLocal() {
  await resetLocal();
  await runLocal(SAMPLE);
}

const SAMPLE = buildSampleSql("sqlite");
