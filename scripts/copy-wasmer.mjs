// Copies the Wasmer SDK (loader scripts + wasm runtime) into public/ so the browser can load it as plain files.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/@wasmer/sdk");
const dest = path.resolve("public/wasmer-sdk");
if (!existsSync(src)) {
  console.warn("[wasmer] @wasmer/sdk is not installed; skipping copy");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["dist", "pkg"]) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true, filter: (p) => !p.endsWith(".map") && !p.endsWith(".d.ts") });
}
console.log("[wasmer] copied SDK to public/wasmer-sdk");
