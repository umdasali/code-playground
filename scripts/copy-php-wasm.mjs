// Copies the PHP 8.3 WebAssembly build (loader + wasm, asyncify flavour that works in every browser) into public/
// so the Laravel tab can load it as plain files.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/@php-wasm/web-8-3/asyncify");
const dest = path.resolve("public/php-wasm");
if (!existsSync(src)) {
  console.warn("[php-wasm] @php-wasm/web-8-3 is not installed; skipping copy");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(path.join(src, "php_8_3.js"), path.join(dest, "php_8_3.js"));
const version = readdirSync(src).find((d) => /^\d+_\d+_\d+$/.test(d));
mkdirSync(path.join(dest, version), { recursive: true });
cpSync(path.join(src, version, "php_8_3.wasm"), path.join(dest, version, "php_8_3.wasm"));
console.log(`[php-wasm] copied PHP ${version.replaceAll("_", ".")} to public/php-wasm`);
