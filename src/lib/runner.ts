import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// "docker": every run happens in a throwaway, network-less container (use this anywhere untrusted users can reach the app).
// "local":  runs directly on this machine as your user. Development convenience only.
export const MODE = process.env.RUNNER_MODE ?? "docker";
const TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 10_000);
const MAX_OUTPUT = 64 * 1024;
const IMAGE_GCC = process.env.SANDBOX_IMAGE_GCC ?? "gcc:14";
export const IMAGE_LINUX = process.env.SANDBOX_IMAGE_LINUX ?? "ubuntu:24.04";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface Job {
  image: string;
  files: Record<string, string>;
  script: string;
  stdin?: string;
  env?: Record<string, string>;
}

function execute(job: Job): Promise<RunResult> {
  return mkdtemp(path.join(tmpdir(), "pg-")).then(async (dir) => {
    try {
      await chmod(dir, 0o777);
      for (const [name, content] of Object.entries(job.files)) {
        await writeFile(path.join(dir, name), content);
      }
      return await spawnJob(dir, job);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

export function spawnJob(dir: string, job: Job): Promise<RunResult> {
  const name = `pg-${randomBytes(6).toString("hex")}`;
  const [cmd, args] =
    MODE === "local"
      ? ["sh", ["-c", `ulimit -t ${Math.ceil(TIMEOUT_MS / 1000)}; ${job.script}`]]
      : [
          "docker",
          [
            "run", "--rm", "-i", "--name", name,
            "--network", "none",
            "--memory", "256m", "--memory-swap", "256m",
            "--cpus", "1", "--pids-limit", "128",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--user", "65534:65534",
            "-e", "HOME=/work",
            ...Object.entries(job.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
            "-v", `${dir}:/work`, "-w", "/work",
            job.image, "bash", "-c", job.script,
          ],
        ];

  return new Promise((resolve) => {
    const started = Date.now();
    const env = (MODE === "local" ? { PATH: process.env.PATH, HOME: dir, ...job.env } : process.env) as NodeJS.ProcessEnv;
    const child: ChildProcessWithoutNullStreams = spawn(cmd, args as string[], { cwd: dir, detached: true, env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (cur: string, chunk: Buffer) =>
      cur.length >= MAX_OUTPUT ? cur : (cur + chunk.toString()).slice(0, MAX_OUTPUT);
    child.stdout.on("data", (c) => (stdout = append(stdout, c)));
    child.stderr.on("data", (c) => (stderr = append(stderr, c)));

    const killAll = () => {
      if (MODE === "docker") spawn("docker", ["kill", name], { stdio: "ignore" });
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killAll();
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      const hint = MODE === "docker" ? " (is Docker installed and running? Set RUNNER_MODE=local for dev.)" : "";
      resolve({ stdout, stderr: `${err.message}${hint}`, exitCode: null, timedOut, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut, durationMs: Date.now() - started });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(job.stdin ?? "");
  });
}

export function runC(code: string, stdin: string, cpp: boolean) {
  const [file, compiler, std] = cpp ? ["main.cpp", "g++", "-std=c++20"] : ["main.c", "gcc", "-std=c17"];
  return execute({
    image: IMAGE_GCC,
    files: { [file]: code },
    script: `${compiler} ${std} -Wall -Wextra -O1 -o main ${file} -lm && ./main`,
    stdin,
  });
}

export function runBash(code: string, stdin: string) {
  return execute({ image: IMAGE_LINUX, files: { "user.sh": code }, script: `mkdir -p home && cd home && bash ../user.sh`, stdin });
}
