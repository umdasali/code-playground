# Coding Playground

A Next.js 16 playground that runs **entirely in the visitor's browser**: no server-side code execution, no Docker, no environment variables. It deploys to Vercel as-is.

| Tab | What runs | How |
| --- | --- | --- |
| **C** | Real clang, compiled to WebAssembly | [Wasmer JS SDK](https://www.npmjs.com/package/@wasmer/sdk) (`clang/clang`) |
| **C++** | The same clang; the language plus the C library, `<array>`, `<optional>`, `<utility>` | see limitations |
| **Bash** | Real bash 5 with coreutils, grep, find, sed, tar, gzip | Wasmer (`wasmer/bash` and friends) |
| **Terminal** | An interactive bash in xterm.js, with a clickable reference for 46 commands | same sandbox as Bash, so files are shared |
| **HTML/CSS/JS** | Live preview in a sandboxed iframe, with a console | plain browser |
| **SQL** | SQLite (sql.js) with a DDL / DML / table view / output layout, saved in IndexedDB | WebAssembly |

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
```

`npm install` (and `dev` / `build`) copies the Wasmer SDK from `node_modules` into `public/wasmer-sdk/` (git-ignored, see `scripts/copy-wasmer.mjs`).

## Deploy (Vercel)

Import the repo; the defaults work (`npm run build`). `next.config.ts` sends the two headers the Wasmer runtime needs (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`), which make the page cross-origin isolated so WebAssembly threads work. Any other host must send the same headers.

## Things to know

- **First use downloads the toolchain** (about 100 MB for the C/C++ compiler, less for the shell). The browser caches it, so later visits only wait a few seconds while it loads from the cache. A progress bar shows the download.
- **C++ limitations.** This clang build's libc++ hangs the compiler on most standard headers, so `<iostream>`, `<string>`, `<vector>`, `<map>`, `<algorithm>`, `<memory>`, `<tuple>` and exceptions are not available; the Run button explains this instead of hanging. Classes, templates, lambdas, `new`/`delete`, virtual functions, `constexpr`, `<cstdio>`, `<cstdlib>`, `<cstring>`, `<cmath>`, `<array>` and `<optional>` work.
- **No processes in WebAssembly.** C programs cannot `fork`, `exec` or `pipe`; `getpid`, `getppid` and `exit` work. In the shell, `ps`, `top`, `kill`, `wait`, `df`, `du`, `chmod`, `chown`, `chgrp`, `stat`, `umask`, `id`, `diff`, `man`, `which`, `whereis` and `locate` are small bash stand-ins (`public/playground.rc.sh`) because the sandbox has no real process table, permissions or users.
- **Files are per tab.** Terminal and Bash files live in memory until you reload (use Reset files to restore the originals). SQL tables persist in IndexedDB.
- **Browsers:** current Chrome, Edge, Firefox and Safari.

## Layout

- `src/lib/wasm.ts` is the in-browser runtime: compiler sandbox, program runner, bash sandbox, interactive shell
- `public/playground.rc.sh` is the shell setup and the command stand-ins
- `src/components/` has the tabs (`Playground`, `Terminal`, `MySqlWorkspace`, `WebPlayground`) and the shared UI kit (`ui.tsx`)
- `src/lib/examples.ts`, `commands.ts` and `sample-data.ts` hold the C/C++ examples, the command reference and the SQL practice data
