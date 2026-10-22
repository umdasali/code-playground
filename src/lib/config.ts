import "server-only";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// All settings live here; the app needs no .env files. Edit the values to change them.
export const config = {
  runTimeoutMs: 10_000,
  imageGcc: "gcc:14",
  // ubuntu:24.04 works; build docker/linux.Dockerfile and use "playground-linux" for man pages, ps, top, vim.
  imageLinux: "ubuntu:24.04",
  mysql: { host: "127.0.0.1", port: 3306, adminUser: "root", adminPassword: "playground" }, // matches docker-compose.yml
};

// Signs the per-session MySQL passwords. Generated once and kept on disk so it survives restarts.
export function sessionSecret(): string {
  const file = path.join(tmpdir(), "pg-session-secret");
  try {
    if (existsSync(file)) return readFileSync(file, "utf8");
    mkdirSync(path.dirname(file), { recursive: true });
    const secret = randomBytes(32).toString("hex");
    writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  } catch {
    return randomBytes(32).toString("hex");
  }
}
