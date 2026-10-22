// Starts the Next.js dev server and the terminal PTY server together.
import { spawn } from "node:child_process";

const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
const procs = [
  run("node", ["--env-file-if-exists=.env.local", "server/terminal-server.mjs"]),
  run("npx", ["next", "dev", ...process.argv.slice(2)]),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
procs.forEach((p) => p.on("exit", stop));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
