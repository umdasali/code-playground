# Coding Playground

Next.js 16 playground for C, C++, Bash, a real Linux terminal, MySQL and HTML/CSS/JS.

## Run

```bash
npm install
cp .env.example .env.local   # then pick a runner mode
npm run dev
```

- `RUNNER_MODE=local`: C/C++/Bash run directly on your machine. Dev only, never expose it.
- `RUNNER_MODE=docker` (default): each run is a throwaway container (no network, 256 MB, 1 CPU, 128 pids, non-root). Needs Docker; images are `SANDBOX_IMAGE_GCC` / `SANDBOX_IMAGE_LINUX`.
- Terminal tab: `npm run dev` starts the app **and** a PTY server (`server/terminal-server.mjs`, ws://127.0.0.1:3001) that streams a real shell to xterm.js. With `RUNNER_MODE=docker`, build the practice image once: `docker build -t playground-linux -f docker/linux.Dockerfile .` and set `SANDBOX_IMAGE_LINUX=playground-linux`. Behind a real domain, set `TERMINAL_ALLOWED_ORIGINS` and proxy the WebSocket over TLS.
- MySQL: `docker compose up -d`, then set `MYSQL_*` in `.env.local`. Each browser session gets its own database and a MySQL user restricted to it.

## Layout

- `src/lib/runner.ts`: sandbox execution; `src/lib/sql.ts`: MySQL sessions
- `src/app/api/run`, `src/app/api/sql`: route handlers
- `src/components/Playground.tsx`: UI (Monaco editor, tabs, output)
