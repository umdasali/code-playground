// Real terminal backend: one persistent PTY shell per browser session, streamed over a WebSocket.
//   RUNNER_MODE=docker (default): the shell runs in a network-less container with only the session folder mounted.
//   RUNNER_MODE=local: the shell runs directly on this machine as you. Development only.
import { spawn as spawnProc } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { WebSocketServer } from "ws";
import { seedSession } from "./seed.mjs";

const PORT = Number(process.env.TERMINAL_PORT ?? 3001);
const HOST = process.env.TERMINAL_HOST ?? "127.0.0.1";
const MODE = process.env.RUNNER_MODE ?? "docker";
const IMAGE = process.env.SANDBOX_IMAGE_LINUX ?? "ubuntu:24.04";
const ORIGINS = process.env.TERMINAL_ALLOWED_ORIGINS?.split(",").map((s) => s.trim());
const ROOT = path.join(tmpdir(), "pg-term");
const IDLE_MS = 30 * 60_000;
const MAX_LIFE_MS = 4 * 60 * 60_000;
const DIR_TTL_MS = 2 * 60 * 60_000;
const MAX_SESSIONS = Number(process.env.TERMINAL_MAX_SESSIONS ?? 20);
const SESSION_RE = /^[a-f0-9]{16,32}$/;

// npm skips install scripts, which leaves node-pty's prebuilt helper without its execute bit.
try {
  const prebuilds = path.join(path.dirname(fileURLToPath(import.meta.resolve("node-pty"))), "..", "prebuilds");
  for (const d of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
    const helper = path.join(prebuilds, d, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
} catch {}

const sessions = new Map(); // id -> { term, ws, timers }

const containerName = (id) => `pg-term-${id.slice(0, 16)}`;

function originAllowed(origin) {
  if (!origin) return false;
  if (ORIGINS) return ORIGINS.includes(origin);
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  clearTimeout(s.idle);
  clearTimeout(s.life);
  try { s.term.kill(); } catch {}
  if (MODE === "docker") spawnProc("docker", ["kill", containerName(id)], { stdio: "ignore" }).on("error", () => {});
}

async function sweepDirs() {
  try {
    for (const name of await readdir(ROOT)) {
      if (sessions.has(name)) continue;
      const p = path.join(ROOT, name);
      if (Date.now() - (await stat(p)).mtimeMs > DIR_TTL_MS) await rm(p, { recursive: true, force: true });
    }
  } catch {}
}

async function startShell(id, cols, rows) {
  const dir = path.join(ROOT, id);
  await mkdir(ROOT, { recursive: true });
  if (!existsSync(dir)) await seedSession(dir);

  const size = { cols, rows, name: "xterm-256color" };
  if (MODE === "local") {
    return pty.spawn("bash", ["--rcfile", path.join(dir, ".pgrc"), "-i"], {
      ...size, cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, TERM: "xterm-256color", LANG: process.env.LANG ?? "en_US.UTF-8", BASH_SILENCE_DEPRECATION_WARNING: "1" },
    });
  }
  const args = [
    "run", "-it", "--rm", "--name", containerName(id),
    "--network", "none", "--memory", "256m", "--memory-swap", "256m",
    "--cpus", "1", "--pids-limit", "128",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--user", "65534:65534",
    "-e", "HOME=/home/learner", "-e", "TERM=xterm-256color", "-e", "LANG=C.UTF-8",
    "-v", `${dir}:/home/learner`, "-w", "/home/learner",
    IMAGE, "bash", "--rcfile", "/home/learner/.pgrc", "-i",
  ];
  return pty.spawn("docker", args, { ...size, env: process.env });
}

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 64 * 1024 });

wss.on("connection", async (ws, req) => {
  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const url = new URL(req.url ?? "/", "http://x");
  const id = url.searchParams.get("session") ?? "";

  if (!originAllowed(req.headers.origin)) return ws.close(1008, "origin not allowed");
  if (!SESSION_RE.test(id)) return ws.close(1008, "bad session");
  if (!sessions.has(id) && sessions.size >= MAX_SESSIONS) {
    send({ t: "o", d: "\r\nServer is busy, try again in a few minutes.\r\n" });
    return ws.close(1013, "busy");
  }

  killSession(id); // one live shell per session: a reconnect replaces the old one
  void sweepDirs();

  let term;
  try {
    term = await startShell(id, 80, 24);
  } catch (err) {
    send({ t: "o", d: `\r\nCould not start shell: ${err.message}\r\n` });
    return ws.close(1011, "spawn failed");
  }
  const s = { term };
  sessions.set(id, s);
  const bump = () => {
    clearTimeout(s.idle);
    s.idle = setTimeout(() => { send({ t: "o", d: "\r\n[idle timeout: session closed]\r\n" }); ws.close(); }, IDLE_MS);
  };
  bump();
  s.life = setTimeout(() => ws.close(), MAX_LIFE_MS);

  term.onData((d) => send({ t: "o", d }));
  term.onExit(({ exitCode }) => {
    if (sessions.get(id) === s) sessions.delete(id);
    send({ t: "exit", code: exitCode });
    ws.close();
  });

  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "i" && typeof m.d === "string") { bump(); term.write(m.d.slice(0, 10_000)); }
    else if (m.t === "r") {
      const cols = Math.min(Math.max(Number(m.cols) | 0, 20), 400);
      const rows = Math.min(Math.max(Number(m.rows) | 0, 5), 200);
      try { term.resize(cols, rows); } catch {}
    } else if (m.t === "reset") {
      killSession(id);
      await rm(path.join(ROOT, id), { recursive: true, force: true });
      ws.close(1000, "reset");
    }
  });
  ws.on("close", () => { if (sessions.get(id) === s) killSession(id); });
});

wss.on("listening", () => console.log(`[terminal] ws://${HOST}:${PORT} (${MODE} mode)`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const id of [...sessions.keys()]) killSession(id); process.exit(0); });
