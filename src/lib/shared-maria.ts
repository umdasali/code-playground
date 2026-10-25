// One MariaDB-style server shared by the MariaDB tab (free practice) and the Laravel tab, so tables that a Laravel
// migration creates show up in SHOW TABLES, and rows added with INSERT are visible to Eloquent.
import { loadSqlJs } from "./browser-sql";
import { Maria } from "./mariadb";
import { buildSampleSql } from "./sample-data";

export const DEFAULT_APP_DATABASE = "laravel";

let shared: Promise<Maria> | null = null;

export function getSharedMaria(): Promise<Maria> {
  shared ??= loadSqlJs().then((SQL) => {
    const m = new Maria(SQL);
    m.ensureDatabase(DEFAULT_APP_DATABASE);
    return m;
  });
  return shared;
}

export async function resetSharedMaria(): Promise<Maria> {
  const m = await getSharedMaria();
  m.reset();
  m.ensureDatabase(DEFAULT_APP_DATABASE);
  return m;
}

// Make sure the database a Laravel project points at exists (the shop sample is loaded on demand).
export async function ensureSharedDatabase(name: string): Promise<Maria> {
  const m = await getSharedMaria();
  if (!m.hasDatabase(name)) {
    if (name === "shop") m.load("shop", buildSampleSql("mysql"));
    else m.ensureDatabase(name);
  }
  return m;
}
