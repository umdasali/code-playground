export interface CommandRef {
  name: string;
  group: string;
  summary: string;
  examples: { cmd: string; note: string }[];
  // System calls are C functions, not shell commands; these ship a C program to try in the C tab.
  c?: string;
}

const HDR = "#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\n";

export const COMMANDS: CommandRef[] = [
  // Files & directories
  { name: "pwd", group: "Files & directories", summary: "Print the current directory", examples: [{ cmd: "pwd", note: "where am I?" }] },
  { name: "ls", group: "Files & directories", summary: "List directory contents", examples: [{ cmd: "ls", note: "names only" }, { cmd: "ls -la", note: "long format, hidden files" }, { cmd: "ls -lh docs", note: "human-readable sizes" }, { cmd: "ls -lt", note: "newest first" }] },
  { name: "cd", group: "Files & directories", summary: "Change directory", examples: [{ cmd: "cd docs", note: "into docs" }, { cmd: "cd ..", note: "up one level" }, { cmd: "cd", note: "back home" }, { cmd: "cd projects/app && pwd", note: "chain commands" }] },
  { name: "mkdir", group: "Files & directories", summary: "Create directories", examples: [{ cmd: "mkdir work", note: "one directory" }, { cmd: "mkdir -p a/b/c && ls -R a", note: "nested, with -p" }] },
  { name: "rmdir", group: "Files & directories", summary: "Remove EMPTY directories", examples: [{ cmd: "rmdir empty && ls", note: "works: it is empty" }, { cmd: "rmdir docs", note: "fails: not empty" }] },
  { name: "touch", group: "Files & directories", summary: "Create a file or update its timestamp", examples: [{ cmd: "touch new.txt && ls -l new.txt", note: "empty file" }, { cmd: "touch notes.txt && ls -l notes.txt", note: "bump mtime" }] },
  { name: "cp", group: "Files & directories", summary: "Copy files and directories", examples: [{ cmd: "cp notes.txt copy.txt && ls", note: "copy a file" }, { cmd: "cp -r docs docs_backup && ls", note: "copy a directory (-r)" }] },
  { name: "mv", group: "Files & directories", summary: "Move or rename", examples: [{ cmd: "mv a.txt alpha.txt && ls", note: "rename" }, { cmd: "mv fruits.txt docs/ && ls docs", note: "move into a directory" }] },
  { name: "rm", group: "Files & directories", summary: "Delete files (no trash!)", examples: [{ cmd: "rm b.txt && ls", note: "delete a file" }, { cmd: "rm -r empty projects/lib && ls", note: "delete directories (-r)" }] },

  // Viewing
  { name: "cat", group: "Viewing files", summary: "Print files", examples: [{ cmd: "cat a.txt", note: "show a file" }, { cmd: "cat -n a.txt", note: "with line numbers" }, { cmd: "cat a.txt b.txt", note: "concatenate" }] },
  { name: "head", group: "Viewing files", summary: "First lines of a file", examples: [{ cmd: "head notes.txt", note: "first 10" }, { cmd: "head -n 3 notes.txt", note: "first 3" }] },
  { name: "tail", group: "Viewing files", summary: "Last lines of a file", examples: [{ cmd: "tail -n 3 server.log", note: "last 3" }, { cmd: "tail -n +10 notes.txt", note: "from line 10 on" }] },
  { name: "more", group: "Viewing files", summary: "Page through a file (space = next page, q = quit)", examples: [{ cmd: "more server.log", note: "interactive pager" }] },
  { name: "less", group: "Viewing files", summary: "Scrollable pager (arrows, / to search, q to quit)", examples: [{ cmd: "less server.log", note: "try /ERROR then n" }] },
  { name: "echo", group: "Viewing files", summary: "Print text; combine with > to write files", examples: [{ cmd: 'echo "hello world"', note: "print" }, { cmd: 'echo "first" > t.txt && echo "second" >> t.txt && cat t.txt', note: "> overwrites, >> appends" }, { cmd: "echo $HOME $PWD", note: "variables" }] },
  { name: "wc", group: "Viewing files", summary: "Count lines, words, bytes", examples: [{ cmd: "wc notes.txt", note: "lines words bytes" }, { cmd: "wc -l server.log", note: "lines only" }, { cmd: "ls | wc -l", note: "count entries" }] },

  // Search
  { name: "grep", group: "Searching", summary: "Search text with patterns", examples: [{ cmd: "grep ERROR server.log", note: "matching lines" }, { cmd: "grep -c ERROR server.log", note: "count matches" }, { cmd: "grep -in 'todo' docs/*", note: "case-insensitive + line numbers" }, { cmd: "grep -rn TODO .", note: "recursive search" }, { cmd: "grep -v INFO server.log", note: "invert match" }] },
  { name: "find", group: "Searching", summary: "Find files by name, type, size, time", examples: [{ cmd: "find . -name '*.c'", note: "by name" }, { cmd: "find . -type d", note: "directories only" }, { cmd: "find . -size -1k -type f", note: "small files" }, { cmd: "find . -name '*.txt' -exec wc -l {} \;", note: "run a command on each" }] },
  { name: "locate", group: "Searching", summary: "Find files by name (database lookup)", examples: [{ cmd: "locate readme", note: "emulated here with find, as there is no locate database" }] },
  { name: "which", group: "Searching", summary: "Show which executable a command runs", examples: [{ cmd: "which ls grep bash", note: "paths of commands" }] },
  { name: "whereis", group: "Searching", summary: "Locate binary, source, and man page", examples: [{ cmd: "whereis ls", note: "binary, source and man page paths" }] },

  // Text processing
  { name: "sort", group: "Text processing", summary: "Sort lines", examples: [{ cmd: "sort fruits.txt", note: "alphabetical" }, { cmd: "sort -r fruits.txt", note: "reverse" }, { cmd: "sort -t, -k4 -n people.csv", note: "numeric on CSV column 4" }] },
  { name: "uniq", group: "Text processing", summary: "Collapse ADJACENT duplicate lines (sort first!)", examples: [{ cmd: "sort fruits.txt | uniq", note: "unique values" }, { cmd: "sort fruits.txt | uniq -c | sort -rn", note: "frequency table" }] },
  { name: "cut", group: "Text processing", summary: "Extract columns", examples: [{ cmd: "cut -d, -f2,3 people.csv", note: "CSV fields 2 and 3" }, { cmd: "cut -c1-10 notes.txt", note: "first 10 characters" }] },
  { name: "diff", group: "Text processing", summary: "Compare files line by line", examples: [{ cmd: "diff a.txt b.txt", note: "normal format" }, { cmd: "diff -u a.txt b.txt", note: "unified format" }] },

  // Help & shell
  { name: "man", group: "Help & shell", summary: "Read a manual page (q to quit)", examples: [{ cmd: "man ls", note: "manual for ls" }, { cmd: "man -k copy", note: "search manual summaries" }] },
  { name: "clear", group: "Help & shell", summary: "Clear the terminal (also Ctrl+L)", examples: [{ cmd: "clear", note: "wipe the screen" }] },
  { name: "history", group: "Help & shell", summary: "Show commands you typed (↑/↓, Ctrl+R to search)", examples: [{ cmd: "history", note: "numbered list" }, { cmd: "history | tail -5", note: "last five" }] },
  {
    name: "exit", group: "Help & shell", summary: "End the shell / a process with a status code",
    examples: [{ cmd: "false; echo $?", note: "$? holds the last exit code" }, { cmd: "(exit 3); echo $?", note: "exit a subshell with status 3" }, { cmd: "exit", note: "closes this session (use Reconnect)" }],
    c: `#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    printf("about to exit with status 7\\n");\n    exit(7);   // flushes stdio buffers, then ends the process\n}\n// Run it, then in a shell you would see: echo $?  ->  7\n`,
  },

  // Permissions
  { name: "chmod", group: "Permissions", summary: "Change file mode (permissions)", examples: [{ cmd: "ls -l scripts/hello.sh && chmod +x scripts/hello.sh && ls -l scripts/hello.sh && scripts/hello.sh", note: "make executable and run" }, { cmd: "chmod 600 notes.txt && ls -l notes.txt", note: "owner read/write only" }, { cmd: "chmod u=rwx,g=rx,o= a.txt && ls -l a.txt", note: "symbolic mode" }] },
  { name: "chown", group: "Permissions", summary: "Change owner (needs root for other users)", examples: [{ cmd: "chown $(id -un) notes.txt && ls -l notes.txt", note: "to yourself: allowed" }, { cmd: "chown root notes.txt", note: "fails: not permitted" }] },
  { name: "chgrp", group: "Permissions", summary: "Change group", examples: [{ cmd: "chgrp $(id -gn) notes.txt && ls -l notes.txt", note: "to your own group" }, { cmd: "id", note: "your user and groups" }] },
  { name: "umask", group: "Permissions", summary: "Default permission mask for new files", examples: [{ cmd: "umask", note: "show mask" }, { cmd: "umask 077 && touch private.txt && mkdir pdir && ls -ld private.txt pdir", note: "new files private" }, { cmd: "umask 022 && touch shared.txt && ls -l shared.txt", note: "typical default" }] },

  // Processes
  { name: "ps", group: "Processes", summary: "Snapshot of processes", examples: [{ cmd: "ps", note: "this shell's processes" }, { cmd: "ps aux | head", note: "all processes" }, { cmd: "ps -o pid,ppid,cmd", note: "pick columns" }] },
  { name: "top", group: "Processes", summary: "Live process view (q to quit)", examples: [{ cmd: "top", note: "interactive; press q to leave" }, { cmd: "top -b -n 1 | head -15", note: "one snapshot (Linux)" }] },
  { name: "kill", group: "Processes", summary: "Send a signal to a process", examples: [{ cmd: "sleep 100 & sleep 0.2; ps; kill %1; sleep 0.2; ps", note: "start in background, kill job %1, see it gone" }, { cmd: "kill -l", note: "list signals" }] },

  // Process system calls (C)
  {
    name: "fork", group: "Process system calls (C)", summary: "Create a child process", examples: [{ cmd: "(echo \"subshell pid: $BASHPID\") ; echo \"shell pid: $$\"", note: "a ( ) subshell is a forked child" }],
    c: `${HDR}int main(void) {\n    pid_t pid = fork();\n    if (pid < 0) { perror("fork"); return 1; }\n    if (pid == 0) {\n        printf("child:  pid=%d parent=%d\\n", getpid(), getppid());\n    } else {\n        printf("parent: pid=%d child=%d\\n", getpid(), pid);\n        wait(NULL);\n    }\n    return 0;\n}\n`,
  },
  {
    name: "exec", group: "Process system calls (C)", summary: "Replace the process image with a new program", examples: [{ cmd: "bash -c 'echo before; exec echo replaced; echo never printed'", note: "the shell builtin: nothing runs after exec" }],
    c: `${HDR}int main(void) {\n    printf("before exec, pid=%d\\n", getpid());\n    execlp("ls", "ls", "-l", "/", (char *)NULL);\n    perror("execlp");   // only reached if exec failed\n    return 1;\n}\n`,
  },
  {
    name: "wait", group: "Process system calls (C)", summary: "Wait for a child and read its exit status", examples: [{ cmd: "sleep 2 & wait; echo \"child finished: $?\"", note: "the shell builtin: blocks until background jobs end" }],
    c: `${HDR}int main(void) {\n    pid_t pid = fork();\n    if (pid == 0) { sleep(1); exit(42); }\n    int status;\n    pid_t done = wait(&status);\n    if (WIFEXITED(status))\n        printf("child %d exited with %d\\n", done, WEXITSTATUS(status));\n    return 0;\n}\n`,
  },
  {
    name: "getpid", group: "Process system calls (C)", summary: "Current process ID", examples: [{ cmd: "echo $$", note: "the shell's own PID" }],
    c: `${HDR}int main(void) {\n    printf("my pid = %d\\n", getpid());\n    return 0;\n}\n`,
  },
  {
    name: "getppid", group: "Process system calls (C)", summary: "Parent process ID", examples: [{ cmd: "echo $PPID", note: "the shell's parent PID" }],
    c: `${HDR}int main(void) {\n    printf("pid=%d  ppid=%d\\n", getpid(), getppid());\n    return 0;\n}\n`,
  },
  {
    name: "pipe", group: "Process system calls (C)", summary: "Create a one-way channel between processes (like | in the shell)", examples: [{ cmd: "cat notes.txt | grep fox | wc -l", note: "the shell's version" }],
    c: `${HDR}#include <string.h>\n\nint main(void) {\n    int fd[2];\n    if (pipe(fd) < 0) { perror("pipe"); return 1; }\n    if (fork() == 0) {            // child writes\n        close(fd[0]);\n        const char *msg = "hello through the pipe";\n        write(fd[1], msg, strlen(msg) + 1);\n        _exit(0);\n    }\n    close(fd[1]);                 // parent reads\n    char buf[64];\n    read(fd[0], buf, sizeof buf);\n    printf("parent got: %s\\n", buf);\n    wait(NULL);\n    return 0;\n}\n`,
  },

  // Archive & disk
  { name: "tar", group: "Archive & disk", summary: "Bundle and compress files", examples: [{ cmd: "tar -czf docs.tar.gz docs && ls -l docs.tar.gz", note: "create gzip archive" }, { cmd: "tar -tzf docs.tar.gz", note: "list contents" }, { cmd: "mkdir out && tar -xzf docs.tar.gz -C out && ls -R out", note: "extract into out/" }] },
  { name: "df", group: "Archive & disk", summary: "Free space on filesystems", examples: [{ cmd: "df -h", note: "human-readable" }, { cmd: "df -h .", note: "just this directory's filesystem" }] },
  { name: "du", group: "Archive & disk", summary: "Space used by files", examples: [{ cmd: "du -sh .", note: "total size" }, { cmd: "du -h docs projects", note: "per-directory sizes" }, { cmd: "du -a | sort -rn | head -5", note: "biggest entries" }] },
];

export const GROUPS = [...new Set(COMMANDS.map((c) => c.group))];
