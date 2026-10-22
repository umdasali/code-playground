import "server-only";
import { createHmac } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { config, sessionSecret } from "./config";
import { buildSampleSql } from "./sample-data";

const { host: HOST, port: PORT, adminUser: ADMIN_USER, adminPassword: ADMIN_PASSWORD } = config.mysql;
const SECRET = sessionSecret();
const MAX_ROWS = 500;

export const SESSION_ID = /^[a-f0-9]{16,32}$/;

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  affectedRows?: number;
  info?: string;
}

const ensured = new Set<string>();

const names = (id: string) => ({
  db: `pg_${id}`,
  user: `pg_${id.slice(0, 24)}`, // MySQL usernames are capped at 32 chars
  password: createHmac("sha256", SECRET).update(id).digest("hex").slice(0, 32),
});

async function admin() {
  return mysql.createConnection({ host: HOST, port: PORT, user: ADMIN_USER, password: ADMIN_PASSWORD });
}

// Each browser session gets its own database and a MySQL user that can only touch that database.
async function ensureSession(id: string) {
  if (ensured.has(id)) return;
  const { db, user, password } = names(id);
  const conn = await admin();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db}\``);
    await conn.query(
      `CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ? WITH MAX_QUERIES_PER_HOUR 5000 MAX_USER_CONNECTIONS 3`,
      [user, password],
    );
    await conn.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@'%'`, [user]);
  } finally {
    await conn.end();
  }
  ensured.add(id);
}

async function sessionConnection(id: string): Promise<Connection> {
  await ensureSession(id);
  const { db, user, password } = names(id);
  const conn = await mysql.createConnection({
    host: HOST, port: PORT, user, password, database: db,
    multipleStatements: true, rowsAsArray: true, dateStrings: true, connectTimeout: 5000,
  });
  await conn.query("SET SESSION max_execution_time = 5000");
  return conn;
}

const isHeader = (r: unknown): r is { affectedRows: number; info?: string } =>
  !!r && !Array.isArray(r) && typeof r === "object" && "affectedRows" in r && "fieldCount" in r;

function toResult(rows: unknown, fields: unknown): SqlResult {
  if (isHeader(rows)) {
    return { columns: [], rows: [], truncated: false, affectedRows: rows.affectedRows, info: rows.info || undefined };
  }
  const list = rows as unknown[][];
  const cols = ((fields ?? []) as { name: string }[]).map((f) => f.name);
  return { columns: cols, rows: list.slice(0, MAX_ROWS), truncated: list.length > MAX_ROWS };
}

export async function runSql(id: string, query: string): Promise<SqlResult[]> {
  const conn = await sessionConnection(id);
  try {
    const [rows, fields] = await conn.query(query);
    // With multipleStatements a multi-statement query returns one entry per statement.
    // A single SELECT's fields are FieldPacket objects; a multi-statement result's entries are arrays/undefined.
    const multi =
      Array.isArray(rows) && rows.length > 0 && rows.every((r) => Array.isArray(r) || isHeader(r)) &&
      Array.isArray(fields) && fields.every((f) => f === undefined || Array.isArray(f));
    if (!multi) return [toResult(rows, fields)];
    const f = fields as unknown[];
    return (rows as unknown[]).map((r, i) => toResult(r, f[i]));
  } finally {
    await conn.end();
  }
}

export async function resetSession(id: string) {
  const { db, user } = names(id);
  const conn = await admin();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await conn.query(`CREATE DATABASE \`${db}\``);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@'%'`, [user]);
  } finally {
    await conn.end();
  }
  ensured.add(id);
}

export const SAMPLE_SQL = buildSampleSql("mysql");
