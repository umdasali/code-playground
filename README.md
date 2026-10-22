# Coding Playground

Next.js 16 playground for C, C++, Bash, a real Linux terminal, MySQL and HTML/CSS/JS.

## Run

```bash
npm install
npm run dev
```

No `.env` files: settings live in `src/lib/config.ts` (timeouts, images, MySQL address) and `server/terminal-server.mjs` (terminal port), and the execution mode is detected automatically.

- **Docker available** (any environment): every run, and the Terminal shell, happens in a throwaway container (no network, 256 MB, 1 CPU, 128 pids, non-root). Images are pulled on first use.
- **No Docker, development** (`npm run dev`): code runs directly on your machine as you. Convenient, not safe for anyone else; the terminal is reachable from localhost only.
- **No Docker, production** (`npm run build && npm start`): running code is refused with a clear message. Install Docker on the server.
- Terminal tab: `npm run dev` starts the app and a PTY server (`server/terminal-server.mjs`, port 3001). For man pages, `ps`, `top` and `vim` in the sandbox, build the richer image once: `docker build -t playground-linux -f docker/linux.Dockerfile .` and set `IMAGE` in the terminal server and `imageLinux` in `config.ts` to `playground-linux`. In production run `node server/terminal-server.mjs` next to `next start`, expose port 3001 (behind TLS if the site uses HTTPS).
- MySQL (optional, the browser SQLite engine needs nothing): `docker compose up -d`. Each browser session gets its own database and a MySQL user restricted to it.

## Layout

- `src/lib/runner.ts`: sandbox execution; `src/lib/sql.ts`: MySQL sessions
- `src/app/api/run`, `src/app/api/sql`: route handlers
- `src/components/Playground.tsx`: UI (Monaco editor, tabs, output)
