import { chmod, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Starting files for every new practice session.
const FILES = {
  "notes.txt": Array.from({ length: 12 }, (_, i) => `line ${i + 1}: ${["hello world", "linux is fun", "practice makes perfect", "grep me", "the quick brown fox"][i % 5]}`).join("\n") + "\n",
  "fruits.txt": "apple\nbanana\ncherry\nbanana\napple\napple\ndate\nelderberry\ncherry\n",
  "a.txt": "red\ngreen\nblue\nyellow\n",
  "b.txt": "red\ngreen\nviolet\nyellow\norange\n",
  "people.csv": "id,name,city,age\n1,Asha,Pune,31\n2,Ben,Austin,27\n3,Chen,Shanghai,45\n4,Dana,Berlin,38\n5,Eli,Austin,22\n",
  "server.log": ["INFO service started", "INFO user login alice", "WARN disk at 85%", "ERROR db timeout", "INFO user login bob", "ERROR db timeout", "INFO request /home 200", "WARN slow query 2.1s", "ERROR payment failed"].map((l, i) => `2025-01-0${(i % 9) + 1} 10:0${i} ${l}`).join("\n") + "\n",
  "docs/readme.md": "# Docs\nWelcome to the playground.\nTODO: read the manual.\n",
  "docs/todo.txt": "buy milk\nwrite code\nTODO: learn find\n",
  "projects/app/main.c": '#include <stdio.h>\nint main(void) { puts("hi"); return 0; }\n',
  "projects/app/Makefile": "all:\n\tgcc -o app main.c\n",
  "projects/lib/util.c": "int add(int a, int b) { return a + b; }\n",
  "scripts/hello.sh": '#!/bin/bash\necho "hello from script"\n',
};

const RC = `export PS1='\\[\\e[32m\\]learner@playground\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ '
export HISTFILE="$HOME/.pg_history" HISTCONTROL=ignoredups
shopt -s histappend
if ls --color=auto >/dev/null 2>&1; then alias ls='ls --color=auto'; else alias ls='ls -G'; fi
alias grep='grep --color=auto'
alias ll='ls -alF'
# No locate database in a throwaway sandbox, so emulate it.
locate() { find "$HOME" -iname "*$1*" 2>/dev/null; }
for c in fork getpid getppid pipe; do
  eval "$c() { echo '$c is a C system call, not a shell command. Open its C example from the sidebar.'; }"
done
`;

export async function seedSession(dir) {
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(FILES)) {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await mkdir(path.join(dir, "empty"), { recursive: true });
  await writeFile(path.join(dir, ".pgrc"), RC);
  await makeWritable(dir);
}

// The sandbox user differs from the host user, so everything must be world-writable.
export async function makeWritable(p) {
  const st = await stat(p);
  await chmod(p, st.isDirectory() ? 0o777 : 0o666);
  if (st.isDirectory()) for (const n of await readdir(p)) await makeWritable(path.join(p, n));
}
