// A MariaDB practice server for the browser: the mariadb client and the shell commands around it (mysql, mysqldump,
// mysqladmin), running on in-memory SQLite databases. Statements are translated from MariaDB's dialect and the
// answers are printed the way MariaDB prints them (ASCII tables, error numbers, SHOW/DESCRIBE layouts, privileges).
import type { Database, SqlJsStatic } from "sql.js";
import { Dec, formatTable, formatVertical, mask, matchParen, type Masked, registerFunctions, rewriteDml, splitStatements, splitTop, unmask } from "./mariadb-sql";

export interface ColMeta { name: string; type: string; nullable: boolean; key: "PRI" | "UNI" | "MUL" | ""; def: string | null; extra: string }
export interface IndexMeta { name: string; cols: string[]; unique: boolean; primary?: boolean; virtual?: boolean }
export interface TableMeta { cols: ColMeta[]; indexes: IndexMeta[]; constraints: string[] }
interface DbEntry { db: Database; tables: Record<string, TableMeta> }
interface UserRec { name: string; host: string; password: string }
interface Grant { user: string; host: string; privs: string[]; db: string; table: string }
export interface SelectResult { db: string; columns: string[]; rows: unknown[][] }

class SqlError extends Error {
  constructor(public code: number, public state: string, message: string) { super(message); }
}
const fail = (code: number, state: string, msg: string): never => { throw new SqlError(code, state, msg); };

const VERSION = "11.4.2-MariaDB";
const SYSTEM_DBS = ["information_schema", "mysql", "performance_schema"];
const SHELL_PROMPT = "student@lab:~$";
const BANNER = [
  "Welcome to the MariaDB monitor.  Commands end with ; or \\g.",
  "Your MariaDB connection id is 8",
  `Server version: ${VERSION} mariadb.org binary distribution`,
  "",
  "Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.",
  "",
  "Type 'help;' or '\\h' for help. Type '\\c' to clear the current input statement.",
  "",
];
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX", "REFERENCES", "EXECUTE", "CREATE VIEW", "SHOW VIEW", "TRIGGER", "EVENT", "LOCK TABLES", "CREATE TEMPORARY TABLES", "GRANT OPTION"];
const ALL_PRIVS = PRIVS.filter((p) => p !== "GRANT OPTION");

const HELP = [
  "List of the commands this practice client understands (end SQL with ; or \\G):",
  "  Databases   CREATE DATABASE, DROP DATABASE, USE, SHOW DATABASES, SHOW CREATE DATABASE",
  "  Tables      CREATE TABLE, ALTER TABLE, DROP TABLE, TRUNCATE, RENAME TABLE, SHOW TABLES, DESCRIBE, SHOW COLUMNS, SHOW CREATE TABLE, SHOW INDEX",
  "  Data        SELECT, INSERT (also ... ON DUPLICATE KEY UPDATE, INSERT IGNORE), REPLACE, UPDATE, DELETE",
  "  Indexes     CREATE [UNIQUE] INDEX, DROP INDEX ... ON, EXPLAIN",
  "  Users       CREATE USER, ALTER USER, DROP USER, GRANT, REVOKE, SHOW GRANTS, FLUSH PRIVILEGES, SELECT ... FROM mysql.user",
  "  Transactions  START TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT, SET autocommit",
  "  Server      SHOW VARIABLES, SHOW STATUS, SHOW PROCESSLIST, SELECT VERSION(), DATABASE(), USER(), information_schema.tables/columns",
  "  Client      status, clear, \\c (cancel input), \\G (vertical output), exit / quit / \\q",
  "  Shell       exit the client to get a shell prompt: mysql -u user -ppassword [db] [-e 'SQL'], mysqldump, mysqladmin, ls, cat",
];

// ---------- type and DDL parsing ----------

const INT_TYPES: Record<string, string> = { int: "int(11)", integer: "int(11)", bigint: "bigint(20)", smallint: "smallint(6)", tinyint: "tinyint(4)", mediumint: "mediumint(9)" };
const TEXT_TYPES = /^(varchar|char|text|tinytext|mediumtext|longtext|enum|set)$/i;

function normalizeType(raw: string, unsigned: boolean): string {
  const m = raw.trim().match(/^(\w+)\s*(\([^)]*\))?/);
  if (!m) return raw.trim().toLowerCase();
  const base = m[1].toLowerCase();
  const arg = m[2]?.replace(/\s+/g, "") ?? "";
  const t = arg ? `${base}${arg}` : INT_TYPES[base] ?? base;
  return t + (unsigned ? " unsigned" : "");
}

const sqliteType = (base: string) => (/^(int|integer|bigint|smallint|tinyint|mediumint)$/i.test(base) ? "INTEGER" : /^(boolean|bool)$/i.test(base) ? "INTEGER" : /^(double|float|real)$/i.test(base) ? "REAL" : base.toUpperCase());

interface ParsedColumn { meta: ColMeta; sql: string; pk: boolean; unique: boolean; autoInc: boolean; refs: boolean }

// One column definition ("name VARCHAR(50) NOT NULL DEFAULT 'x' ...") into MariaDB metadata and a SQLite column.
function parseColumn(defMasked: string, mk: Masked): ParsedColumn {
  const def = unmask(mk, defMasked);
  const m = def.trim().match(/^(`[^`]+`|\w+)\s+([\s\S]*)$/);
  if (!m) return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${def.trim().slice(0, 40)}' at line 1`);
  const name = m[1].replace(/^`|`$/g, "");
  const rest = m[2];
  const tm = rest.match(/^(\w+)\s*(\([^)]*\))?(\s+UNSIGNED)?(\s+ZEROFILL)?/i);
  if (!tm) return fail(1064, "42000", `You have an error in your SQL syntax near '${rest.slice(0, 30)}'`);
  const base = tm[1];
  const flags = rest.slice(tm[0].length);
  const unsigned = !!tm[3];
  const notNull = /\bNOT\s+NULL\b/i.test(flags);
  const pk = /\bPRIMARY\s+KEY\b/i.test(flags);
  const unique = /\bUNIQUE(\s+KEY)?\b/i.test(flags);
  const autoInc = /\bAUTO_INCREMENT\b/i.test(flags);
  const dm = flags.match(/\bDEFAULT\s+('(?:[^']|'')*'|"(?:[^"]|"")*"|\([^)]*\)|[\w.+-]+(?:\(\))?)/i);
  const refs = /\bREFERENCES\b/i.test(flags);
  let def2: string | null = dm ? dm[1] : null;
  if (def2 && /^'[\s\S]*'$/.test(def2)) def2 = def2.slice(1, -1).replace(/''/g, "'");
  if (def2?.toUpperCase() === "NULL") def2 = null;
  const type = normalizeType(tm[1] + (tm[2] ?? ""), unsigned);
  const meta: ColMeta = { name, type, nullable: !(notNull || pk), key: pk ? "PRI" : unique ? "UNI" : "", def: def2, extra: autoInc ? "auto_increment" : "" };

  // SQLite column
  let sql = `\`${name}\` `;
  const en = base.match(/^(enum)$/i) && tm[2];
  if (en) sql += `TEXT CHECK (\`${name}\` IN ${tm[2]})`;
  else sql += sqliteType(base) + (tm[2] && !/^(int|integer|bigint|smallint|tinyint|mediumint|enum|set)$/i.test(base) ? tm[2] : "");
  if (TEXT_TYPES.test(base) && !/enum|set/i.test(base)) sql += " COLLATE NOCASE";
  if (autoInc) sql = `\`${name}\` INTEGER PRIMARY KEY AUTOINCREMENT`;
  else if (pk) sql += " PRIMARY KEY";
  if (notNull && !pk && !autoInc) sql += " NOT NULL";
  if (unique && !pk) sql += " UNIQUE";
  if (dm) sql += ` DEFAULT ${dm[1]}`;
  const chk = flags.match(/\bCHECK\s*(\([^]*\))/i);
  if (chk) sql += ` CHECK ${chk[1]}`;
  const ref = flags.match(/\bREFERENCES\s+[\s\S]*$/i);
  if (ref) sql += ` ${ref[0].replace(/\bCOMMENT\s+\u0001\d+\u0001/i, "")}`;
  return { meta, sql, pk, unique, autoInc, refs };
}

// ---------- the engine ----------

export class Maria {
  private dbs: Record<string, DbEntry> = {};
  current: string | null = null;
  user = "root";
  mode: "shell" | "client" = "client";
  lines: string[] = [];
  events: string[] = [];
  selects: SelectResult[] = [];
  files: Record<string, string> = {};
  private buffer = "";
  private users: UserRec[] = [{ name: "root", host: "localhost", password: "" }];
  private grants: Grant[] = [];
  private vars: Record<string, string | number | null> = {};
  private inTxn = false;
  private txnDb: string | null = null;
  private autocommit = true;
  private lastId = 0;
  private rowCount = 0;
  private lastWarnings = 0;
  version = 0;

  constructor(private SQL: SqlJsStatic) { this.reset(); }

  reset() {
    for (const e of Object.values(this.dbs)) e.db.close();
    this.dbs = {};
    this.current = null; this.user = "root"; this.mode = "client"; this.buffer = "";
    this.users = [{ name: "root", host: "localhost", password: "" }];
    this.grants = []; this.vars = {}; this.inTxn = false; this.txnDb = null; this.autocommit = true;
    this.events = []; this.selects = []; this.files = {}; this.lines = [...BANNER];
    this.version++;
  }

  // ----- prompt and input -----

  prompt(): string {
    if (this.mode === "shell") return SHELL_PROMPT;
    return this.buffer ? "    ->" : `MariaDB [${this.current ?? "(none)"}]>`;
  }

  startInShell() { this.mode = "shell"; this.lines = []; this.version++; }

  input(line: string) {
    const shown = `${this.prompt()} ${line}`;
    const out: string[] = [];
    this.version++;
    try {
      if (this.mode === "shell") this.shell(line, out);
      else this.client(line, out);
    } catch (e) {
      out.push(e instanceof SqlError ? `ERROR ${e.code} (${e.state}): ${e.message}` : `ERROR: ${(e as Error).message}`);
    }
    if (out[0] === "\u0000CLEAR") this.lines = [];
    else this.lines.push(shown, ...out);
    if (this.lines.length > 800) this.lines = this.lines.slice(-800);
  }

  // ----- client -----

  private client(line: string, out: string[]) {
    const t = line.trim();
    if (!this.buffer) {
      const word = t.replace(/;$/, "").toLowerCase();
      if (!t) return;
      if (["exit", "quit", "\\q"].includes(word)) { out.push("Bye"); this.mode = "shell"; return; }
      if (word === "clear" || word === "\\c") { out.push("\u0000CLEAR"); return; }
      if (["help", "\\h", "\\?", "?"].includes(word)) { out.push(...HELP); return; }
      if (word === "status" || word === "\\s") { out.push("--------------", `mariadb  Ver 15.1 Distrib ${VERSION}, for debian-linux-gnu (x86_64)`, "", "Connection id:\t\t8", `Current database:\t${this.current ?? ""}`, `Current user:\t\t${this.user}@localhost`, "Server:\t\t\tMariaDB", `Server version:\t\t${VERSION} mariadb.org binary distribution`, "TCP port:\t\t3306", "Uptime:\t\t\t1 hour 2 min 11 sec", "--------------"); return; }
      const use = t.match(/^(?:use|\\u)\s+`?(\w+)`?\s*;?$/i);
      if (use) { this.run(`USE ${use[1]}`, false, out); return; }
    }
    if (/^\\c\b/.test(t)) { this.buffer = ""; return; }
    this.buffer += (this.buffer ? "\n" : "") + line;
    const { stmts, rest } = splitStatements(this.buffer);
    this.buffer = rest;
    for (const s of stmts) this.run(s.sql, s.vertical, out);
  }

  // Run SQL text from a script or -e option (no prompts, errors stop the script).
  private runScript(text: string, out: string[], stopOnError = true) {
    const { stmts } = splitStatements(text + (text.trim().endsWith(";") ? "" : ";"));
    for (const s of stmts) {
      try { this.run(s.sql, s.vertical, out, true); } catch (e) {
        out.push(e instanceof SqlError ? `ERROR ${e.code} (${e.state}) at line 1: ${e.message}` : `ERROR: ${(e as Error).message}`);
        if (stopOnError) return;
      }
    }
  }

  // batch = mysql -e / script mode: only result grids are printed, no row counts or "Query OK" lines.
  private run(sql: string, vertical: boolean, out: string[], batch = false) {
    const started = performance.now();
    const res = this.execute(sql);
    const sec = Math.max(0.001, (performance.now() - started) / 1000).toFixed(3);
    if (res.table) {
      const { columns, rows } = res.table;
      if (!rows.length) { if (!batch) out.push("Empty set (0.001 sec)", ""); return; }
      out.push(...(vertical ? formatVertical(columns, rows) : formatTable(columns, rows)));
      if (!batch) out.push(`${rows.length} row${rows.length === 1 ? "" : "s"} in set (${sec} sec)`, "");
    } else if (batch) {
      if (res.text && !res.text[0].startsWith("Query OK") && res.text[0] !== "Database changed") out.push(...res.text);
    } else {
      out.push(...(res.text ?? [`Query OK, ${res.affected ?? 0} row${res.affected === 1 ? "" : "s"} affected (${sec} sec)`]));
      if (res.matched !== undefined) out.push(`Rows matched: ${res.matched}  Changed: ${res.affected ?? 0}  Warnings: 0`);
      out.push("");
    }
  }

  // ----- helpers -----

  private entry(name?: string | null): DbEntry {
    const n = name ?? this.current;
    if (!n) return fail(1046, "3D000", "No database selected");
    const e = this.dbs[n];
    if (!e) return fail(1049, "42000", `Unknown database '${n}'`);
    return e;
  }

  private newDb(): Database {
    const db = new this.SQL.Database();
    db.run("PRAGMA foreign_keys = ON");
    registerFunctions(db, { database: () => this.current, user: () => this.user, lastInsertId: () => this.lastId, rowCount: () => this.rowCount });
    return db;
  }

  databases(): string[] { return Object.keys(this.dbs).sort(); }
  hasDatabase(n: string) { return n in this.dbs; }
  tables(db: string): string[] { return Object.keys(this.dbs[db]?.tables ?? {}).sort(); }
  tableMeta(db: string, t: string): TableMeta | undefined { return this.dbs[db]?.tables[t]; }
  userExists(name: string, host = "localhost") { return this.users.some((u) => u.name === name && (u.host === host || host === "*")); }
  grantsOf(name: string): string[] { return this.grantLines(name, "localhost"); }
  currentUser() { return this.user; }

  // Run SQL the way the client would and return the rows, without printing or recording anything (exercise solutions).
  evaluate(db: string, sql: string): { columns: string[]; rows: unknown[][] } | null {
    const e = this.dbs[db];
    if (!e) return null;
    try { const r = e.db.exec(rewriteDml(sql, { vars: {} }))[0]; return { columns: r?.columns ?? [], rows: r?.values ?? [] }; } catch { return null; }
  }

  // Read-only query for the exercise checks (no privileges, no output).
  peek(db: string, sql: string): unknown[][] {
    const e = this.dbs[db];
    if (!e) return [];
    try { return e.db.exec(sql)[0]?.values ?? []; } catch { return []; }
  }
  peekResult(db: string, sql: string): { columns: string[]; rows: unknown[][] } | null {
    const e = this.dbs[db];
    if (!e) return null;
    try { const r = e.db.exec(sql)[0]; return r ? { columns: r.columns, rows: r.values } : { columns: [], rows: [] }; } catch { return null; }
  }
  private ev(e: string) { if (!this.events.includes(e)) this.events.push(e); }

  private hasPriv(priv: string, db: string, table?: string): boolean {
    if (this.user === "root") return true;
    return this.grants.some((g) => g.user === this.user && (g.privs.includes("ALL") || g.privs.includes(priv)) && (g.db === "*" || g.db === db) && (g.table === "*" || !table || g.table === table));
  }
  private anyAccess(db: string): boolean {
    return this.user === "root" || this.grants.some((g) => g.user === this.user && (g.db === "*" || g.db === db));
  }
  private requireTable(priv: string, db: string, table: string) {
    if (!this.hasPriv(priv, db, table)) {
      this.ev(`denied:${this.user}`);
      fail(1142, "42000", `${priv} command denied to user '${this.user}'@'localhost' for table \`${db}\`.\`${table}\``);
    }
  }
  private requireRoot(what: string) {
    if (this.user !== "root") { this.ev(`denied:${this.user}`); fail(1227, "42000", `Access denied; you need (at least one of) the ${what} privilege(s) for this operation`); }
  }

  private ensureTxn(entry: DbEntry, dbName: string) {
    if (!this.autocommit && !this.inTxn) { entry.db.run("BEGIN"); this.inTxn = true; this.txnDb = dbName; }
  }
  private endTxnForDdl() {
    if (this.inTxn && this.txnDb && this.dbs[this.txnDb]) { try { this.dbs[this.txnDb].db.run("COMMIT"); } catch { /* nothing to commit */ } }
    this.inTxn = false; this.txnDb = null;
  }

  // ----- the statement dispatcher -----

  private execute(raw: string): { table?: { columns: string[]; rows: unknown[][] }; text?: string[]; affected?: number; matched?: number } {
    const sql = raw.replace(/\s+/g, " ").trim();
    const up = sql.toUpperCase();
    const word = up.split(" ")[0];

    // system schemas
    const sys = sql.match(/\b(information_schema|mysql)\s*\.\s*`?(\w+)`?/i);
    if (sys && /^(SELECT|WITH)/.test(up)) return this.systemQuery(sql, sys[1].toLowerCase());

    switch (word) {
      case "USE": {
        const n = sql.match(/^USE\s+`?(\w+)`?$/i)?.[1];
        if (!n) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(3)}' at line 1`);
        if (SYSTEM_DBS.includes(n.toLowerCase())) { this.current = n.toLowerCase(); return { text: ["Database changed"] }; }
        if (!this.dbs[n]) return fail(this.anyAccess(n) ? 1049 : 1044, this.anyAccess(n) ? "42000" : "42000", this.anyAccess(n) ? `Unknown database '${n}'` : `Access denied for user '${this.user}'@'localhost' to database '${n}'`);
        if (!this.anyAccess(n)) { this.ev(`denied:${this.user}`); return fail(1044, "42000", `Access denied for user '${this.user}'@'localhost' to database '${n}'`); }
        this.current = n;
        return { text: ["Database changed"] };
      }
      case "CREATE": {
        if (/^CREATE\s+(DATABASE|SCHEMA)\b/i.test(sql)) return this.createDatabase(sql);
        if (/^CREATE\s+(OR\s+REPLACE\s+)?USER\b/i.test(sql)) return this.createUser(sql);
        if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql)) return this.createIndex(sql);
        if (/^CREATE\s+(TEMPORARY\s+)?TABLE\b/i.test(sql)) return this.createTable(sql);
        break;
      }
      case "DROP": {
        if (/^DROP\s+(DATABASE|SCHEMA)\b/i.test(sql)) return this.dropDatabase(sql);
        if (/^DROP\s+TABLE\b/i.test(sql)) return this.dropTable(sql);
        if (/^DROP\s+USER\b/i.test(sql)) return this.dropUser(sql);
        if (/^DROP\s+INDEX\b/i.test(sql)) return this.dropIndex(sql);
        break;
      }
      case "ALTER": {
        if (/^ALTER\s+USER\b/i.test(sql)) return this.alterUser(sql);
        if (/^ALTER\s+TABLE\b/i.test(sql)) return this.alterTable(sql);
        break;
      }
      case "TRUNCATE": return this.truncate(sql);
      case "RENAME": if (/^RENAME\s+TABLE\b/i.test(sql)) return this.renameTable(sql); break;
      case "SHOW": return this.show(sql);
      case "DESCRIBE": case "DESC": return this.describe(sql.replace(/^\w+\s+/, ""));
      case "EXPLAIN": return this.explain(sql);
      case "GRANT": return this.grant(sql);
      case "REVOKE": return this.revoke(sql);
      case "FLUSH": return { affected: 0 };
      case "LOCK": case "UNLOCK": return { affected: 0 };
      case "SET": return this.set(sql);
      case "START": case "BEGIN": return this.begin();
      case "COMMIT": return this.commit();
      case "ROLLBACK": return this.rollback(sql);
      case "SAVEPOINT": case "RELEASE": return this.savepoint(sql);
      case "SELECT": case "WITH": case "INSERT": case "REPLACE": case "UPDATE": case "DELETE": return this.dml(sql, word);
      case "ANALYZE": case "OPTIMIZE": case "CHECK": return { table: { columns: ["Table", "Op", "Msg_type", "Msg_text"], rows: [[`${this.current}.${sql.split(" ").pop()}`, word.toLowerCase(), "status", "OK"]] } };
      case "SOURCE": case "\\.": break;
    }
    return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${sql.slice(0, 40)}' at line 1`);
  }

  // ----- SELECT / INSERT / UPDATE / DELETE -----

  // Strip "db." prefixes of the current database; refuse other databases (each lives in its own engine here).
  private unqualify(sql: string): string {
    return sql.replace(/\b(FROM|JOIN|INTO|UPDATE|TABLE|,)(\s*)`?(\w+)`?\s*\.\s*`?(\w+)`?/gi, (all, kw: string, sp: string, db: string, tbl: string) => {
      if (db === this.current) return `${kw}${sp}${tbl}`;
      if (this.dbs[db]) return fail(1235, "42000", `This version of the practice server cannot query across databases (${db}.${tbl}). Run USE ${db}; first.`);
      return all;
    });
  }

  private tablesIn(sql: string): string[] {
    const found: string[] = [];
    const m = mask(sql).text;
    for (const g of m.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)((?:\s*,\s*\w+)*)/gi)) {
      found.push(g[1]);
      for (const x of g[2].split(",")) if (x.trim()) found.push(x.trim());
    }
    return found.filter((t) => !/^(SELECT|DUAL|VALUES)$/i.test(t));
  }

  // db.table references to databases other than the current one (SELECT only: the tables are copied into a scratch database).
  private otherRefs(sql: string): { db: string; table: string }[] {
    const refs: { db: string; table: string }[] = [];
    for (const g of sql.matchAll(/\b(?:FROM|JOIN|,)\s*`?(\w+)`?\s*\.\s*`?(\w+)`?/gi)) if (this.dbs[g[1]] && g[1] !== this.current && !refs.some((r) => r.db === g[1] && r.table === g[2])) refs.push({ db: g[1], table: g[2] });
    return refs;
  }

  private copyTable(src: DbEntry, table: string, into: Database, as: string) {
    const info = src.db.exec(`PRAGMA table_info(\`${table}\`)`)[0]?.values ?? [];
    into.run(`CREATE TABLE \`${as}\` (${info.map((r) => `\`${r[1]}\``).join(", ")})`);
    const data = src.db.exec(`SELECT * FROM \`${table}\``)[0]?.values ?? [];
    const stmt = into.prepare(`INSERT INTO \`${as}\` VALUES (${info.map(() => "?").join(",")})`);
    for (const row of data) stmt.run(row as never);
    stmt.free();
  }

  private crossSelect(sql: string, refs: { db: string; table: string }[]) {
    const scratch = this.newDb();
    try {
      for (const r of refs) {
        const e = this.dbs[r.db];
        if (!e.tables[r.table]) fail(1146, "42S02", `Table '${r.db}.${r.table}' doesn't exist`);
        this.requireTable("SELECT", r.db, r.table);
        this.copyTable(e, r.table, scratch, `${r.db}__${r.table}`);
      }
      let rewritten = sql.replace(/\b(FROM|JOIN|,)(\s*)`?(\w+)`?\s*\.\s*`?(\w+)`?/gi, (all, kw: string, sp: string, db: string, t: string) => (refs.some((r) => r.db === db && r.table === t) ? `${kw}${sp}${db}__${t}` : all));
      rewritten = this.unqualify(rewritten);
      if (this.current && this.dbs[this.current]) for (const t of this.tablesIn(rewritten)) if (this.dbs[this.current].tables[t]) { this.requireTable("SELECT", this.current, t); try { this.copyTable(this.dbs[this.current], t, scratch, t); } catch { /* already copied */ } }
      return this.dmlOn({ db: scratch, tables: {} }, this.current ?? refs[0].db, rewritten, "SELECT");
    } finally { scratch.close(); }
  }

  private dml(sqlIn: string, verb: string) {
    if (verb === "SELECT" || verb === "WITH") { const refs = this.otherRefs(sqlIn); if (refs.length) return this.crossSelect(sqlIn, refs); }
    const sql = this.unqualify(sqlIn);
    const name = this.current;
    if (!name || SYSTEM_DBS.includes(name)) {
      if (verb === "SELECT" && !/\bFROM\b/i.test(sql)) return this.dmlOn(this.scratch(), "main", sql, verb);
      return fail(1046, "3D000", "No database selected");
    }
    const e = this.entry(name);
    const priv = verb === "SELECT" || verb === "WITH" ? "SELECT" : verb === "REPLACE" ? "INSERT" : verb;
    const tables = this.tablesIn(sql);
    for (const t of tables) if (e.tables[t] || priv !== "SELECT") this.requireTable(priv, name, t);
    for (const t of tables) if (!e.tables[t] && !/^(\w+)\s+AS\b/i.test(t) && /^(SELECT|WITH)/i.test(sql) === false) fail(1146, "42S02", `Table '${name}.${t}' doesn't exist`);
    this.ensureTxn(e, name);
    return this.dmlOn(e, name, sql, verb);
  }

  private scratchDb: DbEntry | null = null;
  private scratch(): DbEntry { return (this.scratchDb ??= { db: this.newDb(), tables: {} }); }

  private dmlOn(e: DbEntry, dbName: string, sql: string, verb: string) {
    const translated = rewriteDml(sql, { vars: this.vars });
    const total = () => Object.keys(e.tables).reduce((n, t) => n + Number(e.db.exec(`SELECT COUNT(*) FROM \`${t}\``)[0]?.values[0][0] ?? 0), 0);
    const before = verb === "DELETE" ? total() : 0;
    try {
      const results = e.db.exec(translated);
      if (verb === "DELETE" && before - total() > e.db.getRowsModified()) this.ev("cascade-delete");
      const changes = e.db.getRowsModified();
      if (verb === "SELECT" || verb === "WITH") {
        const r = results[results.length - 1];
        this.rowCount = -1;
        const table = { columns: r?.columns ?? [], rows: (r?.values ?? []).slice(0, 1000) };
        // plain DECIMAL(p,s) columns print with s decimals, as MariaDB does
        const scales = new Map<string, number>();
        for (const t of this.tablesIn(sql)) for (const c of e.tables[t]?.cols ?? []) { const d = c.type.match(/^decimal\(\d+,(\d+)\)/); if (d) scales.set(c.name, Number(d[1])); }
        const shown = scales.size && r ? { columns: table.columns, rows: table.rows.map((row) => row.map((v, j) => (typeof v === "number" && scales.has(table.columns[j]) ? new Dec(v.toFixed(scales.get(table.columns[j])!)) : v))) } : table;
        if (r) { this.selects.push({ db: dbName, columns: table.columns, rows: r.values }); if (this.selects.length > 60) this.selects.shift(); }
        return { table: shown };
      }
      this.rowCount = changes;
      const id = e.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
      if (verb === "INSERT" || verb === "REPLACE") this.lastId = Number(id ?? 0);
      return verb === "UPDATE" ? { affected: changes, matched: changes } : { affected: changes };
    } catch (err) {
      return this.mapError(err as Error, sql, dbName);
    }
  }

  private mapError(err: Error, sql: string, dbName: string): never {
    const msg = err.message;
    let m: RegExpMatchArray | null;
    if (err instanceof SqlError) throw err;
    if ((m = msg.match(/no such table: (?:(\w+)\.)?(\w+)/))) return fail(1146, "42S02", `Table '${m[1] ?? dbName}.${m[2]}' doesn't exist`);
    if ((m = msg.match(/no such column: (\S+)/))) return fail(1054, "42S22", `Unknown column '${m[1]}' in '${/\bWHERE\b[^]*$/i.test(sql) && new RegExp(`WHERE[^]*${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(sql) ? "where clause" : "field list"}'`);
    if ((m = msg.match(/table (\w+) already exists/))) return fail(1050, "42S01", `Table '${m[1]}' already exists`);
    if ((m = msg.match(/UNIQUE constraint failed: (\w+)\.(\w+)/))) {
      const meta = this.dbs[dbName]?.tables[m[1]];
      const primary = meta?.cols.find((c) => c.name === m![2])?.key === "PRI";
      const value = this.guessDuplicate(sql, meta, m[2]);
      return fail(1062, "23000", `Duplicate entry '${value}' for key '${primary ? "PRIMARY" : m[2]}'`);
    }
    if ((m = msg.match(/NOT NULL constraint failed: \w+\.(\w+)/))) return fail(1048, "23000", `Column '${m[1]}' cannot be null`);
    if (/FOREIGN KEY constraint failed/.test(msg)) {
      this.ev("fk-violation");
      return fail(/^\s*DELETE|^\s*UPDATE/i.test(sql) ? 1451 : 1452, "23000", /^\s*DELETE|^\s*UPDATE/i.test(sql) ? "Cannot delete or update a parent row: a foreign key constraint fails" : "Cannot add or update a child row: a foreign key constraint fails");
    }
    if (/CHECK constraint failed/.test(msg)) {
      const col = (msg.match(/failed: (\S+)/)?.[1] ?? "").replace(/`/g, "");
      const table = sql.match(/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+`?(\w+)`?/i)?.[1] ?? "";
      if (/^enum/i.test(this.dbs[dbName]?.tables[table]?.cols.find((c) => c.name === col)?.type ?? "")) return fail(1265, "01000", `Data truncated for column '${col}' at row 1`);
      return fail(4025, "23000", `CONSTRAINT failed for \`${dbName}\`.\`${table}\``);
    }
    if ((m = msg.match(/near "([^"]*)": syntax error/)) || (m = msg.match(/near "([^"]*)"/))) {
      const at = sql.toLowerCase().indexOf(m[1].toLowerCase());
      return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${at >= 0 ? sql.slice(at) : m[1]}' at line 1`);
    }
    if (/unrecognized token/.test(msg)) return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${sql.slice(0, 40)}' at line 1`);
    if (/incomplete input/.test(msg)) return fail(1064, "42000", "You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '' at line 1");
    if (/datatype mismatch/.test(msg)) return fail(1366, "22007", "Incorrect value for column");
    if (/no such function: (\w+)/.test(msg)) return fail(1305, "42000", `FUNCTION ${dbName}.${msg.match(/no such function: (\w+)/)![1]} does not exist`);
    if (/ambiguous column name: (\S+)/.test(msg)) return fail(1052, "23000", `Column '${msg.match(/ambiguous column name: (\S+)/)![1]}' in field list is ambiguous`);
    if (/wrong number of values|values for \d+ columns|has \d+ columns but \d+ values/.test(msg)) return fail(1136, "21S01", "Column count doesn't match value count at row 1");
    return fail(1105, "HY000", `Unknown error: ${msg}`);
  }

  private guessDuplicate(sql: string, meta: TableMeta | undefined, col: string): string {
    const cols = sql.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+\w+\s*\(([^)]*)\)/i)?.[1].split(",").map((c) => c.trim().replace(/`/g, ""));
    const vals = sql.match(/VALUES\s*\(([^)]*)\)/i)?.[1];
    if (vals) {
      const v = splitTop(mask(vals).text).map((x) => x.trim());
      const names = cols ?? meta?.cols.map((c) => c.name) ?? [];
      const i = names.indexOf(col);
      if (i >= 0 && v[i] !== undefined) return unmask(mask(vals), v[i]).replace(/^'|'$/g, "");
    }
    return col;
  }

  // ----- information_schema and mysql system tables -----

  private systemQuery(sql: string, which: string) {
    const db = this.newDb();
    const q = (v: unknown) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
    const ins = (t: string, rows: unknown[][]) => { if (rows.length) db.run(`INSERT INTO ${t} VALUES ${rows.map((r) => `(${r.map(q).join(",")})`).join(",")}`); };
    if (which === "information_schema") {
      db.run("CREATE TABLE schemata (catalog_name TEXT, schema_name TEXT, default_character_set_name TEXT, default_collation_name TEXT)");
      db.run("CREATE TABLE tables (table_catalog TEXT, table_schema TEXT, table_name TEXT, table_type TEXT, engine TEXT, table_rows INTEGER)");
      db.run("CREATE TABLE columns (table_catalog TEXT, table_schema TEXT, table_name TEXT, column_name TEXT, ordinal_position INTEGER, column_default TEXT, is_nullable TEXT, data_type TEXT, column_type TEXT, column_key TEXT, extra TEXT)");
      db.run("CREATE TABLE statistics (table_schema TEXT, table_name TEXT, non_unique INTEGER, index_name TEXT, seq_in_index INTEGER, column_name TEXT)");
      const visible = this.databases().filter((d) => this.anyAccess(d));
      ins("schemata", ["information_schema", "mysql", ...visible].map((d) => ["def", d, "utf8mb4", "utf8mb4_general_ci"]));
      for (const d of visible) for (const [t, meta] of Object.entries(this.dbs[d].tables)) {
        const n = Number(this.dbs[d].db.exec(`SELECT COUNT(*) FROM \`${t}\``)[0]?.values[0][0] ?? 0);
        ins("tables", [["def", d, t, "BASE TABLE", "InnoDB", n]]);
        ins("columns", meta.cols.map((c, i) => ["def", d, t, c.name, i + 1, c.def, c.nullable ? "YES" : "NO", c.type.replace(/\(.*$/, "").replace(/ unsigned/, ""), c.type, c.key, c.extra]));
        ins("statistics", meta.indexes.flatMap((ix) => ix.cols.map((col, i) => [d, t, ix.unique ? 0 : 1, ix.name, i + 1, col])));
      }
    } else {
      this.requireRoot("SELECT");
      db.run("CREATE TABLE user (Host TEXT, User TEXT, Password TEXT, Select_priv TEXT, is_role TEXT)");
      ins("user", this.users.map((u) => [u.host, u.name, u.password ? this.fakeHash(u.password) : "", u.name === "root" ? "Y" : "N", "N"]));
      db.run("CREATE TABLE db (Host TEXT, Db TEXT, User TEXT, Select_priv TEXT)");
      ins("db", this.grants.filter((g) => g.db !== "*" && g.table === "*").map((g) => [g.host, g.db, g.user, g.privs.includes("SELECT") || g.privs.includes("ALL") ? "Y" : "N"]));
    }
    const stripped = sql.replace(new RegExp(`\\b${which}\\s*\\.\\s*`, "gi"), "");
    return this.dmlOn({ db, tables: {} }, which, stripped, "SELECT");
  }

  private fakeHash(pw: string): string {
    let h = 5381;
    const out: string[] = [];
    for (let i = 0; i < 20; i++) { for (const c of pw + i) h = ((h << 5) + h + c.charCodeAt(0)) | 0; out.push(((h >>> 0) & 255).toString(16).padStart(2, "0")); }
    return "*" + out.join("").toUpperCase();
  }

  // ----- databases -----

  private createDatabase(sql: string) {
    const m = sql.match(/^CREATE\s+(?:DATABASE|SCHEMA)\s+(IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 30)}'`);
    const name = m[2];
    if (this.user !== "root" && !this.hasPriv("CREATE", name)) { this.ev(`denied:${this.user}`); return fail(1044, "42000", `Access denied for user '${this.user}'@'localhost' to database '${name}'`); }
    this.endTxnForDdl();
    if (this.dbs[name] || SYSTEM_DBS.includes(name.toLowerCase())) {
      if (m[1]) return { text: ["Query OK, 1 row affected, 1 warning (0.000 sec)"] };
      return fail(1007, "HY000", `Can't create database '${name}'; database exists`);
    }
    this.dbs[name] = { db: this.newDb(), tables: {} };
    return { affected: 1 };
  }

  private dropDatabase(sql: string) {
    const m = sql.match(/^DROP\s+(?:DATABASE|SCHEMA)\s+(IF\s+EXISTS\s+)?`?(\w+)`?/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 30)}'`);
    const name = m[2];
    if (!this.hasPriv("DROP", name)) { this.ev(`denied:${this.user}`); return fail(1044, "42000", `Access denied for user '${this.user}'@'localhost' to database '${name}'`); }
    this.endTxnForDdl();
    if (!this.dbs[name]) return m[1] ? { text: ["Query OK, 0 rows affected, 1 warning (0.000 sec)"] } : fail(1008, "HY000", `Can't drop database '${name}'; database doesn't exist`);
    const n = Object.keys(this.dbs[name].tables).length;
    this.dbs[name].db.close();
    delete this.dbs[name];
    if (this.current === name) this.current = null;
    return { affected: n };
  }

  // ----- tables -----

  private createTable(sqlIn: string) {
    const sql = this.unqualify(sqlIn);
    const dbName = this.current;
    const e = this.entry(dbName);
    const m = mask(sql);
    const head = m.text.match(/^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?\s*\.\s*)?(\u0001\d+\u0001|\w+)\s*/i);
    if (!head) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' at line 1`);
    const table = head[3].replace(/^\u0001(\d+)\u0001$/, (_, n) => m.parts[Number(n)]).replace(/`/g, "");
    this.requireTable("CREATE", dbName!, table);
    this.endTxnForDdl();
    if (e.tables[table]) {
      if (head[1]) return { text: ["Query OK, 0 rows affected, 1 warning (0.000 sec)"] };
      return fail(1050, "42S01", `Table '${table}' already exists`);
    }
    const after = m.text.slice(head[0].length);

    // CREATE TABLE x LIKE y / AS SELECT
    const like = after.match(/^LIKE\s+(\w+)/i);
    if (like) {
      const src = e.tables[like[1]];
      if (!src) return fail(1146, "42S02", `Table '${dbName}.${like[1]}' doesn't exist`);
      const ddl = e.db.exec(`SELECT sql FROM sqlite_master WHERE name='${like[1]}'`)[0].values[0][0] as string;
      e.db.run(ddl.replace(new RegExp(`CREATE TABLE\\s+["\`]?${like[1]}["\`]?`, "i"), `CREATE TABLE \`${table}\``));
      e.tables[table] = structuredClone(src);
      for (const ix of src.indexes.filter((i) => !i.primary)) this.makeIndex(e, table, ix.name, ix.cols, ix.unique);
      return { affected: 0 };
    }
    if (!after.startsWith("(")) {
      const sel = after.match(/^(?:AS\s+)?(SELECT[\s\S]*)$/i);
      if (!sel) return fail(1064, "42000", `You have an error in your SQL syntax near '${unmask(m, after).slice(0, 30)}' at line 1`);
      try { e.db.run(`CREATE TABLE \`${table}\` AS ${rewriteDml(unmask(m, sel[1]), { vars: this.vars })}`); } catch (err) { return this.mapError(err as Error, sql, dbName!); }
      e.tables[table] = this.metaFromPragma(e, table);
      return { affected: Number(e.db.exec(`SELECT COUNT(*) FROM \`${table}\``)[0].values[0][0]) };
    }
    const close = matchParen(after, 0);
    if (close < 0) return fail(1064, "42000", "You have an error in your SQL syntax near '' at line 1");
    const items = splitTop(after.slice(1, close));

    const cols: ParsedColumn[] = [];
    const constraints: string[] = [];
    const sqliteConstraints: string[] = [];
    const indexes: IndexMeta[] = [];
    const virtualFk: IndexMeta[] = [];
    let pkCols: string[] | null = null;
    const names = (s: string) => s.split(",").map((x) => unmask(m, x.trim()).replace(/`/g, "").replace(/\(\d+\)$/, ""));
    for (const item of items) {
      let mm: RegExpMatchArray | null;
      if ((mm = item.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/i))) pkCols = names(mm[1]);
      else if ((mm = item.match(/^(?:CONSTRAINT\s+(?:\S+\s+)?)?UNIQUE(?:\s+(?:KEY|INDEX))?\s*(\u0001\d+\u0001|\w+)?\s*\(([^)]*)\)/i))) {
        const c = names(mm[2]);
        indexes.push({ name: mm[1] ? unmask(m, mm[1]).replace(/`/g, "") : c[0], cols: c, unique: true });
      } else if ((mm = item.match(/^(?:KEY|INDEX)\s*(\u0001\d+\u0001|\w+)?\s*\(([^)]*)\)/i))) {
        const c = names(mm[2]);
        indexes.push({ name: mm[1] ? unmask(m, mm[1]).replace(/`/g, "") : c[0], cols: c, unique: false });
      } else if (/^(FULLTEXT|SPATIAL)\b/i.test(item)) continue;
      else if (/^(?:CONSTRAINT\b|FOREIGN\s+KEY\b|CHECK\b)/i.test(item)) {
        const text = unmask(m, item).replace(/\s+/g, " ");
        const fk = text.match(/^(?:CONSTRAINT\s+`?(\w+)`?\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+`?(\w+)`?\s*\(([^)]*)\)((?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION))*)/i);
        if (fk) {
          const q = (list: string) => list.split(",").map((x) => `\`${x.trim().replace(/`/g, "")}\``).join(",");
          const nth = constraints.filter((c) => /FOREIGN KEY/.test(c)).length + 1;
          const name = fk[1] ?? `${table}_ibfk_${nth}`;
          constraints.push(`CONSTRAINT \`${name}\` FOREIGN KEY (${q(fk[2])}) REFERENCES \`${fk[3]}\` (${q(fk[4])})${fk[5].toUpperCase().replace(/\s+/g, " ")}`);
          const first = fk[2].split(",")[0].trim().replace(/`/g, "");
          if (!indexes.some((i) => i.cols[0] === first)) virtualFk.push({ name: fk[1] ?? first, cols: fk[2].split(",").map((x) => x.trim().replace(/`/g, "")), unique: false, virtual: true });
        } else constraints.push(text);
        sqliteConstraints.push(unmask(m, item.replace(/\bCONSTRAINT\s+\S+\s+(?=FOREIGN|CHECK)/i, "")));
      } else cols.push(parseColumn(item, m));
    }
    if (!cols.length) return fail(1113, "42000", "A table must have at least 1 column");
    for (const c of cols) if (cols.filter((x) => x.meta.name === c.meta.name).length > 1) return fail(1060, "42S21", `Duplicate column name '${c.meta.name}'`);
    for (const ix of indexes) for (const c of ix.cols) if (!cols.some((x) => x.meta.name === c)) return fail(1072, "42000", `Key column '${c}' doesn't exist in table`);

    // table-level PRIMARY KEY: single AUTO_INCREMENT column becomes the rowid alias, others stay a composite key
    const inlinePk = cols.filter((c) => c.pk);
    if (inlinePk.length && pkCols) return fail(1068, "42000", "Multiple primary key defined");
    if (inlinePk.length > 1) return fail(1068, "42000", "Multiple primary key defined");
    if (pkCols) {
      for (const p of pkCols) if (!cols.some((c) => c.meta.name === p)) return fail(1072, "42000", `Key column '${p}' doesn't exist in table`);
      if (pkCols.length === 1) {
        const c = cols.find((x) => x.meta.name === pkCols![0])!;
        c.pk = true;
        if (c.autoInc) c.sql = `\`${c.meta.name}\` INTEGER PRIMARY KEY AUTOINCREMENT`;
        else c.sql += " PRIMARY KEY";
        sqliteConstraints.unshift("");
        sqliteConstraints.shift();
        pkCols = null;
      }
    }
    for (const c of cols) if (c.autoInc && !c.pk) return fail(1075, "42000", "Incorrect table definition; there can be only one auto column and it must be defined as a key");
    if (cols.filter((c) => c.autoInc).length > 1) return fail(1075, "42000", "Incorrect table definition; there can be only one auto column and it must be defined as a key");

    const pkSet = new Set(pkCols ?? cols.filter((c) => c.pk).map((c) => c.meta.name));
    for (const c of cols) { if (pkSet.has(c.meta.name)) { c.meta.key = "PRI"; c.meta.nullable = false; } }
    for (const ix of indexes) { const c = cols.find((x) => x.meta.name === ix.cols[0])!.meta; if (!c.key) c.key = ix.unique && ix.cols.length === 1 ? "UNI" : "MUL"; }
    for (const c of cols) if (c.refs && !c.meta.key) c.meta.key = "MUL";
    for (const k of constraints) for (const f of [...k.matchAll(/FOREIGN\s+KEY\s*\(([^)]*)\)/gi)]) for (const col of f[1].split(",").map((x) => x.trim().replace(/`/g, ""))) { const c = cols.find((x) => x.meta.name === col)?.meta; if (c && !c.key) c.key = "MUL"; }

    const body = [...cols.map((c) => c.sql), ...(pkCols ? [`PRIMARY KEY (${pkCols.map((p) => `\`${p}\``).join(", ")})`] : []), ...sqliteConstraints.filter(Boolean)];
    try { e.db.run(`CREATE TABLE \`${table}\` (\n  ${body.join(",\n  ")}\n)`); } catch (err) { return this.mapError(err as Error, sql, dbName!); }
    const meta: TableMeta = { cols: cols.map((c) => c.meta), indexes: [], constraints };
    if (pkSet.size) meta.indexes.push({ name: "PRIMARY", cols: [...pkSet], unique: true, primary: true });
    e.tables[table] = meta;
    for (const ix of indexes) this.makeIndex(e, table, ix.name, ix.cols, ix.unique);
    for (const c of cols) if (c.unique && !c.pk) meta.indexes.push({ name: c.meta.name, cols: [c.meta.name], unique: true });
    meta.indexes.push(...virtualFk); // MariaDB creates a plain index for every foreign key
    return { affected: 0 };
  }

  private metaFromPragma(e: DbEntry, table: string): TableMeta {
    const rows = e.db.exec(`PRAGMA table_info(\`${table}\`)`)[0]?.values ?? [];
    return {
      cols: rows.map((r) => ({ name: String(r[1]), type: String(r[2] || "text").toLowerCase(), nullable: !r[3] && !r[5], key: r[5] ? "PRI" : "", def: r[4] === null ? null : String(r[4]), extra: "" } as ColMeta)),
      indexes: rows.some((r) => r[5]) ? [{ name: "PRIMARY", cols: rows.filter((r) => r[5]).map((r) => String(r[1])), unique: true, primary: true }] : [],
      constraints: [],
    };
  }

  private makeIndex(e: DbEntry, table: string, name: string, cols: string[], unique: boolean) {
    e.db.run(`CREATE ${unique ? "UNIQUE " : ""}INDEX \`${table}__${name}\` ON \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")})`);
    const t = e.tables[table];
    if (t) {
      t.indexes = t.indexes.filter((i) => i.name !== name);
      t.indexes.push({ name, cols, unique });
      const first = t.cols.find((c) => c.name === cols[0]);
      if (first && !first.key) first.key = unique && cols.length === 1 ? "UNI" : "MUL";
    }
  }

  private dropTable(sqlIn: string) {
    const sql = this.unqualify(sqlIn);
    const m = sql.match(/^DROP\s+(?:TEMPORARY\s+)?TABLE\s+(IF\s+EXISTS\s+)?([\s\S]+)$/i);
    const e = this.entry();
    this.endTxnForDdl();
    const names = m![2].split(",").map((x) => x.trim().replace(/`/g, "").replace(/^\w+\./, ""));
    const missing = names.filter((n) => !e.tables[n]);
    if (missing.length && !m![1]) return fail(1051, "42S02", `Unknown table '${this.current}.${missing.join(",")}'`);
    for (const n of names) {
      if (!e.tables[n]) continue;
      this.requireTable("DROP", this.current!, n);
      try { e.db.run(`DROP TABLE \`${n}\``); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
      delete e.tables[n];
    }
    return { affected: 0 };
  }

  private truncate(sqlIn: string) {
    const m = this.unqualify(sqlIn).match(/^TRUNCATE\s+(?:TABLE\s+)?`?(\w+)`?/i);
    const e = this.entry();
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sqlIn.slice(0, 30)}'`);
    if (!e.tables[m[1]]) return fail(1146, "42S02", `Table '${this.current}.${m[1]}' doesn't exist`);
    this.requireTable("DROP", this.current!, m[1]);
    this.endTxnForDdl();
    try { e.db.run(`DELETE FROM \`${m[1]}\``); } catch (err) { return this.mapError(err as Error, sqlIn, this.current!); }
    try { e.db.run(`DELETE FROM sqlite_sequence WHERE name='${m[1]}'`); } catch { /* no AUTO_INCREMENT table yet */ }
    return { affected: 0 };
  }

  private renameTable(sql: string) {
    const e = this.entry();
    this.endTxnForDdl();
    for (const pair of sql.replace(/^RENAME\s+TABLE\s+/i, "").split(",")) {
      const m = pair.trim().match(/^`?(\w+)`?\s+TO\s+`?(\w+)`?$/i);
      if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${pair}'`);
      if (!e.tables[m[1]]) return fail(1146, "42S02", `Table '${this.current}.${m[1]}' doesn't exist`);
      if (e.tables[m[2]]) return fail(1050, "42S01", `Table '${m[2]}' already exists`);
      this.requireTable("ALTER", this.current!, m[1]);
      e.db.run(`ALTER TABLE \`${m[1]}\` RENAME TO \`${m[2]}\``);
      e.tables[m[2]] = e.tables[m[1]];
      delete e.tables[m[1]];
    }
    return { affected: 0 };
  }

  private createIndex(sql: string) {
    const m = this.unqualify(sql).match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s+(?:USING\s+\w+\s+)?ON\s+`?(\w+)`?\s*\(([^)]*)\)/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' at line 1`);
    const e = this.entry();
    if (!e.tables[m[3]]) return fail(1146, "42S02", `Table '${this.current}.${m[3]}' doesn't exist`);
    this.requireTable("INDEX", this.current!, m[3]);
    this.endTxnForDdl();
    const cols = m[4].split(",").map((c) => c.trim().replace(/`/g, "").replace(/\(\d+\)/, "").replace(/\s+(ASC|DESC)$/i, ""));
    for (const c of cols) if (!e.tables[m[3]].cols.some((x) => x.name === c)) return fail(1072, "42000", `Key column '${c}' doesn't exist in table`);
    if (e.tables[m[3]].indexes.some((i) => i.name === m[2])) return fail(1061, "42000", `Duplicate key name '${m[2]}'`);
    try { this.makeIndex(e, m[3], m[2], cols, !!m[1]); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
    return { text: ["Query OK, 0 rows affected (0.001 sec)", "Records: 0  Duplicates: 0  Warnings: 0"] };
  }

  private dropIndex(sql: string) {
    const m = this.unqualify(sql).match(/^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?\s+ON\s+`?(\w+)`?/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' (MariaDB needs: DROP INDEX name ON table)`);
    return this.removeIndex(m[2], m[1]);
  }

  private removeIndex(table: string, name: string) {
    const e = this.entry();
    const t = e.tables[table];
    if (!t) return fail(1146, "42S02", `Table '${this.current}.${table}' doesn't exist`);
    this.requireTable("INDEX", this.current!, table);
    const ix = t.indexes.find((i) => i.name === name);
    if (!ix) return fail(1091, "42000", `Can't DROP INDEX \`${name}\`; check that it exists`);
    this.endTxnForDdl();
    if (!ix.primary && !ix.virtual) { try { e.db.run(`DROP INDEX \`${table}__${name}\``); } catch { /* an automatic UNIQUE index has no separate name */ } }
    t.indexes = t.indexes.filter((i) => i !== ix);
    for (const c of t.cols) if (c.key !== "PRI") c.key = t.indexes.some((i) => i.cols[0] === c.name) ? (t.indexes.find((i) => i.cols[0] === c.name)!.unique && t.indexes.find((i) => i.cols[0] === c.name)!.cols.length === 1 ? "UNI" : "MUL") : "";
    return { text: ["Query OK, 0 rows affected (0.001 sec)", "Records: 0  Duplicates: 0  Warnings: 0"] };
  }

  private alterTable(sqlIn: string) {
    const sql = this.unqualify(sqlIn);
    const head = sql.match(/^ALTER\s+(?:IGNORE\s+)?TABLE\s+`?(\w+)`?\s+([\s\S]*)$/i);
    if (!head) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' at line 1`);
    const e = this.entry();
    let table = head[1];
    const meta = e.tables[table];
    if (!meta) return fail(1146, "42S02", `Table '${this.current}.${table}' doesn't exist`);
    this.requireTable("ALTER", this.current!, table);
    this.endTxnForDdl();
    const m = mask(head[2]);
    const actions = splitTop(m.text);
    for (const raw of actions) {
      const a = raw.trim();
      let mm: RegExpMatchArray | null;
      if ((mm = a.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!(?:PRIMARY|UNIQUE|INDEX|KEY|CONSTRAINT|FOREIGN|FULLTEXT)\b)([\s\S]+)$/i))) {
        const body = mm[1].replace(/\s+(FIRST|AFTER\s+\w+)\s*$/i, "");
        const col = parseColumn(body, m);
        if (meta.cols.some((c) => c.name === col.meta.name)) return fail(1060, "42S21", `Duplicate column name '${col.meta.name}'`);
        let ddl = col.sql.replace(/ PRIMARY KEY( AUTOINCREMENT)?/, "").replace(/ UNIQUE/, "");
        if (/NOT NULL/.test(ddl) && !/DEFAULT/.test(ddl)) ddl += ` DEFAULT ${/INTEGER|REAL|NUMERIC|DECIMAL/i.test(ddl) ? "0" : "''"}`;
        try { e.db.run(`ALTER TABLE \`${table}\` ADD COLUMN ${unmask(m, ddl)}`); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
        meta.cols.push(col.meta);
        if (col.unique) { this.makeIndex(e, table, col.meta.name, [col.meta.name], true); }
      } else if ((mm = a.match(/^ADD\s+(UNIQUE\s+)?(?:INDEX|KEY)\s*(\u0001\d+\u0001|\w+)?\s*\(([^)]*)\)/i)) || (mm = a.match(/^ADD\s+(UNIQUE)(?:\s+(?:INDEX|KEY))?\s*(\u0001\d+\u0001|\w+)?\s*\(([^)]*)\)/i))) {
        const cols = unmask(m, mm[3]).split(",").map((c) => c.trim().replace(/`/g, "").replace(/\(\d+\)/, ""));
        const name = mm[2] ? unmask(m, mm[2]).replace(/`/g, "") : cols[0];
        for (const c of cols) if (!meta.cols.some((x) => x.name === c)) return fail(1072, "42000", `Key column '${c}' doesn't exist in table`);
        if (meta.indexes.some((i) => i.name === name)) return fail(1061, "42000", `Duplicate key name '${name}'`);
        try { this.makeIndex(e, table, name, cols, !!mm[1]); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
      } else if ((mm = a.match(/^ADD\s+(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i))) {
        if (meta.indexes.some((i) => i.primary)) return fail(1068, "42000", "Multiple primary key defined");
        const cols = mm[1].split(",").map((c) => c.trim().replace(/`/g, ""));
        try { e.db.run(`CREATE UNIQUE INDEX \`${table}__PRIMARY\` ON \`${table}\` (${cols.map((c) => `\`${c}\``).join(",")})`); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
        meta.indexes.unshift({ name: "PRIMARY", cols, unique: true, primary: true });
        for (const c of cols) { const cm = meta.cols.find((x) => x.name === c); if (cm) { cm.key = "PRI"; cm.nullable = false; } }
      } else if (/^ADD\s+(?:CONSTRAINT\b|FOREIGN\s+KEY\b)/i.test(a)) {
        return fail(1235, "42000", "Adding a FOREIGN KEY with ALTER TABLE is not supported by this practice server; declare it in CREATE TABLE instead");
      } else if ((mm = a.match(/^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?`?(\w+)`?\s*$/i)) && !/^DROP\s+(PRIMARY|INDEX|KEY|FOREIGN|CONSTRAINT)\b/i.test(a)) {
        if (!meta.cols.some((c) => c.name === mm![1])) return fail(1091, "42000", `Can't DROP COLUMN \`${mm[1]}\`; check that it exists`);
        if (meta.cols.length === 1) return fail(1090, "42000", "You can't delete all columns with ALTER TABLE; use DROP TABLE instead");
        for (const ix of meta.indexes.filter((i) => i.cols.includes(mm![1]) && !i.primary)) { try { e.db.run(`DROP INDEX \`${table}__${ix.name}\``); } catch { /* automatic index */ } }
        try { e.db.run(`ALTER TABLE \`${table}\` DROP COLUMN \`${mm[1]}\``); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
        meta.cols = meta.cols.filter((c) => c.name !== mm![1]);
        meta.indexes = meta.indexes.filter((i) => !i.cols.includes(mm![1]));
      } else if ((mm = a.match(/^DROP\s+(?:INDEX|KEY)\s+`?(\w+)`?/i))) this.removeIndex(table, mm[1]);
      else if (/^DROP\s+PRIMARY\s+KEY/i.test(a)) {
        const pk = meta.indexes.find((i) => i.primary);
        if (!pk) return fail(1091, "42000", "Can't DROP PRIMARY KEY; check that it exists");
        try { e.db.run(`DROP INDEX \`${table}__PRIMARY\``); } catch { return fail(1235, "42000", "This practice server can only drop a PRIMARY KEY that was added with ALTER TABLE"); }
        meta.indexes = meta.indexes.filter((i) => i !== pk);
        for (const c of pk.cols) { const cm = meta.cols.find((x) => x.name === c); if (cm) { cm.key = ""; cm.nullable = true; } }
      } else if ((mm = a.match(/^(MODIFY|CHANGE)\s+(?:COLUMN\s+)?`?(\w+)`?\s+([\s\S]+)$/i))) {
        const oldName = mm[2];
        const cm = meta.cols.find((c) => c.name === oldName);
        if (!cm) return fail(1054, "42S22", `Unknown column '${oldName}' in 'table'`);
        let def = mm[3].replace(/\s+(FIRST|AFTER\s+\w+)\s*$/i, "");
        let newName = oldName;
        if (/^CHANGE$/i.test(mm[1])) { const nm = def.match(/^`?(\w+)`?\s+([\s\S]+)$/); if (!nm) return fail(1064, "42000", `You have an error in your SQL syntax near '${a}'`); newName = nm[1]; def = nm[2]; }
        const col = parseColumn(`${newName} ${def}`, m);
        if (newName !== oldName) {
          if (meta.cols.some((c) => c.name === newName)) return fail(1060, "42S21", `Duplicate column name '${newName}'`);
          try { e.db.run(`ALTER TABLE \`${table}\` RENAME COLUMN \`${oldName}\` TO \`${newName}\``); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
          for (const ix of meta.indexes) ix.cols = ix.cols.map((c) => (c === oldName ? newName : c));
        }
        cm.name = newName; cm.type = col.meta.type; cm.nullable = cm.key === "PRI" ? false : col.meta.nullable; cm.def = col.meta.def; cm.extra = col.meta.extra || (cm.extra && /auto/.test(cm.extra) && col.meta.extra === "" ? "" : col.meta.extra);
      } else if ((mm = a.match(/^RENAME\s+COLUMN\s+`?(\w+)`?\s+TO\s+`?(\w+)`?/i))) {
        const cm = meta.cols.find((c) => c.name === mm![1]);
        if (!cm) return fail(1054, "42S22", `Unknown column '${mm[1]}' in 'table'`);
        try { e.db.run(`ALTER TABLE \`${table}\` RENAME COLUMN \`${mm[1]}\` TO \`${mm[2]}\``); } catch (err) { return this.mapError(err as Error, sql, this.current!); }
        for (const ix of meta.indexes) ix.cols = ix.cols.map((c) => (c === mm![1] ? mm![2] : c));
        cm.name = mm[2];
      } else if ((mm = a.match(/^RENAME\s+(?:TO\s+|AS\s+)?`?(\w+)`?\s*$/i))) {
        if (e.tables[mm[1]]) return fail(1050, "42S01", `Table '${mm[1]}' already exists`);
        e.db.run(`ALTER TABLE \`${table}\` RENAME TO \`${mm[1]}\``);
        e.tables[mm[1]] = meta; delete e.tables[table]; table = mm[1];
      } else if (/^(ENGINE|DEFAULT\s+CHARSET|CHARSET|COLLATE|COMMENT|ROW_FORMAT|CONVERT\s+TO)\b/i.test(a)) continue;
      else if ((mm = a.match(/^AUTO_INCREMENT\s*=?\s*(\d+)/i))) { e.db.run(`INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES ('${table}', ${Number(mm[1]) - 1})`); }
      else return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${unmask(m, a)}' at line 1`);
    }
    return { text: [`Query OK, 0 rows affected (0.002 sec)`, "Records: 0  Duplicates: 0  Warnings: 0"] };
  }

  // ----- SHOW / DESCRIBE / EXPLAIN -----

  private colRows(meta: TableMeta): unknown[][] {
    return meta.cols.map((c) => [c.name, c.type, c.nullable ? "YES" : "NO", c.key, c.def ?? null, c.extra]);
  }

  private describe(arg: string) {
    const m = this.unqualify(arg).match(/^`?(?:\w+`?\s*\.\s*`?)?(\w+)`?/);
    const e = this.entry();
    const t = m?.[1] ?? "";
    if (!e.tables[t]) return fail(1146, "42S02", `Table '${this.current}.${t}' doesn't exist`);
    this.requireTable("SELECT", this.current!, t);
    return { table: { columns: ["Field", "Type", "Null", "Key", "Default", "Extra"], rows: this.colRows(e.tables[t]) } };
  }

  private show(sql: string) {
    const up = sql.toUpperCase().replace(/\s+/g, " ");
    let m: RegExpMatchArray | null;
    const like = (rows: unknown[][], pattern: string | undefined, idx = 0) => {
      if (!pattern) return rows;
      const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
      return rows.filter((r) => re.test(String(r[idx])));
    };
    const likeArg = sql.match(/\bLIKE\s+'([^']*)'/i)?.[1];
    if (/^SHOW (DATABASES|SCHEMAS)/.test(up)) {
      const visible = ["information_schema", ...(this.user === "root" ? ["mysql", "performance_schema"] : []), ...this.databases().filter((d) => this.anyAccess(d))].sort();
      return { table: { columns: ["Database"], rows: like(visible.map((d) => [d]), likeArg) } };
    }
    if ((m = sql.match(/^SHOW\s+(FULL\s+)?TABLES(?:\s+(?:FROM|IN)\s+`?(\w+)`?)?/i))) {
      const db = m[2] ?? this.current;
      if (!db) return fail(1046, "3D000", "No database selected");
      if (!this.dbs[db]) return fail(1049, "42000", `Unknown database '${db}'`);
      if (!this.anyAccess(db)) return fail(1044, "42000", `Access denied for user '${this.user}'@'localhost' to database '${db}'`);
      const rows = this.tables(db).map((t) => (m![1] ? [t, "BASE TABLE"] : [t]));
      return { table: { columns: [`Tables_in_${db}`, ...(m[1] ? ["Table_type"] : [])], rows: like(rows, likeArg) } };
    }
    if ((m = sql.match(/^SHOW\s+(?:FULL\s+)?(?:COLUMNS|FIELDS)\s+(?:FROM|IN)\s+`?(?:\w+`?\s*\.\s*`?)?(\w+)`?/i))) return this.describe(m[1]);
    if ((m = sql.match(/^SHOW\s+CREATE\s+DATABASE\s+`?(\w+)`?/i))) {
      if (!this.dbs[m[1]]) return fail(1049, "42000", `Unknown database '${m[1]}'`);
      return { table: { columns: ["Database", "Create Database"], rows: [[m[1], `CREATE DATABASE \`${m[1]}\` /*!40100 DEFAULT CHARACTER SET utf8mb4 */`]] } };
    }
    if ((m = sql.match(/^SHOW\s+CREATE\s+TABLE\s+`?(?:\w+`?\s*\.\s*`?)?(\w+)`?/i))) {
      const e = this.entry();
      if (!e.tables[m[1]]) return fail(1146, "42S02", `Table '${this.current}.${m[1]}' doesn't exist`);
      this.requireTable("SELECT", this.current!, m[1]);
      return { table: { columns: ["Table", "Create Table"], rows: [[m[1], this.createText(m[1], e.tables[m[1]])]] } };
    }
    if ((m = sql.match(/^SHOW\s+(?:INDEX|INDEXES|KEYS)\s+(?:FROM|IN)\s+`?(?:\w+`?\s*\.\s*`?)?(\w+)`?/i))) {
      const e = this.entry();
      const t = e.tables[m[1]];
      if (!t) return fail(1146, "42S02", `Table '${this.current}.${m[1]}' doesn't exist`);
      this.ev("show-index");
      const n = Number(e.db.exec(`SELECT COUNT(*) FROM \`${m[1]}\``)[0].values[0][0]);
      const rows = [...t.indexes].sort((a, b) => Number(!!b.primary) - Number(!!a.primary)).flatMap((ix) => ix.cols.map((c, i) => [m![1], ix.unique ? 0 : 1, ix.name, i + 1, c, "A", n, null, null, t.cols.find((x) => x.name === c)?.nullable && !ix.primary ? "YES" : "", "BTREE", "", "", "NO"]));
      return { table: { columns: ["Table", "Non_unique", "Key_name", "Seq_in_index", "Column_name", "Collation", "Cardinality", "Sub_part", "Packed", "Null", "Index_type", "Comment", "Index_comment", "Ignored"], rows } };
    }
    if ((m = sql.match(/^SHOW\s+GRANTS(?:\s+FOR\s+(.+))?$/i))) {
      const target = m[1] ? this.parseAccount(m[1]) : { name: this.user, host: "localhost" };
      if (target.name !== this.user) this.requireRoot("SELECT");
      if (!this.users.some((u) => u.name === target.name && (u.host === target.host))) return fail(1141, "42000", `There is no such grant defined for user '${target.name}' on host '${target.host}'`);
      const lines = this.grantLines(target.name, target.host);
      return { table: { columns: [`Grants for ${target.name}@${target.host}`], rows: lines.map((l) => [l]) } };
    }
    if ((m = up.match(/^SHOW (?:GLOBAL |SESSION )?VARIABLES(?: LIKE '([^']*)')?/))) {
      const vars: unknown[][] = [["autocommit", this.autocommit ? "ON" : "OFF"], ["bind_address", "127.0.0.1"], ["character_set_server", "utf8mb4"], ["datadir", "/var/lib/mysql/"], ["hostname", "lab"], ["innodb_buffer_pool_size", "134217728"], ["max_connections", "151"], ["port", "3306"], ["sql_mode", "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION"], ["time_zone", "SYSTEM"], ["version", VERSION], ["version_comment", "mariadb.org binary distribution"]];
      return { table: { columns: ["Variable_name", "Value"], rows: like(vars, likeArg) } };
    }
    if (/^SHOW (?:GLOBAL |SESSION )?STATUS/.test(up)) {
      const st: unknown[][] = [["Connections", 8], ["Questions", this.version], ["Threads_connected", 1], ["Threads_running", 1], ["Uptime", 3731]];
      return { table: { columns: ["Variable_name", "Value"], rows: like(st, likeArg) } };
    }
    if (/^SHOW (FULL )?PROCESSLIST/.test(up)) {
      return { table: { columns: ["Id", "User", "Host", "db", "Command", "Time", "State", "Info"], rows: [[8, this.user, "localhost", this.current, "Query", 0, "starting", "SHOW PROCESSLIST"]] } };
    }
    if (/^SHOW WARNINGS|^SHOW ERRORS/.test(up)) return { table: { columns: ["Level", "Code", "Message"], rows: [] } };
    if (/^SHOW (STORAGE )?ENGINES/.test(up)) return { table: { columns: ["Engine", "Support", "Comment"], rows: [["InnoDB", "DEFAULT", "Supports transactions, row-level locking, foreign keys and encryption for tables"], ["Aria", "YES", "Crash-safe tables with MyISAM heritage"], ["MyISAM", "YES", "Non-transactional engine with good performance"]] } };
    if ((m = sql.match(/^SHOW\s+TABLE\s+STATUS/i))) {
      const e = this.entry();
      return { table: { columns: ["Name", "Engine", "Rows"], rows: this.tables(this.current!).map((t) => [t, "InnoDB", Number(e.db.exec(`SELECT COUNT(*) FROM \`${t}\``)[0].values[0][0])]) } };
    }
    return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${sql.slice(5, 45)}' at line 1`);
  }

  private createText(table: string, meta: TableMeta): string {
    const lines: string[] = meta.cols.map((c) => `  \`${c.name}\` ${c.type}${c.nullable ? "" : " NOT NULL"}${c.extra ? ` ${c.extra.toUpperCase()}` : ""}${c.def !== null ? ` DEFAULT ${/^[\d.+-]+$|\(|^CURRENT_TIMESTAMP/i.test(c.def) ? c.def : `'${c.def}'`}` : c.nullable && !c.extra ? " DEFAULT NULL" : ""}`);
    for (const ix of meta.indexes) lines.push(ix.primary ? `  PRIMARY KEY (${ix.cols.map((c) => `\`${c}\``).join(",")})` : `  ${ix.unique ? "UNIQUE KEY" : "KEY"} \`${ix.name}\` (${ix.cols.map((c) => `\`${c}\``).join(",")})`);
    for (const k of meta.constraints) lines.push(`  ${k}`);
    const ai = meta.cols.some((c) => /auto_increment/.test(c.extra));
    const seq = Number((ai ? this.dbs[this.current ?? ""]?.db.exec(`SELECT seq FROM sqlite_sequence WHERE name='${table}'`)[0]?.values[0]?.[0] : 0) ?? 0);
    return `CREATE TABLE \`${table}\` (\n${lines.join(",\n")}\n) ENGINE=InnoDB${ai && seq > 0 ? ` AUTO_INCREMENT=${seq + 1}` : ""} DEFAULT CHARSET=utf8mb4`;
  }

  private explain(sqlIn: string) {
    const inner = sqlIn.replace(/^EXPLAIN\s+(?:EXTENDED\s+)?/i, "");
    if (/^(DELETE|UPDATE|INSERT)/i.test(inner)) return fail(1235, "42000", "EXPLAIN is supported for SELECT statements in this practice server");
    if (!/^SELECT|^WITH/i.test(inner)) return this.describe(inner);
    const sql = this.unqualify(inner);
    const e = this.entry();
    const translated = rewriteDml(sql, { vars: this.vars });
    let plan: unknown[][];
    try { plan = e.db.exec(`EXPLAIN QUERY PLAN ${translated}`)[0]?.values ?? []; } catch (err) { return this.mapError(err as Error, sql, this.current!); }
    const aliases: Record<string, string> = {};
    for (const a of sql.matchAll(/\b(?:FROM|JOIN)\s+`?(\w+)`?(?:\s+(?:AS\s+)?(\w+))?/gi)) if (a[2] && !/^(WHERE|JOIN|LEFT|RIGHT|INNER|ON|GROUP|ORDER|LIMIT|CROSS|USING|HAVING|UNION)$/i.test(a[2])) aliases[a[2]] = a[1];
    const rows: unknown[][] = [];
    const extras: string[] = [];
    let first = true;
    for (const r of plan) {
      const d = String(r[3]);
      let m: RegExpMatchArray | null;
      if (/USE TEMP B-TREE FOR (ORDER BY|GROUP BY|DISTINCT)/.test(d)) { extras.push(/GROUP BY|DISTINCT/.test(d) ? "Using temporary" : "Using filesort"); if (/ORDER BY/.test(d)) continue; continue; }
      if ((m = d.match(/^(SCAN|SEARCH)\s+(\w+)(?:\s+USING\s+(.*))?/))) {
        const t = aliases[m[2]] ?? m[2];
        const meta = e.tables[t];
        const n = meta ? Number(e.db.exec(`SELECT COUNT(*) FROM \`${t}\``)[0].values[0][0]) : null;
        let type = "ALL", key: string | null = null, rowsEst: unknown = n, extra = /\bWHERE\b/i.test(sql) && m[1] === "SCAN" ? "Using where" : "";
        if (m[1] === "SEARCH") {
          const u = m[3] ?? "";
          if (/PRIMARY KEY/.test(u)) { type = first ? "const" : "eq_ref"; key = "PRIMARY"; rowsEst = 1; }
          else {
            const idx = u.match(/INDEX\s+(\S+)/)?.[1] ?? "";
            const name = idx.startsWith(`${t}__`) ? idx.slice(t.length + 2) : meta?.indexes.find((i) => i.unique && !i.primary)?.name ?? idx;
            key = name; type = "ref"; rowsEst = 1; extra = /COVERING/.test(u) ? "Using index" : /\(.*>|<.*\)/.test(u) ? "Using index condition" : "";
            if (/[<>]/.test(u)) { type = "range"; rowsEst = Math.max(1, Math.round((n ?? 2) / 2)); }
          }
        }
        rows.push([1, "SIMPLE", m[2], type, key, key, key === "PRIMARY" ? "4" : key ? "5" : null, key ? "const" : null, rowsEst, extra]);
        first = false;
      }
    }
    if (extras.length && rows.length) rows[0][9] = [rows[0][9], ...extras].filter(Boolean).join("; ");
    if (!rows.length) rows.push([1, "SIMPLE", null, null, null, null, null, null, null, "No tables used"]);
    for (const r of rows) { r[4] = r[5]; if (r[3] === "ALL") { r[4] = null; } }
    this.ev(rows.some((r) => r[3] === "ALL") ? "explain-all" : "explain-indexed");
    for (const r of rows) if (r[5]) this.ev(`explain-key:${r[5]}`);
    return { table: { columns: ["id", "select_type", "table", "type", "possible_keys", "key", "key_len", "ref", "rows", "Extra"], rows } };
  }

  // ----- users and privileges -----

  private parseAccount(text: string): { name: string; host: string } {
    const t = text.trim().replace(/;$/, "");
    const m = t.match(/^(?:'([^']*)'|`([^`]*)`|"([^"]*)"|([\w.-]+))(?:@(?:'([^']*)'|`([^`]*)`|([\w.%-]+)))?$/);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${t}' at line 1`);
    return { name: m[1] ?? m[2] ?? m[3] ?? m[4], host: m[5] ?? m[6] ?? m[7] ?? "%" };
  }

  private createUser(sql: string) {
    this.requireRoot("CREATE USER");
    const m = sql.match(/^CREATE\s+(OR\s+REPLACE\s+)?USER\s+(IF\s+NOT\s+EXISTS\s+)?(.+?)(?:\s+IDENTIFIED\s+BY\s+(?:PASSWORD\s+)?'([^']*)')?$/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' at line 1`);
    const acct = this.parseAccount(m[3]);
    const existing = this.users.find((u) => u.name === acct.name && u.host === acct.host);
    if (existing) {
      if (m[1]) { existing.password = m[4] ?? ""; return { affected: 0 }; }
      if (m[2]) return { text: ["Query OK, 0 rows affected, 1 warning (0.000 sec)"] };
      return fail(1396, "HY000", `Operation CREATE USER failed for '${acct.name}'@'${acct.host}'`);
    }
    this.users.push({ ...acct, password: m[4] ?? "" });
    return { affected: 0 };
  }

  private dropUser(sql: string) {
    this.requireRoot("CREATE USER");
    const m = sql.match(/^DROP\s+USER\s+(IF\s+EXISTS\s+)?(.+)$/i)!;
    for (const part of splitTop(m[2])) {
      const a = this.parseAccount(part);
      const i = this.users.findIndex((u) => u.name === a.name && u.host === a.host);
      if (i < 0) { if (m[1]) continue; return fail(1396, "HY000", `Operation DROP USER failed for '${a.name}'@'${a.host}'`); }
      this.users.splice(i, 1);
      this.grants = this.grants.filter((g) => !(g.user === a.name && g.host === a.host));
    }
    return { affected: 0 };
  }

  private alterUser(sql: string) {
    const m = sql.match(/^ALTER\s+USER\s+(IF\s+EXISTS\s+)?(.+?)\s+IDENTIFIED\s+BY\s+'([^']*)'$/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' at line 1`);
    const a = m[2].toUpperCase() === "USER()" ? { name: this.user, host: "localhost" } : this.parseAccount(m[2]);
    if (a.name !== this.user) this.requireRoot("CREATE USER");
    const u = this.users.find((x) => x.name === a.name && (x.host === a.host || a.host === "%" || x.host === "localhost"));
    if (!u) return m[1] ? { affected: 0 } : fail(1396, "HY000", `Operation ALTER USER failed for '${a.name}'@'${a.host}'`);
    u.password = m[3];
    return { affected: 0 };
  }

  private parseGrantTarget(text: string): { db: string; table: string } {
    const t = text.trim().replace(/`/g, "");
    if (t === "*" || t === "*.*") return { db: "*", table: "*" };
    const [db, table] = t.includes(".") ? t.split(".") : [this.current ?? "*", t];
    return { db: db === "*" ? this.current ?? "*" : db, table: table ?? "*" };
  }

  private grant(sql: string) {
    this.requireRoot("GRANT OPTION");
    const m = sql.match(/^GRANT\s+(.+?)\s+ON\s+(?:TABLE\s+)?(\S+)\s+TO\s+(.+?)(?:\s+IDENTIFIED\s+BY\s+'([^']*)')?(\s+WITH\s+GRANT\s+OPTION)?$/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax; check the manual near '${sql.slice(0, 50)}' at line 1`);
    const privs = m[1].split(",").map((p) => p.trim().toUpperCase().replace(/\s+PRIVILEGES$/, "")).map((p) => (p === "ALL" ? "ALL" : p));
    for (const p of privs) if (p !== "ALL" && p !== "USAGE" && !PRIVS.includes(p)) return fail(1064, "42000", `You have an error in your SQL syntax near '${p}'`);
    const target = this.parseGrantTarget(m[2]);
    if (target.db !== "*" && !this.dbs[target.db] && !SYSTEM_DBS.includes(target.db)) { /* MariaDB allows granting on databases that do not exist yet */ }
    const acct = this.parseAccount(m[3]);
    let u = this.users.find((x) => x.name === acct.name && x.host === acct.host);
    if (!u) {
      if (m[4] === undefined) return fail(1133, "42000", `Can't find any matching row in the user table`);
      u = { ...acct, password: m[4] }; this.users.push(u);
    } else if (m[4] !== undefined) u.password = m[4];
    const real = privs.filter((p) => p !== "USAGE");
    if (real.length) {
      const g = this.grants.find((x) => x.user === acct.name && x.host === acct.host && x.db === target.db && x.table === target.table);
      if (g) g.privs = [...new Set([...g.privs, ...real, ...(m[5] ? ["GRANT OPTION"] : [])])];
      else this.grants.push({ user: acct.name, host: acct.host, privs: [...real, ...(m[5] ? ["GRANT OPTION"] : [])], db: target.db, table: target.table });
    }
    return { affected: 0 };
  }

  private revoke(sql: string) {
    this.requireRoot("GRANT OPTION");
    const m = sql.match(/^REVOKE\s+(.+?)\s+ON\s+(?:TABLE\s+)?(\S+)\s+FROM\s+(.+)$/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}' at line 1`);
    const privs = m[1].split(",").map((p) => p.trim().toUpperCase().replace(/\s+PRIVILEGES$/, ""));
    const target = this.parseGrantTarget(m[2]);
    const acct = this.parseAccount(m[3]);
    const g = this.grants.find((x) => x.user === acct.name && x.host === acct.host && x.db === target.db && x.table === target.table);
    if (!g) return fail(1141, "42000", `There is no such grant defined for user '${acct.name}' on host '${acct.host}'`);
    if (privs.includes("ALL")) g.privs = [];
    else g.privs = g.privs.includes("ALL") ? ALL_PRIVS.filter((p) => !privs.includes(p)) : g.privs.filter((p) => !privs.includes(p));
    if (!g.privs.length) this.grants = this.grants.filter((x) => x !== g);
    return { affected: 0 };
  }

  private grantLines(name: string, host: string): string[] {
    const u = this.users.find((x) => x.name === name && x.host === host);
    if (!u) return [];
    const who = `\`${name}\`@\`${host}\``;
    const out: string[] = [];
    const base = name === "root" ? `GRANT ALL PRIVILEGES ON *.* TO ${who} WITH GRANT OPTION` : `GRANT USAGE ON *.* TO ${who}`;
    out.push(u.password && name !== "root" ? `${base} IDENTIFIED BY PASSWORD '${this.fakeHash(u.password)}'` : base);
    for (const g of this.grants.filter((x) => x.user === name && x.host === host)) {
      const grantOpt = g.privs.includes("GRANT OPTION");
      const list = g.privs.filter((p) => p !== "GRANT OPTION");
      const p = list.includes("ALL") || list.length >= ALL_PRIVS.length ? "ALL PRIVILEGES" : list.join(", ");
      const on = `${g.db === "*" ? "*" : `\`${g.db}\``}.${g.table === "*" ? "*" : `\`${g.table}\``}`;
      out.push(`GRANT ${p} ON ${on} TO ${who}${grantOpt ? " WITH GRANT OPTION" : ""}`);
    }
    return out;
  }

  // ----- variables and transactions -----

  private set(sql: string) {
    const m = sql.match(/^SET\s+(?:(?:GLOBAL|SESSION)\s+)?(@{0,2})(\w+)\s*(?::?=)\s*([\s\S]+)$/i);
    if (/^SET\s+PASSWORD\b/i.test(sql)) {
      const p = sql.match(/^SET\s+PASSWORD(?:\s+FOR\s+(.+?))?\s*=\s*(?:PASSWORD\()?'([^']*)'\)?$/i);
      if (!p) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql.slice(0, 40)}'`);
      const a = p[1] ? this.parseAccount(p[1]) : { name: this.user, host: "localhost" };
      if (a.name !== this.user) this.requireRoot("UPDATE");
      const u = this.users.find((x) => x.name === a.name && (x.host === a.host || x.host === "localhost"));
      if (!u) return fail(1133, "42000", "Can't find any matching row in the user table");
      u.password = p[2];
      return { affected: 0 };
    }
    if (/^SET\s+(NAMES|CHARACTER|SQL_MODE|FOREIGN_KEY_CHECKS|UNIQUE_CHECKS|TIME_ZONE|SQL_NOTES)/i.test(sql)) {
      if (/^SET\s+FOREIGN_KEY_CHECKS\s*=\s*(\d|ON|OFF)/i.test(sql)) { const on = /=\s*(1|ON)/i.test(sql); for (const e of Object.values(this.dbs)) e.db.run(`PRAGMA foreign_keys = ${on ? "ON" : "OFF"}`); }
      return { affected: 0 };
    }
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${sql.slice(4, 44)}' at line 1`);
    const [, at, name, expr] = m;
    if (name.toLowerCase() === "autocommit" && at !== "@") {
      const on = /^(1|on|true)$/i.test(expr.trim());
      if (on && this.inTxn) this.commit();
      this.autocommit = on;
      return { affected: 0 };
    }
    if (at === "@") {
      const e = this.current && this.dbs[this.current] ? this.dbs[this.current].db : this.scratch().db;
      try {
        const v = e.exec(`SELECT ${rewriteDml(expr, { vars: this.vars })}`)[0]?.values[0][0];
        this.vars[name.toLowerCase()] = v === undefined ? null : (v as string | number | null);
      } catch (err) { return this.mapError(err as Error, sql, this.current ?? ""); }
      return { affected: 0 };
    }
    return { affected: 0 };
  }

  private begin() {
    const name = this.current;
    if (!name || !this.dbs[name]) return fail(1046, "3D000", "No database selected");
    if (this.inTxn) this.commit();
    this.dbs[name].db.run("BEGIN");
    this.inTxn = true; this.txnDb = name;
    return { affected: 0 };
  }

  private commit() {
    if (this.inTxn && this.txnDb && this.dbs[this.txnDb]) { this.dbs[this.txnDb].db.run("COMMIT"); this.ev("commit"); }
    this.inTxn = false; this.txnDb = null;
    return { affected: 0 };
  }

  private rollback(sql: string) {
    const to = sql.match(/^ROLLBACK\s+TO\s+(?:SAVEPOINT\s+)?`?(\w+)`?/i);
    if (to) {
      if (!this.inTxn || !this.txnDb) return fail(1305, "42000", `SAVEPOINT ${to[1]} does not exist`);
      try { this.dbs[this.txnDb].db.run(`ROLLBACK TO \`${to[1]}\``); } catch { return fail(1305, "42000", `SAVEPOINT ${to[1]} does not exist`); }
      return { affected: 0 };
    }
    if (this.inTxn && this.txnDb && this.dbs[this.txnDb]) { this.dbs[this.txnDb].db.run("ROLLBACK"); this.ev("rollback"); }
    this.inTxn = false; this.txnDb = null;
    return { affected: 0 };
  }

  private savepoint(sql: string) {
    const m = sql.match(/^(SAVEPOINT|RELEASE\s+SAVEPOINT)\s+`?(\w+)`?/i);
    if (!m) return fail(1064, "42000", `You have an error in your SQL syntax near '${sql}'`);
    if (!this.inTxn || !this.txnDb) return { affected: 0 };
    this.dbs[this.txnDb].db.run(/^SAVEPOINT/i.test(m[1]) ? `SAVEPOINT \`${m[2]}\`` : `RELEASE \`${m[2]}\``);
    return { affected: 0 };
  }

  // ----- sample data and dumps -----

  // Run a MariaDB-dialect script as root (used to load the sample databases).
  // Run statements as root without printing anything (exercise set-up).
  runSilent(script: string) {
    const prevUser = this.user, prevDb = this.current;
    this.user = "root";
    for (const s of splitStatements(script).stmts) this.execute(s.sql);
    this.user = prevUser; this.current = prevDb;
    this.version++;
  }

  load(dbName: string, script: string) {
    const prevUser = this.user, prevDb = this.current;
    this.user = "root";
    this.execute(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    this.execute(`USE ${dbName}`);
    const { stmts } = splitStatements(script);
    for (const s of stmts) this.execute(s.sql);
    this.user = prevUser; this.current = prevDb;
    this.lastId = 0; this.rowCount = 0;
    this.version++;
  }

  private dumpDatabase(dbName: string, tables?: string[], withDb = false): string {
    const e = this.dbs[dbName];
    const prev = this.current;
    this.current = dbName;
    const out = [`-- MariaDB dump 10.19  Distrib ${VERSION}, for debian-linux-gnu (x86_64)`, "--", `-- Host: localhost    Database: ${dbName}`, "-- ------------------------------------------------------", `-- Server version\t${VERSION}`, ""];
    if (withDb) out.push(`CREATE DATABASE /*!32312 IF NOT EXISTS*/ \`${dbName}\` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;`, `USE \`${dbName}\`;`, "");
    const sorted = (tables ?? this.tables(dbName)).filter((t) => e.tables[t]);
    for (const t of sorted) {
      out.push("--", `-- Table structure for table \`${t}\``, "--", "", `DROP TABLE IF EXISTS \`${t}\`;`, `${this.createText(t, e.tables[t])};`, "");
      const r = e.db.exec(`SELECT * FROM \`${t}\``)[0];
      if (r?.values.length) {
        const val = (v: unknown) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`);
        out.push("--", `-- Dumping data for table \`${t}\``, "--", "", `LOCK TABLES \`${t}\` WRITE;`);
        for (let i = 0; i < r.values.length; i += 50) out.push(`INSERT INTO \`${t}\` VALUES ${r.values.slice(i, i + 50).map((row) => `(${row.map(val).join(",")})`).join(",")};`);
        out.push("UNLOCK TABLES;", "");
      }
    }
    out.push(`-- Dump completed on 2025-10-20 10:00:00`);
    this.current = prev;
    return out.join("\n") + "\n";
  }

  // ----- shell -----

  private login(user: string, password: string | null, hasPw: boolean, sudo: boolean): boolean {
    const u = this.users.find((x) => x.name === user && (x.host === "localhost" || x.host === "%"));
    const ok = !!u && (sudo && user === "root" ? true : u.password === (password ?? ""));
    if (!ok) return false;
    this.user = user;
    this.ev(`login:${user}`);
    void hasPw;
    return true;
  }

  private shell(line: string, out: string[]) {
    // redirects
    let cmdText = line.trim();
    let outFile: { path: string; append: boolean } | null = null;
    let inFile: string | null = null;
    cmdText = cmdText.replace(/\s*(>>?)\s*(\S+)\s*$/, (_, op: string, f: string) => { outFile = { path: f, append: op === ">>" }; return ""; });
    cmdText = cmdText.replace(/\s*<\s*(\S+)\s*$/, (_, f: string) => { inFile = f; return ""; });
    const toks: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    for (let m; (m = re.exec(cmdText));) toks.push(m[1] ?? m[2] ?? m[3]);
    let sudo = false;
    if (toks[0] === "sudo") { sudo = true; toks.shift(); }
    const [cmd, ...args] = toks;
    if (!cmd) return;
    const lines: string[] = [];
    const emit = (l: string[]) => lines.push(...l);

    const opt = (short: string, long?: string): string | null => {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === `-${short}`) return args[i + 1] ?? "";
        if (a.startsWith(`-${short}`) && a.length > 2 && short !== "p") return a.slice(2);
        if (long && a.startsWith(`--${long}=`)) return a.slice(long.length + 3);
      }
      return null;
    };
    const passwordArg = (): { pw: string | null; asked: boolean } => {
      for (const a of args) { if (a === "-p") return { pw: null, asked: true }; if (a.startsWith("-p") && a.length > 2) return { pw: a.slice(2), asked: false }; if (a.startsWith("--password=")) return { pw: a.slice(11), asked: false }; }
      return { pw: null, asked: false };
    };

    if (cmd === "mysql" || cmd === "mariadb" || cmd === "mysqldump" || cmd === "mariadb-dump" || cmd === "mysqladmin" || cmd === "mariadb-admin") {
      const user = opt("u", "user") ?? (sudo ? "root" : "student");
      const { pw, asked } = passwordArg();
      if (!sudo && user === "student") { out.push(`ERROR 1045 (28000): Access denied for user 'student'@'localhost' (using password: ${pw !== null || asked ? "YES" : "NO"})`); return; }
      const effectivePw = asked && user === "root" ? "" : pw;
      if (!this.login(user, effectivePw, pw !== null || asked, sudo || (user === "root" && asked))) {
        out.push(`ERROR 1045 (28000): Access denied for user '${user}'@'localhost' (using password: ${pw !== null || asked ? "YES" : "NO"})`);
        if (asked && pw === null && user !== "root") out.push("(This practice shell cannot prompt for a password: type it right after -p, for example -pSecret123)");
        return;
      }
      const flagWithValue = new Set(["-u", "-e", "-h", "-P", "-D", "--user", "--execute", "--host", "--port", "--database"]);
      const positional: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (flagWithValue.has(a)) { i++; continue; }
        if (a.startsWith("-")) continue;
        positional.push(a);
      }
      if (cmd === "mysql" || cmd === "mariadb") {
        const db = opt("D", "database") ?? positional[0] ?? null;
        const exec = opt("e", "execute");
        this.current = null;
        if (db) { try { this.execute(`USE ${db}`); } catch (e) { emit([e instanceof SqlError ? `ERROR ${e.code} (${e.state}): ${e.message}` : String(e)]); this.user = "root"; out.push(...lines); return; } }
        if (exec !== null) { this.runScript(exec, lines, true); this.ev("mysql-e"); this.mode = "shell"; }
        else if (inFile !== null) {
          const text = this.files[inFile as string];
          if (text === undefined) { out.push(`bash: ${inFile}: No such file or directory`); return; }
          this.runScript(text, lines, true);
          this.ev("restore");
        } else { this.mode = "client"; lines.push(...BANNER.slice(0, 3), "", "Type 'help;' or '\\h' for help. Type '\\c' to clear the current input statement.", ""); }
        if (this.mode === "shell") this.user = "root";
      } else if (cmd === "mysqldump" || cmd === "mariadb-dump") {
        const dbName = positional[0];
        if (this.user !== "root" && !this.anyAccess(dbName ?? "")) { out.push(`mysqldump: Got error: 1044: "Access denied for user '${this.user}'@'localhost' to database '${dbName}'" when selecting the database`); return; }
        const all = args.includes("--databases") || args.includes("-B");
        if (args.includes("--all-databases") || args.includes("-A")) { for (const d of this.databases()) lines.push(...this.dumpDatabase(d, undefined, true).split("\n")); }
        else {
          if (!dbName) { out.push("Usage: mysqldump [OPTIONS] database [tables]"); return; }
          if (!this.dbs[dbName]) { out.push(`mysqldump: Got error: 1049: "Unknown database '${dbName}'" when selecting the database`); return; }
          const tables = all ? undefined : positional.slice(1);
          lines.push(...this.dumpDatabase(dbName, tables && tables.length ? tables : undefined, all).split("\n"));
        }
        this.ev("mysqldump");
        this.user = "root";
        if (lines[lines.length - 1] === "") lines.pop();
      } else {
        const sub = positional[0];
        if (this.user !== "root") { out.push(`mysqladmin: connect to server at 'localhost' failed\nerror: 'Access denied for user '${this.user}'@'localhost' (using password: YES)'`); return; }
        if (sub === "status") { lines.push("Uptime: 3731  Threads: 1  Questions: 12  Slow queries: 0  Opens: 17  Open tables: 10  Queries per second avg: 0.003"); this.ev("mysqladmin-status"); }
        else if (sub === "version") { lines.push(`mysqladmin  Ver 9.1 Distrib ${VERSION}, for debian-linux-gnu on x86_64`, "Server version\t\t" + VERSION, "Protocol version\t10", "Connection\t\tLocalhost via UNIX socket", "Uptime:\t\t\t1 hour 2 min 11 sec"); this.ev("mysqladmin-version"); }
        else if (sub === "ping") lines.push("mysqld is alive");
        else if (sub === "processlist") lines.push(...formatTable(["Id", "User", "Host", "db", "Command", "Time", "State", "Info"], [[8, "root", "localhost", null, "Query", 0, "starting", "show processlist"]]));
        else if (sub === "create" && positional[1]) { try { this.execute(`CREATE DATABASE ${positional[1]}`); this.ev(`mysqladmin-create:${positional[1]}`); } catch (e) { lines.push(`mysqladmin: CREATE DATABASE failed; error: '${(e as Error).message}'`); } }
        else if (sub === "drop" && positional[1]) { try { this.execute(`DROP DATABASE ${positional[1]}`); lines.push(`Dropping the database is potentially a very bad thing to do.\nAny data stored in the database will be destroyed.\n\nDo you really want to drop the '${positional[1]}' database [y/N] y\nDatabase "${positional[1]}" dropped`); } catch (e) { lines.push(`mysqladmin: DROP DATABASE ${positional[1]} failed;\nerror: '${(e as Error).message}'`); } }
        else lines.push("Usage: mysqladmin [OPTIONS] command (status, version, ping, processlist, create <db>, drop <db>)");
        this.user = "root";
      }
    } else if (cmd === "ls") emit(Object.keys(this.files).sort().length ? [Object.keys(this.files).sort().join("  ")] : []);
    else if (cmd === "cat") { for (const f of args) { if (f in this.files) emit(this.files[f].replace(/\n$/, "").split("\n")); else emit([`cat: ${f}: No such file or directory`]); } }
    else if (cmd === "rm") { for (const f of args.filter((a) => !a.startsWith("-"))) { if (f in this.files) delete this.files[f]; else emit([`rm: cannot remove '${f}': No such file or directory`]); } }
    else if (cmd === "wc") { const f = args.find((a) => !a.startsWith("-")); if (f && f in this.files) emit([`${this.files[f].replace(/\n$/, "").split("\n").length} ${f}`]); else emit([`wc: ${f}: No such file or directory`]); }
    else if (cmd === "head") { const ni = args.indexOf("-n"); const n = ni >= 0 ? Number(args[ni + 1]) || 10 : 10; const f = args.find((a, i) => !a.startsWith("-") && !(ni >= 0 && i === ni + 1)); if (f && f in this.files) emit(this.files[f].replace(/\n$/, "").split("\n").slice(0, n)); else emit([`head: cannot open '${f}' for reading: No such file or directory`]); }
    else if (cmd === "echo") emit([args.join(" ")]);
    else if (cmd === "clear") { out.push("\u0000CLEAR"); return; }
    else if (cmd === "help") emit(["Shell commands here: mysql / mariadb [-u user] [-pPASSWORD] [db] [-e 'SQL'], mysqldump [-u user] db [tables] > file.sql, mysqladmin [-u user] status|version|ping|create db|drop db, ls, cat, rm, wc -l, head, echo, clear", "Restore a dump with: mysql -u root newdb < file.sql", "Prefix with sudo to log in as root without a password: sudo mysql"]);
    else if (cmd === "exit" || cmd === "logout") emit(["(use the Reset button to start over)"]);
    else emit([`${cmd}: command not found`]);

    if (outFile) {
      const target = outFile as { path: string; append: boolean };
      const body = lines.join("\n") + (lines.length ? "\n" : "");
      this.files[target.path] = target.append ? (this.files[target.path] ?? "") + body : body;
      this.ev(`wrote:${target.path}`);
    } else out.push(...lines);
  }

  // The result sets of SELECTs run in the client, for the exercise checks.
  selectedRows(db: string): SelectResult[] { return this.selects.filter((s) => s.db === db); }
  hasEvent(e: string) { return this.events.includes(e); }
}
