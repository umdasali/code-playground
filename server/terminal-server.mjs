// Real terminal backend: one persistent PTY shell per browser session, streamed over a WebSocket.
//   Docker available: the shell runs in a network-less container with only the session folder mounted.
//   No Docker (development only): the shell runs on this machine as you, reachable from localhost only.
//   No Docker in production: refused. No configuration is needed; the mode is detected.
import { spawn as spawnProc } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { WebSocketServer } from "ws";
import { NO_DOCKER_MESSAGE, runnerMode } from "./runner-mode.mjs";
import { seedSession } from "./seed.mjs";

const PORT = 3001; // keep in sync with the client in src/components/Terminal.tsx
const MODE = runnerMode();
// Docker-backed shells are sandboxed, so they may be reached from other machines. An unsandboxed local shell never is.
const HOST = MODE === "docker" ? "0.0.0.0" : "127.0.0.1";
const IMAGE = "ubuntu:24.04"; // or "playground-linux" after: docker build -t playground-linux -f docker/linux.Dockerfile .
const ROOT = path.join(tmpdir(), "pg-term");
const IDLE_MS = 30 * 60_000;
const MAX_LIFE_MS = 4 * 60 * 60_000;
const DIR_TTL_MS = 2 * 60 * 60_000;
const MAX_SESSIONS = 20;
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

// Browsers always send Origin, so this stops other websites from driving a visitor's terminal.
// Allowed: localhost, or a page served from the same hostname as this server.
function originAllowed(origin, hostHeader) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return true;
    return !!hostHeader && host === new URL(`http://${hostHeader}`).hostname;
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

  if (!originAllowed(req.headers.origin, req.headers.host)) return ws.close(1008, "origin not allowed");
  if (MODE === "none") {
    send({ t: "o", d: `\r\n${NO_DOCKER_MESSAGE}\r\n` });
    return ws.close(1011, "no docker");
  }
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

wss.on("listening", () => {
  console.log(`[terminal] ws://${HOST}:${PORT} (${MODE} mode)`);
  if (MODE === "local") console.log("[terminal] Docker not found: shells run directly on this machine (development only).");
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const id of [...sessions.keys()]) killSession(id); process.exit(0); });
