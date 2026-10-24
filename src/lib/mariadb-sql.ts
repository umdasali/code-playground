// MariaDB dialect helpers for the practice tab, which runs on SQLite: statement splitting, text masking, the
// MariaDB -> SQLite rewrites, MariaDB functions registered on the SQLite connection, and the mariadb client's table output.
import type { Database } from "sql.js";

// ---------- masking ----------

export interface Masked { text: string; parts: string[] }
const MARK = "\u0001";

// Replace every quoted string / identifier with a placeholder so regex rewrites cannot touch their contents.
export function mask(sql: string): Masked {
  const parts: string[] = [];
  let out = "";
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      let body = "";
      while (j < sql.length) {
        if (sql[j] === "\\" && c !== "`" && j + 1 < sql.length) { body += sql[j] + sql[j + 1]; j += 2; continue; }
        if (sql[j] === c) { if (sql[j + 1] === c) { body += c + c; j += 2; continue; } break; }
        body += sql[j]; j++;
      }
      parts.push(c + body + c);
      out += `${MARK}${parts.length - 1}${MARK}`;
      i = j + 1;
    } else { out += c; i++; }
  }
  return { text: out, parts };
}

// Put the strings back, turning MariaDB backslash escapes inside '...' into SQL's doubled quote.
export function unmask(m: Masked, text = m.text): string {
  return text.replace(new RegExp(`${MARK}(\\d+)${MARK}`, "g"), (_, n) => {
    const p = m.parts[Number(n)];
    if (p[0] !== "'" && p[0] !== '"') return p;
    const q = p[0];
    const body = p.slice(1, -1).replace(/\\(.)/g, (_m, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch === "r" ? "\r" : ch === "0" ? "\0" : ch === q ? q + q : ch === "\\" ? "\\" : ch === "%" || ch === "_" ? "\\" + ch : ch));
    return q + body + q;
  });
}

export const stripQuotes = (s: string) => s.replace(/^[`'"]|[`'"]$/g, "");

// ---------- statements ----------

// Split typed text into statements at ; (or \G / \g), ignoring quotes and comments. rest is the unfinished tail.
export function splitStatements(input: string): { stmts: { sql: string; vertical: boolean }[]; rest: string } {
  const stmts: { sql: string; vertical: boolean }[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote !== "`") { cur += input[++i] ?? ""; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; cur += c; continue; }
    if (c === "#" || (c === "-" && input[i + 1] === "-" && /\s/.test(input[i + 2] ?? " "))) { while (i < input.length && input[i] !== "\n") i++; cur += "\n"; continue; }
    if (c === "/" && input[i + 1] === "*") { const end = input.indexOf("*/", i + 2); i = end < 0 ? input.length : end + 1; cur += " "; continue; }
    if (c === ";") { if (cur.trim()) stmts.push({ sql: cur.trim(), vertical: false }); cur = ""; continue; }
    if (c === "\\" && (input[i + 1] === "G" || input[i + 1] === "g")) { if (cur.trim()) stmts.push({ sql: cur.trim(), vertical: input[i + 1] === "G" }); cur = ""; i++; continue; }
    cur += c;
  }
  return { stmts, rest: cur.trim() ? cur : "" };
}

// Split at a separator that sits outside parentheses (text should already be masked).
export function splitTop(text: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const c of text) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out.map((x) => x.trim());
}

// Index of the ")" that closes the "(" at text[open].
export function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) { if (text[i] === "(") depth++; else if (text[i] === ")" && --depth === 0) return i; }
  return -1;
}

// ---------- rewriting ----------

const OPERATOR_END = /(\b(AND|OR|NOT|IS|IN|LIKE|BETWEEN|THEN|ELSE|WHEN|CASE|BY|ON|SELECT|DISTINCT|AS)|[-+*/=<>(,%|&])$/i;
const NOT_ALIAS = new Set(["END", "NULL", "TRUE", "FALSE", "DESC", "ASC", "UNKNOWN"]);

// Give un-aliased select items their original text as the column label, as MariaDB does (SQLite would show the rewritten text).
function labelSelectItems(m: Masked): void {
  const sel = m.text.match(/^\s*SELECT\s+(?:(?:DISTINCT|ALL|SQL_CALC_FOUND_ROWS)\s+)*/i);
  if (!sel) return;
  const start = sel[0].length;
  let depth = 0, end = m.text.length;
  for (let i = start; i < m.text.length; i++) {
    const c = m.text[i];
    if (c === "(") depth++; else if (c === ")") depth--;
    else if (depth === 0 && /^\s(FROM|INTO|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|UNION|HAVING)\s/i.test(m.text.slice(i, i + 12))) { end = i; break; }
  }
  const items = splitTop(m.text.slice(start, end));
  const labelled = items.map((raw) => {
    const item = raw.trim();
    if (!item || item === "*" || /^[\w`.\u0001]+\.\*$/.test(item) || /^[\w.\u0001]+$/.test(item)) return raw;
    if (/\sAS\s+[\w\u0001]+$/i.test(item)) return raw;
    const implicit = item.match(/^([\s\S]*\S)\s+([A-Za-z_]\w*|\u0001\d+\u0001)$/);
    if (implicit && !OPERATOR_END.test(implicit[1].trim()) && !NOT_ALIAS.has(implicit[2].toUpperCase()) && !/\)$/.test(implicit[2])) return raw;
    const original = unmask(m, item).replace(/\s+/g, " ").replace(/"/g, "'");
    m.parts.push(`"${original}"`);
    return `${item} AS ${MARK}${m.parts.length - 1}${MARK}`;
  });
  m.text = m.text.slice(0, start) + labelled.join(", ") + m.text.slice(end);
}

const SYSVARS: Record<string, string> = {
  version: "'11.4.2-MariaDB'", version_comment: "'mariadb.org binary distribution'", autocommit: "1", sql_mode: "'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'",
  max_connections: "151", hostname: "'lab'", datadir: "'/var/lib/mysql/'", port: "3306", character_set_server: "'utf8mb4'", time_zone: "'SYSTEM'", server_id: "1",
};

export interface RewriteCtx { vars: Record<string, string | number | null> }

// MariaDB -> SQLite for ordinary statements (SELECT / INSERT / UPDATE / DELETE).
export function rewriteDml(sql: string, ctx: RewriteCtx): string {
  const m = mask(sql.replace(/;\s*$/, ""));
  labelSelectItems(m);
  let t = m.text;
  t = t.replace(/\bFROM\s+DUAL\b/gi, "");
  t = t.replace(/<=>/g, " IS ");
  t = t.replace(/\bRLIKE\b/gi, "REGEXP");
  t = t.replace(/\bIF\s*\(/gi, "IIF(");
  t = t.replace(/\bLEFT\s*\(/gi, "LEFT_(").replace(/\bRIGHT\s*\(/gi, "RIGHT_(");
  t = t.replace(/\bSUBSTRING\s*\(/gi, "SUBSTR(").replace(/\bMID\s*\(/gi, "SUBSTR(");
  t = t.replace(/\b(?:USE|FORCE|IGNORE)\s+(?:INDEX|KEY)\s*\([^)]*\)/gi, "");
  t = t.replace(/\bTIMESTAMPDIFF\(\s*(\w+)\s*,/gi, (_, u: string) => `TIMESTAMPDIFF('${u.toUpperCase()}',`);
  t = t.replace(/\b(DATE_ADD|DATE_SUB|ADDDATE|SUBDATE)\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*INTERVAL\s+([^,()]+?)\s+(\w+)\s*\)/gi, (_, f: string, d: string, n: string, u: string) => `${f}(${d}, ${n}, '${u.toUpperCase()}')`);
  t = t.replace(/([\w]+\(\)|\u0001\d+\u0001|\b\w+\b)\s*([+-])\s*INTERVAL\s+(\S+)\s+(\w+)/gi, (_, d: string, op: string, n: string, u: string) => `${op === "+" ? "DATE_ADD" : "DATE_SUB"}(${d}, ${n}, '${u.toUpperCase()}')`);
  t = t.replace(/GROUP_CONCAT\(\s*(DISTINCT\s+)?([^()]*?)(?:\s+ORDER\s+BY\s+[^()]*?)?\s+SEPARATOR\s+(\u0001\d+\u0001)\s*\)/gi, (_, d: string | undefined, e: string, sep: string) => (d ? `GROUP_CONCAT(DISTINCT ${e})` : `GROUP_CONCAT(${e}, ${sep})`));
  t = t.replace(/GROUP_CONCAT\(\s*([^()]*?)\s+ORDER\s+BY\s+[^()]*?\)/gi, (_, e: string) => `GROUP_CONCAT(${e}, ',')`);
  t = t.replace(/(?<=[\w)`\u0001.])\s*\/\s*(?=[\w(`\u0001.])/g, " * 1.0 / ");
  t = t.replace(/@@(?:global\.|session\.)?(\w+)/gi, (_, n: string) => SYSVARS[n.toLowerCase()] ?? "NULL");
  t = t.replace(/@(\w+)/g, (_, n: string) => { const v = ctx.vars[n.toLowerCase()]; return v === undefined || v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`; });
  // INSERT variants
  t = t.replace(/^(\s*)INSERT\s+IGNORE\s+INTO/i, "$1INSERT OR IGNORE INTO");
  t = t.replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/i, (_, rest: string) => ` ON CONFLICT DO UPDATE SET${rest.replace(/\bVALUES\s*\(\s*([\w\u0001]+)\s*\)/gi, "excluded.$1")}`);
  // UPDATE / DELETE ... [ORDER BY ...] LIMIT n, which SQLite only allows in a subquery on the row ids
  const lim = t.match(/^\s*(DELETE\s+FROM|UPDATE)\s+(\S+)([\s\S]*?)\s+(?:ORDER\s+BY\s+([\s\S]*?)\s+)?LIMIT\s+(\d+)\s*$/i);
  if (lim) {
    const [, verb, table, mid, order, n] = lim;
    if (/^DELETE/i.test(verb)) {
      const where = mid.match(/^\s*(WHERE[\s\S]*)$/i)?.[1] ?? "";
      t = `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} ${where}${order ? ` ORDER BY ${order}` : ""} LIMIT ${n})`;
    } else {
      const parts = mid.match(/^(\s*SET[\s\S]*?)(\s+WHERE[\s\S]*)?$/i);
      t = `UPDATE ${table}${parts?.[1] ?? mid} WHERE rowid IN (SELECT rowid FROM ${table}${parts?.[2] ?? ""}${order ? ` ORDER BY ${order}` : ""} LIMIT ${n})`;
    }
  }
  return unmask(m, t).trim();
}

// ---------- functions ----------

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmtDate = (d: Date, withTime: boolean) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${withTime ? ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : ""}`;

function localNow(): Date { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())); }

function dateFormat(v: unknown, f: unknown): string | null {
  const d = toDate(v);
  if (!d || f === null) return null;
  return String(f).replace(/%([a-zA-Z%])/g, (_, c: string) => {
    switch (c) {
      case "Y": return String(d.getUTCFullYear());
      case "y": return pad(d.getUTCFullYear() % 100);
      case "m": return pad(d.getUTCMonth() + 1);
      case "c": return String(d.getUTCMonth() + 1);
      case "d": return pad(d.getUTCDate());
      case "e": return String(d.getUTCDate());
      case "H": return pad(d.getUTCHours());
      case "h": case "I": return pad(d.getUTCHours() % 12 || 12);
      case "i": return pad(d.getUTCMinutes());
      case "s": case "S": return pad(d.getUTCSeconds());
      case "p": return d.getUTCHours() < 12 ? "AM" : "PM";
      case "M": return MONTHS[d.getUTCMonth()];
      case "b": return MONTHS[d.getUTCMonth()].slice(0, 3);
      case "W": return DAYS[d.getUTCDay()];
      case "a": return DAYS[d.getUTCDay()].slice(0, 3);
      case "j": return pad(Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000), 3);
      case "%": return "%";
      default: return "%" + c;
    }
  });
}

function addInterval(v: unknown, n: unknown, unit: unknown, sign: 1 | -1): string | null {
  const d = toDate(v);
  const k = Number(n);
  if (!d || Number.isNaN(k)) return null;
  const u = String(unit).toUpperCase();
  const dateOnly = !/\d{2}:\d{2}:\d{2}/.test(String(v));
  const r = new Date(d.getTime());
  const q = sign * k;
  if (u === "YEAR") r.setUTCFullYear(r.getUTCFullYear() + q);
  else if (u === "QUARTER") r.setUTCMonth(r.getUTCMonth() + 3 * q);
  else if (u === "MONTH") r.setUTCMonth(r.getUTCMonth() + q);
  else if (u === "WEEK") r.setUTCDate(r.getUTCDate() + 7 * q);
  else if (u === "DAY") r.setUTCDate(r.getUTCDate() + q);
  else if (u === "HOUR") r.setUTCHours(r.getUTCHours() + q);
  else if (u === "MINUTE") r.setUTCMinutes(r.getUTCMinutes() + q);
  else if (u === "SECOND") r.setUTCSeconds(r.getUTCSeconds() + q);
  else return null;
  return fmtDate(r, !dateOnly || ["HOUR", "MINUTE", "SECOND"].includes(u));
}

export interface ServerInfo { database: () => string | null; user: () => string; lastInsertId: () => number; rowCount: () => number }

type Fn = (...a: never[]) => unknown;
// Register fn under name for each arity (SQLite picks the overload by argument count).
function def(db: Database, name: string, fn: (...a: unknown[]) => unknown, arities: number[]) {
  for (const n of arities) {
    const wrapper = (...a: unknown[]) => fn(...a);
    Object.defineProperty(wrapper, "length", { value: n });
    db.create_function(name, wrapper as unknown as Fn as (...args: unknown[]) => unknown);
  }
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export function registerFunctions(db: Database, info: ServerInfo) {
  def(db, "CONCAT", (...a) => (a.some((x) => x === null) ? null : a.map(String).join("")), range(1, 12));
  def(db, "CONCAT_WS", (sep, ...a) => (sep === null ? null : a.filter((x) => x !== null).map(String).join(String(sep))), range(2, 12));
  def(db, "CHAR_LENGTH", (s) => (s === null ? null : [...String(s)].length), [1]);
  def(db, "CHARACTER_LENGTH", (s) => (s === null ? null : [...String(s)].length), [1]);
  def(db, "LEFT_", (s, n) => (s === null ? null : String(s).slice(0, Math.max(0, Number(n)))), [2]);
  def(db, "RIGHT_", (s, n) => (s === null ? null : Number(n) <= 0 ? "" : String(s).slice(-Number(n))), [2]);
  def(db, "LPAD", (s, n, p) => { if (s === null) return null; const len = Number(n); const x = String(s); if (x.length >= len) return x.slice(0, len); const f = String(p ?? " "); return f ? (f.repeat(Math.ceil((len - x.length) / f.length)).slice(0, len - x.length) + x) : null; }, [3]);
  def(db, "RPAD", (s, n, p) => { if (s === null) return null; const len = Number(n); const x = String(s); if (x.length >= len) return x.slice(0, len); const f = String(p ?? " "); return f ? (x + f.repeat(Math.ceil((len - x.length) / f.length)).slice(0, len - x.length)) : null; }, [3]);
  def(db, "REVERSE", (s) => (s === null ? null : [...String(s)].reverse().join("")), [1]);
  def(db, "REPEAT", (s, n) => (s === null ? null : String(s).repeat(Math.max(0, Number(n)))), [2]);
  def(db, "LOCATE", (sub, s, pos) => (s === null || sub === null ? null : String(s).indexOf(String(sub), Math.max(0, Number(pos ?? 1) - 1)) + 1), [2, 3]);
  def(db, "UCASE", (s) => str(s)?.toUpperCase() ?? null, [1]);
  def(db, "LCASE", (s) => str(s)?.toLowerCase() ?? null, [1]);
  def(db, "STRCMP", (a, b) => (a === null || b === null ? null : String(a).toLowerCase() < String(b).toLowerCase() ? -1 : String(a).toLowerCase() > String(b).toLowerCase() ? 1 : 0), [2]);
  def(db, "FIND_IN_SET", (s, list) => (s === null || list === null ? null : String(list).split(",").indexOf(String(s)) + 1), [2]);
  def(db, "FORMAT", (x, d) => (x === null ? null : Number(x).toLocaleString("en-US", { minimumFractionDigits: Number(d ?? 0), maximumFractionDigits: Number(d ?? 0) })), [1, 2]);
  def(db, "REGEXP", (pat, s) => { if (pat === null || s === null) return null; try { return new RegExp(String(pat), "i").test(String(s)) ? 1 : 0; } catch { return 0; } }, [2]);

  def(db, "FLOOR", (x) => (x === null ? null : Math.floor(Number(x))), [1]);
  def(db, "CEIL", (x) => (x === null ? null : Math.ceil(Number(x))), [1]);
  def(db, "CEILING", (x) => (x === null ? null : Math.ceil(Number(x))), [1]);
  def(db, "POWER", (a, b) => (a === null || b === null ? null : Number(a) ** Number(b)), [2]);
  def(db, "POW", (a, b) => (a === null || b === null ? null : Number(a) ** Number(b)), [2]);
  def(db, "SQRT", (x) => (x === null || Number(x) < 0 ? null : Math.sqrt(Number(x))), [1]);
  def(db, "MOD", (a, b) => (a === null || b === null || Number(b) === 0 ? null : Number(a) % Number(b)), [2]);
  def(db, "TRUNCATE", (x, d) => (x === null ? null : Math.trunc(Number(x) * 10 ** Number(d)) / 10 ** Number(d)), [2]);
  def(db, "SIGN", (x) => (x === null ? null : Math.sign(Number(x))), [1]);
  def(db, "RAND", () => Math.random(), [0]);
  def(db, "GREATEST", (...a) => (a.some((x) => x === null) ? null : a.reduce((m, x) => (x! > m! ? x : m))), range(2, 8));
  def(db, "LEAST", (...a) => (a.some((x) => x === null) ? null : a.reduce((m, x) => (x! < m! ? x : m))), range(2, 8));
  def(db, "ISNULL", (x) => (x === null ? 1 : 0), [1]);

  def(db, "NOW", () => fmtDate(localNow(), true), [0]);
  def(db, "SYSDATE", () => fmtDate(localNow(), true), [0]);
  def(db, "CURDATE", () => fmtDate(localNow(), false), [0]);
  def(db, "CURRENT_DATE", () => fmtDate(localNow(), false), [0]);
  def(db, "CURTIME", () => fmtDate(localNow(), true).slice(11), [0]);
  def(db, "DATE_FORMAT", dateFormat, [2]);
  def(db, "YEAR", (v) => toDate(v)?.getUTCFullYear() ?? null, [1]);
  def(db, "MONTH", (v) => (toDate(v) ? toDate(v)!.getUTCMonth() + 1 : null), [1]);
  def(db, "DAY", (v) => toDate(v)?.getUTCDate() ?? null, [1]);
  def(db, "DAYOFMONTH", (v) => toDate(v)?.getUTCDate() ?? null, [1]);
  def(db, "HOUR", (v) => toDate(v)?.getUTCHours() ?? null, [1]);
  def(db, "MINUTE", (v) => toDate(v)?.getUTCMinutes() ?? null, [1]);
  def(db, "SECOND", (v) => toDate(v)?.getUTCSeconds() ?? null, [1]);
  def(db, "DAYOFWEEK", (v) => (toDate(v) ? toDate(v)!.getUTCDay() + 1 : null), [1]);
  def(db, "DAYNAME", (v) => (toDate(v) ? DAYS[toDate(v)!.getUTCDay()] : null), [1]);
  def(db, "MONTHNAME", (v) => (toDate(v) ? MONTHS[toDate(v)!.getUTCMonth()] : null), [1]);
  def(db, "QUARTER", (v) => (toDate(v) ? Math.floor(toDate(v)!.getUTCMonth() / 3) + 1 : null), [1]);
  def(db, "DATEDIFF", (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / 86400000) - Math.floor(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()) / 86400000) : null; }, [2]);
  def(db, "TIMESTAMPDIFF", (unit, a, b) => {
    const x = toDate(a), y = toDate(b);
    if (!x || !y) return null;
    const ms = y.getTime() - x.getTime();
    switch (String(unit)) {
      case "SECOND": return Math.trunc(ms / 1000);
      case "MINUTE": return Math.trunc(ms / 60000);
      case "HOUR": return Math.trunc(ms / 3600000);
      case "DAY": return Math.trunc(ms / 86400000);
      case "WEEK": return Math.trunc(ms / 604800000);
      case "MONTH": return Math.trunc(((y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth() - (y.getUTCDate() < x.getUTCDate() ? 1 : 0)));
      case "YEAR": return Math.trunc(((y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth() - (y.getUTCDate() < x.getUTCDate() ? 1 : 0)) / 12);
      default: return null;
    }
  }, [3]);
  def(db, "DATE_ADD", (d, n, u) => addInterval(d, n, u, 1), [3]);
  def(db, "ADDDATE", (d, n, u) => addInterval(d, n, u, 1), [3]);
  def(db, "DATE_SUB", (d, n, u) => addInterval(d, n, u, -1), [3]);
  def(db, "SUBDATE", (d, n, u) => addInterval(d, n, u, -1), [3]);

  def(db, "DATABASE", () => info.database(), [0]);
  def(db, "SCHEMA", () => info.database(), [0]);
  def(db, "USER", () => `${info.user()}@localhost`, [0]);
  def(db, "CURRENT_USER", () => `${info.user()}@localhost`, [0]);
  def(db, "SESSION_USER", () => `${info.user()}@localhost`, [0]);
  def(db, "SYSTEM_USER", () => `${info.user()}@localhost`, [0]);
  def(db, "VERSION", () => "11.4.2-MariaDB", [0]);
  def(db, "CONNECTION_ID", () => 8, [0]);
  def(db, "LAST_INSERT_ID", () => info.lastInsertId(), [0]);
  def(db, "ROW_COUNT", () => info.rowCount(), [0]);
  def(db, "UUID", () => crypto.randomUUID(), [0]);
}

// ---------- client output ----------

// A DECIMAL column value, kept as text so it prints with its fixed number of decimals but still aligns as a number.
export class Dec { constructor(public text: string) {} toString() { return this.text; } }
const isNumeric = (v: unknown) => typeof v === "number" || typeof v === "bigint" || v instanceof Dec;
const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" && !Number.isInteger(v) ? String(Math.round(v * 1e6) / 1e6) : String(v));

// The ASCII grid the mariadb client prints. Numbers are right-aligned; a multi-line last column (SHOW CREATE TABLE) is
// printed in full with only its last line padded, as the real client does.
export function formatTable(columns: string[], rows: unknown[][]): string[] {
  const text = rows.map((r) => r.map(cell));
  const widths = columns.map((c, i) => Math.max(c.length, ...text.map((r) => Math.max(...(r[i] ?? "").split("\n").map((l) => [...l].length)))));
  const line = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const out = [line, "| " + columns.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |", line];
  rows.forEach((r, ri) => {
    const last = text[ri].length - 1;
    const multi = text[ri][last].includes("\n");
    const lead = r.slice(0, multi ? last : r.length).map((v, i) => (isNumeric(v) ? text[ri][i].padStart(widths[i]) : text[ri][i].padEnd(widths[i])));
    if (!multi) { out.push("| " + lead.join(" | ") + " |"); return; }
    const parts = text[ri][last].split("\n");
    out.push("| " + [...lead, parts[0]].join(" | "));
    out.push(...parts.slice(1, -1), parts[parts.length - 1].padEnd(widths[last]) + " |");
  });
  out.push(line);
  return out;
}

// \G output: one block per row.
export function formatVertical(columns: string[], rows: unknown[][]): string[] {
  const w = Math.max(...columns.map((c) => c.length));
  const out: string[] = [];
  rows.forEach((r, i) => {
    out.push(`*************************** ${i + 1}. row ***************************`);
    columns.forEach((c, j) => out.push(`${c.padStart(w)}: ${cell(r[j])}`));
  });
  return out;
}
