# Coding Playground

A Next.js 16 playground that runs **entirely in the visitor's browser**: no server-side code execution, no Docker, no environment variables. It deploys to Vercel as-is.

| Tab | What runs | How |
| --- | --- | --- |
| **C** | Real clang, compiled to WebAssembly | [Wasmer JS SDK](https://www.npmjs.com/package/@wasmer/sdk) (`clang/clang`) |
| **C++** | The same clang, with a lightweight standard library (`<iostream>`, `<string>`, `<vector>`, `<memory>`, `<algorithm>`, ...) | see C++ support |
| **Bash** | Real bash 5 with coreutils, grep, find, sed, tar, gzip | Wasmer (`wasmer/bash` and friends) |
| **Terminal** | An interactive bash in xterm.js, with a clickable reference for 46 commands | same sandbox as Bash, so files are shared |
| **HTML/CSS/JS** | Live preview in a sandboxed iframe, with a console | plain browser |
| **MariaDB** | A simulated MariaDB 11.4 server with the `mariadb` client, `mysqldump`, `mysqladmin` and 10 checked exercises | SQLite in WebAssembly plus a MariaDB translation layer |
| **Network** | Crimping lab, subnet calculator, a simulated LAN (3 PCs, a switch, a router) with Cisco-style CLI and `ping`, and a simulated Linux server with 12 timed-test style exercises | pure TypeScript simulation, nothing leaves the page |
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
- **C++ support.** This clang build's libc++ hangs or crashes the compiler on most standard headers, so the playground ships small replacements in `public/cxx/` (found first through `-I`, loaded by `src/lib/wasm.ts`). Everything below was checked against the real compiler.
  - **Works:** the whole language (classes, templates, lambdas, `new`/`delete`, virtual functions, `constexpr`); `<iostream>` (`cin`, `cout`, `cerr`, `endl`, `getline`), `<iomanip>` (`setw`, `setprecision`, `setfill`), `<string>`, `<vector>`, `<algorithm>` (`sort`, `find`, `reverse`, `count_if`, ...), `<numeric>`, `<memory>` (`unique_ptr`, `shared_ptr`, `weak_ptr`, `make_unique`, `make_shared`); libc++'s own `<array>`, `<optional>`, `<utility>`, `<type_traits>`, ...; the C library (`<cstdio>`, `<cstdlib>`, `<cstring>`, `<cmath>`, ...).
  - **Not available yet:** `<map>`, `<set>`, `<unordered_map>`, `<list>`, `<deque>`, `<queue>`, `<stack>`, `<sstream>`, `<fstream>`, `<functional>`, `<tuple>`, `<chrono>`, `<random>`, threads, and exceptions (`try`/`catch`/`throw`; the toolchain has no unwinder, so they are compiled out with `-fno-exceptions`). The replacements are deliberately small: `std::vector` and `std::string` have the common members, not all of them.
  - **Errors are explained.** Including an unsupported header stops before compiling and names the header, its line and what to use instead; `try`/`throw` and `typeid`/`dynamic_cast` get a note after the compiler's own message. The notice above the C++ editor lists what works.
  - To add a header, put it in `public/cxx/`, list it in `CXX_OWN_HEADERS` in `src/lib/wasm.ts`, and include `<iosfwd>` first: libc++ already declares `std::string`, `std::vector` and `std::ostream` there, so replacements must specialise or define those declarations rather than introduce new classes of the same name.
- **MariaDB tab.** An interactive `MariaDB [db]>` client (multi-line statements, `\G`, `USE`, `help`, `status`, `exit` to a shell) that answers like MariaDB: ASCII result tables with `N rows in set`, `Query OK, N rows affected`, `Empty set`, MariaDB error numbers (1064, 1146, 1054, 1062, 1048, 1452, 1142, 1044, ...), `SHOW DATABASES/TABLES/COLUMNS/INDEX/GRANTS/VARIABLES/CREATE TABLE`, `DESCRIBE` with `int(11)`/`PRI`/`auto_increment`, and `EXPLAIN` output (`type`, `key`, `Extra`). It runs on SQLite and translates the dialect: `AUTO_INCREMENT`, `ENGINE=`, `ENUM`, `UNSIGNED`, `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, `DELETE ... LIMIT`, `CONCAT`/`DATE_FORMAT`/`DATE_ADD ... INTERVAL`/`IF`/`LEFT`/`GROUP_CONCAT ... SEPARATOR` and about 70 other functions, `/` as decimal division, case-insensitive string comparison, `@variables`, `ALTER TABLE` (`ADD`, `DROP`, `MODIFY`, `CHANGE`, `RENAME`, indexes), transactions with `SAVEPOINT`, `information_schema` and `mysql.user`. Users and privileges are enforced (`CREATE USER`, `GRANT`, `REVOKE`, `SHOW GRANTS`, logging in with `mariadb -u user -ppassword db`). After `exit` there is a shell with `mysql -e`, `mysql db < file`, `mysqldump`, `mysqladmin`, `ls` and `cat`. Exercises: create a database and table, CRUD, `ALTER TABLE`, 10 query drills and 6 function drills on the shop sample data, indexes with `EXPLAIN`, transactions, foreign keys with `ON DELETE CASCADE`, users and privileges, and backup/restore. Checks read the real database state. Not simulated: stored procedures, triggers, views, writes across databases, `MODIFY` enforcing a new `NOT NULL` on existing rows, column order (`FIRST`/`AFTER`). Code: `src/lib/mariadb.ts` (server), `src/lib/mariadb-sql.ts` (translation and output), `src/lib/mariadblab.ts` (exercises), `src/components/MariaDbLab.tsx`.
- **Network tab.** Four labs, all simulated in the page (no real packets are sent), built around a practical trade test for network and systems staff:
  - *Crimping*: wire both RJ45 plugs for a straight-through or crossover cable (T568A/T568B) and read a cable tester that shows where each pin ends up.
  - *Subnetting*: address, mask, wildcard, network, broadcast, host range, binary view, "how big a subnet do I need" and an equal-split table.
  - *Network lab*: set PC addresses with `ip 192.168.10.10/24 192.168.10.1`, configure router and switch interfaces in a Cisco-style CLI (`enable`, `configure terminal`, `interface g0/0`, `ip address`, `no shutdown`, `description`, `speed`, `duplex`, `show ip interface brief`, `show ip route`, `show running-config`, `show interfaces status`) and test with `ping`. This covers connecting two workstations to a switch on one subnet. Goals tick off as the network works, and "Broken network" loads four faults to troubleshoot. The router only knows its connected networks (no routing protocols or VLANs).
  - *Linux server*: a simulated Ubuntu server with an in-memory filesystem, `sudo`, pipes and redirects, and a `nano`/`vi` stand-in editor. Each exercise starts from a fresh machine and lists checks that tick off as the real configuration state changes (files and running services, not just which commands you typed): static IP with netplan, the 4-subnet scenario with `/etc/network/interfaces`, `/etc/hosts` and `resolv.conf`, an `isc-dhcp-server` pool, Apache on 8080 with a custom document root, SSH on 2222 with root login off and key login (`ssh-keygen`, `ssh-copy-id`), `ufw` SSH-from-one-host, `iptables` ICMP block with web ports open, IP forwarding plus NAT masquerade, a wrong-gateway fault (`ip route`, `traceroute`), a port held by a rogue process (`ss -tulnp`, `netstat`, `lsof`, `kill`), and packet capture (`tcpdump -i any -c 10`, reading `capture.pcap`). Mistakes behave like the real thing: tabs in YAML, a misspelt `sshd_config` option, a DHCP subnet that does not match the interface, or `sudo echo x > /etc/file` all fail with realistic messages. Type `help` for the supported commands.
  - The logic lives in `src/lib/network.ts` (IPv4 maths, cable wiring), `src/lib/netlab.ts` (switch/router simulator), `src/lib/linuxsim.ts` (the Linux shell and services) and `src/lib/linuxlab.ts` (the exercises and their checks). Unlike a real exam machine it simulates a subset of each tool, so use it to learn the steps and the order, then repeat them on a real VM.
- **No processes in WebAssembly.** C programs cannot `fork`, `exec` or `pipe`; `getpid`, `getppid` and `exit` work. In the shell, `ps`, `top`, `kill`, `wait`, `df`, `du`, `chmod`, `chown`, `chgrp`, `stat`, `umask`, `id`, `diff`, `man`, `which`, `whereis` and `locate` are small bash stand-ins (`public/playground.rc.sh`) because the sandbox has no real process table, permissions or users.
- **Files are per tab.** Terminal and Bash files live in memory until you reload (use Reset files to restore the originals). SQL tables persist in IndexedDB.
- **Browsers:** current Chrome, Edge, Firefox and Safari.

## Layout

- `public/cxx/` holds the C++ standard-library replacements (`iostream`, `string`, `vector`, `memory`, `algorithm`, ...)
- `src/lib/wasm.ts` is the in-browser runtime: compiler sandbox, program runner, bash sandbox, interactive shell
- `public/playground.rc.sh` is the shell setup and the command stand-ins
- `src/components/` has the tabs (`Playground`, `Terminal`, `MySqlWorkspace`, `WebPlayground`, `MariaDbLab`, `NetworkLab` with `CableLab`, `SubnetCalc`, `TopologyLab`, `LinuxLab`) and the shared UI kit (`ui.tsx`)
- `src/lib/examples.ts`, `commands.ts` and `sample-data.ts` hold the C/C++ examples, the command reference and the SQL practice data
