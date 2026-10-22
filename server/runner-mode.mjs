// Decides how user code is executed, with no configuration needed:
//   "docker": Docker is available, so every run happens in a throwaway container (always preferred).
//   "local":  no Docker and this is a development run, so code runs directly on this machine. Never used in production.
//   "none":   no Docker in production, so execution is refused rather than run unsandboxed.
import { spawnSync } from "node:child_process";

let cached = null;
let checkedAt = 0;

export function runnerMode() {
  if (cached === "docker") return cached;
  if (cached && Date.now() - checkedAt < 30_000) return cached;
  checkedAt = Date.now();
  const docker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 8000 }).status === 0;
  cached = docker ? "docker" : process.env.NODE_ENV === "production" ? "none" : "local";
  return cached;
}

export const NO_DOCKER_MESSAGE =
  "Running code needs Docker on the server, and none was found. Install and start Docker (or run the app in development) and try again.";
