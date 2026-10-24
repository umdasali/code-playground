// A simulated Ubuntu server for the Network tab's Linux lab: an in-memory filesystem, the network and service commands
// the practical tests ask for (ip, netplan, systemctl, apt, ufw, iptables, ss, tcpdump, ssh, ...), and the state they change.
// Pure state-in, state-out; nothing here touches a real machine or network.
import { ipToString, maskToPrefix, parseIp, parseMask, prefixToMask, sameSubnet } from "./network";

export interface Iface { name: string; up: boolean; addrs: string[]; mac: string }
export interface Route { dst: string; via?: string; dev: string }
export interface Rule { table: "filter" | "nat"; chain: string; spec: string }
export interface Proc { pid: number; user: string; name: string; cmd: string; port?: number; proto: "tcp" | "udp" }
export interface Svc { active: boolean; enabled: boolean; ports: number[]; error?: string }
export interface World {
  lan: string[]; // addresses that answer on the local network
  internet: string[]; // addresses reachable through a working gateway
  names: Record<string, string>; // what the DNS server knows
  dnsServers: string[]; // addresses of DNS servers that answer
  ssh?: { ip: string; port: number; user: string; host: string };
}
export interface Machine {
  user: "student" | "root";
  cwd: string;
  hostname: string;
  fs: Record<string, string>;
  dirs: string[];
  ifaces: Iface[];
  routes: Route[];
  dns: string[];
  installed: string[];
  svc: Record<string, Svc>;
  ufw: { enabled: boolean; defaultIn: "allow" | "deny"; rules: string[] };
  policy: Record<string, "ACCEPT" | "DROP">;
  rules: Rule[];
  procs: Proc[];
  world: World;
  keyAuthorized: boolean;
  events: string[];
  lines: string[];
  nextPid: number;
}
export interface RunResult { m: Machine; edit?: { path: string; content: string; readonly: boolean } }

const HOME = "/home/student";
export const PCAP_PATH = `${HOME}/capture.pcap`;

// ---------- small helpers ----------

export const fileText = (m: Machine, p: string) => m.fs[p] ?? "";
const abs = (m: Machine, p: string) => {
  const raw = p === "~" ? HOME : p.startsWith("~/") ? HOME + p.slice(1) : p.startsWith("/") ? p : `${m.cwd}/${p}`;
  const out: string[] = [];
  for (const part of raw.split("/")) { if (!part || part === ".") continue; if (part === "..") out.pop(); else out.push(part); }
  return "/" + out.join("/");
};
const isDir = (m: Machine, p: string) => p === "/" || m.dirs.includes(p) || Object.keys(m.fs).some((f) => f.startsWith(p + "/"));
const protectedPath = (p: string) => !(p === HOME || p.startsWith(HOME + "/") || p.startsWith("/tmp/") || p === "/tmp");
const addDir = (m: Machine, p: string) => { for (let d = p; d && d !== "/"; d = d.slice(0, d.lastIndexOf("/")) || "/") if (!m.dirs.includes(d)) m.dirs.push(d); };
const event = (m: Machine, e: string) => { if (!m.events.includes(e)) m.events.push(e); };
const iface = (m: Machine, name: string) => m.ifaces.find((i) => i.name === name);
const primary = (m: Machine) => m.ifaces.find((i) => i.name !== "lo")!;
const addrOf = (a: string) => a.split("/")[0];
const maskOf = (a: string) => prefixToMask(Number(a.split("/")[1]));
const ownIps = (m: Machine) => m.ifaces.filter((i) => i.up).flatMap((i) => i.addrs.map(addrOf));
const bcast = (a: string) => ipToString(((parseIp(addrOf(a))! & maskOf(a)) | ~maskOf(a)) >>> 0);

function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "", quote: string | null = null, has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i]; else cur += c; }
    else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; }
    else if (c === ">" || c === "<") { if (cur || has) out.push(cur); cur = ""; has = false; out.push(line[i + 1] === ">" ? (i++, ">>") : c); }
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

// Split at top-level separators outside quotes.
function splitTop(line: string, seps: string[]): { parts: string[]; ops: string[] } {
  const parts: string[] = [], ops: string[] = [];
  let cur = "", quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    const sep = seps.find((s) => line.startsWith(s, i) && !(s === "|" && line[i + 1] === "|"));
    if (sep) { parts.push(cur); ops.push(sep); cur = ""; i += sep.length - 1; continue; }
    cur += c;
  }
  parts.push(cur);
  return { parts, ops };
}

// ---------- configuration files -> runtime ----------

interface NetCfg { name: string; addrs: string[]; gw: string | null; dns: string[]; dhcp: boolean }

// A forgiving netplan reader: enough YAML for the usual static-address layouts. Returns an error like netplan would.
function parseNetplan(text: string): { cfgs: NetCfg[]; error?: string } {
  if (/\t/.test(text)) return { cfgs: [], error: "Invalid YAML: found character '\\t' that cannot start any token (use spaces, not tabs)" };
  const cfgs: NetCfg[] = [];
  let cur: NetCfg | null = null;
  let section: "addr" | "dns" | "routes" | null = null;
  let inEthernets = false;
  let routeTo = "";
  const list = (v: string) => v.replace(/[[\]]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const [n, raw] of text.split("\n").entries()) {
    const line = raw.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (indent === 0) { inEthernets = false; if (!/^network:\s*$/.test(t)) return { cfgs: [], error: `Invalid YAML at line ${n + 1}: expected 'network:' at the top` }; continue; }
    if (indent === 2) { inEthernets = /^ethernets:\s*$/.test(t); section = null; continue; }
    if (inEthernets && indent === 4) {
      const m = t.match(/^([\w.-]+):\s*$/);
      if (!m) return { cfgs: [], error: `Invalid YAML at line ${n + 1}: expected an interface name followed by ':'` };
      cur = { name: m[1], addrs: [], gw: null, dns: [], dhcp: false };
      cfgs.push(cur); section = null; continue;
    }
    if (!cur || !inEthernets) continue;
    const kv = t.match(/^([\w-]+):\s*(.*)$/);
    if (t.startsWith("- ")) {
      const item = t.slice(2).trim();
      if (section === "addr") cur.addrs.push(item);
      else if (section === "dns") cur.dns.push(item);
      else if (section === "routes") {
        const k = item.match(/^(to|via):\s*(\S+)/);
        if (k?.[1] === "to") routeTo = k[2];
        if (k?.[1] === "via" && (routeTo === "default" || routeTo === "0.0.0.0/0")) cur.gw = k[2];
        if (k?.[1] === "to" && (k[2] === "default" || k[2] === "0.0.0.0/0")) routeTo = "default";
      }
      continue;
    }
    if (!kv) return { cfgs: [], error: `Invalid YAML at line ${n + 1}: ${t}` };
    const [, key, val] = kv;
    if (key === "dhcp4") cur.dhcp = /^(true|yes)$/i.test(val);
    else if (key === "addresses" && section !== "dns") { if (val) cur.addrs.push(...list(val)); section = "addr"; }
    else if (key === "addresses") { cur.dns.push(...list(val)); }
    else if (key === "gateway4") cur.gw = val;
    else if (key === "nameservers") section = "dns";
    else if (key === "routes") section = "routes";
    else if (key === "to" && section === "routes") routeTo = val;
    else if (key === "via" && section === "routes" && (routeTo === "default" || routeTo === "0.0.0.0/0")) cur.gw = val;
    else if (key === "addresses") section = "addr";
  }
  for (const c of cfgs) for (const a of c.addrs) if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(a) || parseIp(addrOf(a)) === null || Number(a.split("/")[1]) > 32) return { cfgs: [], error: `Invalid address '${a}' for ${c.name}: use the form 192.168.10.20/24` };
  return { cfgs };
}

function parseInterfaces(text: string): NetCfg[] {
  const cfgs: NetCfg[] = [];
  let cur: NetCfg | null = null;
  for (const raw of text.split("\n")) {
    const t = raw.replace(/#.*$/, "").trim();
    const head = t.match(/^iface\s+(\S+)\s+inet\s+(\S+)/);
    if (head) { cur = { name: head[1], addrs: [], gw: null, dns: [], dhcp: head[2] === "dhcp" }; if (head[1] !== "lo") cfgs.push(cur); continue; }
    if (!cur) continue;
    const [k, ...rest] = t.split(/\s+/);
    const v = rest.join(" ");
    if (k === "address") { cur.addrs = [v.includes("/") ? v : v]; }
    else if (k === "netmask" && cur.addrs[0] && !cur.addrs[0].includes("/")) { const mk = parseMask(v); if (mk !== null) cur.addrs[0] += `/${maskToPrefix(mk)}`; }
    else if (k === "gateway") cur.gw = v;
    else if (k === "dns-nameservers") cur.dns = v.split(/\s+/);
  }
  // an address without a netmask is incomplete
  for (const c of cfgs) c.addrs = c.addrs.filter((a) => a.includes("/"));
  return cfgs;
}

function applyNet(m: Machine, cfgs: NetCfg[]) {
  for (const c of cfgs) {
    const i = iface(m, c.name);
    if (!i) continue;
    m.routes = m.routes.filter((r) => r.dev !== c.name);
    if (c.dhcp) { i.addrs = ["10.0.2.15/24"]; m.routes.push({ dst: "10.0.2.0/24", dev: c.name }, { dst: "default", via: "10.0.2.2", dev: c.name }); m.dns = ["10.0.2.3"]; continue; }
    i.addrs = [...c.addrs];
    for (const a of c.addrs) m.routes.push({ dst: `${ipToString((parseIp(addrOf(a))! & maskOf(a)) >>> 0)}/${a.split("/")[1]}`, dev: c.name });
    if (c.gw) m.routes.push({ dst: "default", via: c.gw, dev: c.name });
    if (c.dns.length) m.dns = [...c.dns];
  }
}

// ---------- reachability ----------

function resolve(m: Machine, name: string): string | null {
  if (parseIp(name) !== null) return name;
  if (name === "localhost") return "127.0.0.1";
  for (const l of fileText(m, "/etc/hosts").split("\n")) {
    const f = l.replace(/#.*$/, "").trim().split(/\s+/);
    if (f.length > 1 && f.slice(1).includes(name)) return f[0];
  }
  const servers = m.dns.length ? m.dns : [];
  const legacy = fileText(m, "/etc/resolv.conf").split("\n").map((l) => l.match(/^nameserver\s+(\S+)/)?.[1]).filter(Boolean) as string[];
  const tried = [...new Set([...servers, ...legacy.filter((s) => s !== "127.0.0.53")])];
  for (const s of tried) if (m.world.dnsServers.includes(s) && reach(m, s) && name in m.world.names) return m.world.names[name];
  return null;
}

// Why a packet to ip can or cannot leave this machine.
function route(m: Machine, ip: string): { ok: boolean; reason: string } {
  if (ownIps(m).includes(ip) || ip.startsWith("127.")) return { ok: true, reason: "" };
  const target = parseIp(ip)!;
  for (const i of m.ifaces) if (i.up) for (const a of i.addrs) if (sameSubnet(parseIp(addrOf(a))!, target, maskOf(a))) {
    return m.world.lan.includes(ip) ? { ok: true, reason: "" } : { ok: false, reason: `From ${addrOf(a)} icmp_seq=1 Destination Host Unreachable` };
  }
  const def = m.routes.find((r) => r.dst === "default" && r.via);
  if (!def) return { ok: false, reason: "ping: connect: Network is unreachable" };
  const gwUp = m.world.lan.includes(def.via!) && m.ifaces.some((i) => i.up && i.addrs.some((a) => sameSubnet(parseIp(addrOf(a))!, parseIp(def.via!)!, maskOf(a))));
  if (!gwUp) return { ok: false, reason: `From ${addrOf(primary(m).addrs[0] ?? "0.0.0.0/0")} icmp_seq=1 Destination Host Unreachable` };
  return m.world.internet.includes(ip) || m.world.lan.includes(ip) ? { ok: true, reason: "" } : { ok: false, reason: "" };
}
const reach = (m: Machine, ip: string) => route(m, ip).ok;

// ---------- services ----------

const ALIASES: Record<string, string> = { ssh: "ssh", sshd: "ssh", apache2: "apache2", httpd: "apache2", "isc-dhcp-server": "dhcp", dhcpd: "dhcp", networking: "networking", ufw: "ufw", "systemd-networkd": "networkd", "systemd-resolved": "resolved" };
const UNIT: Record<string, string> = { ssh: "ssh", apache2: "apache2", dhcp: "isc-dhcp-server", networking: "networking", ufw: "ufw" };
const SSH_KEYS = new Set(["port", "permitrootlogin", "passwordauthentication", "pubkeyauthentication", "listenaddress", "usepam", "x11forwarding", "allowusers", "include", "printmotd", "acceptenv", "subsystem", "kbdinteractiveauthentication", "challengeresponseauthentication", "maxauthtries", "logingracetime", "permitemptypasswords", "protocol", "hostkey", "allowtcpforwarding", "clientaliveinterval", "clientalivecountmax", "denyusers", "authorizedkeysfile", "printlastlog", "strictmodes"]);

export function sshPorts(m: Machine): { ports: number[]; error?: string } {
  const ports: number[] = [];
  for (const [n, raw] of fileText(m, "/etc/ssh/sshd_config").split("\n").entries()) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split(/\s+/);
    if (!SSH_KEYS.has(k.toLowerCase())) return { ports: [], error: `/etc/ssh/sshd_config line ${n + 1}: Bad configuration option: ${k}` };
    if (k.toLowerCase() === "port") { const p = Number(v[0]); if (!Number.isInteger(p) || p < 1 || p > 65535) return { ports: [], error: `/etc/ssh/sshd_config line ${n + 1}: Badly formatted port number.` }; ports.push(p); }
    if (k.toLowerCase() === "permitrootlogin" && !["yes", "no", "prohibit-password", "without-password", "forced-commands-only"].includes((v[0] ?? "").toLowerCase())) return { ports: [], error: `/etc/ssh/sshd_config line ${n + 1}: unsupported option "${v[0] ?? ""}".` };
  }
  return { ports: ports.length ? ports : [22] };
}

export function apachePlan(m: Machine): { ports: number[]; vhosts: { port: number; root: string }[] } {
  const ports = [...fileText(m, "/etc/apache2/ports.conf").matchAll(/^\s*Listen\s+(?:[\d.:*[\]]*:)?(\d+)\s*$/gm)].map((x) => Number(x[1]));
  const vhosts: { port: number; root: string }[] = [];
  for (const [path, text] of Object.entries(m.fs)) {
    if (!path.startsWith("/etc/apache2/sites-enabled/") && !path.startsWith("/etc/apache2/sites-available/")) continue;
    if (path.startsWith("/etc/apache2/sites-available/") && !(`/etc/apache2/sites-enabled/${path.split("/").pop()}` in m.fs) && !m.fs[`/etc/apache2/sites-enabled/${path.split("/").pop()}`]) { if (path.split("/").pop() !== "000-default.conf") continue; }
    for (const v of text.matchAll(/<VirtualHost\s+[^:>\s]*:(\d+)>([\s\S]*?)<\/VirtualHost>/g)) {
      const root = v[2].match(/^\s*DocumentRoot\s+"?([^"\s]+)"?/m)?.[1];
      if (root && !vhosts.some((x) => x.port === Number(v[1]) && x.root === root)) vhosts.push({ port: Number(v[1]), root });
    }
  }
  return { ports, vhosts };
}

export function httpHead(m: Machine, port: number): string[] {
  const a = m.svc.apache2;
  if (!a?.active || !a.ports.includes(port)) return [`curl: (7) Failed to connect to localhost port ${port} after 0 ms: Connection refused`];
  const plan = apachePlan(m);
  const vh = plan.vhosts.find((v) => v.port === port) ?? plan.vhosts[0];
  const root = vh?.root ?? "/var/www/html";
  const ok = `${root}/index.html` in m.fs || `${root}/index.php` in m.fs;
  const head = (st: string) => [st, "Date: Mon, 20 Oct 2025 10:00:00 GMT", "Server: Apache/2.4.58 (Ubuntu)", "Content-Type: text/html", ""];
  if (!isDir(m, root)) return head("HTTP/1.1 404 Not Found");
  return ok ? head("HTTP/1.1 200 OK") : head("HTTP/1.1 403 Forbidden");
}

// dhcpd.conf problems, as dhcpd -t would report them.
export function dhcpProblem(m: Machine): string | null {
  const text = fileText(m, "/etc/dhcp/dhcpd.conf").replace(/#.*$/gm, "");
  let depth = 0;
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.endsWith("{")) depth++;
    else if (t === "}") depth--;
    else if (!t.endsWith(";")) return `/etc/dhcp/dhcpd.conf: semicolon expected near "${t}"`;
  }
  if (depth !== 0) return "/etc/dhcp/dhcpd.conf: unbalanced braces";
  const ifs = fileText(m, "/etc/default/isc-dhcp-server").match(/^INTERFACESv4="([^"]*)"/m)?.[1]?.trim();
  if (!ifs) return 'No interface configured: set INTERFACESv4="<interface>" in /etc/default/isc-dhcp-server';
  const i = iface(m, ifs);
  const ip = i?.addrs[0];
  if (!i || !ip) return `Interface ${ifs} has no IPv4 address`;
  for (const s of text.matchAll(/subnet\s+(\S+)\s+netmask\s+(\S+)\s*\{/g)) {
    const net = parseIp(s[1]), mask = parseIp(s[2]);
    if (net !== null && mask !== null && sameSubnet(net, parseIp(addrOf(ip))!, mask)) return null;
  }
  return `No subnet declaration for ${ifs} (${addrOf(ip)}).\n** Ignoring requests on ${ifs}. If this is not what you want, please write a subnet declaration in your dhcpd.conf file for the network segment to which interface ${ifs} is attached. **`;
}

function startService(m: Machine, key: string, verb: string): string[] {
  const s = (m.svc[key] ??= { active: false, enabled: false, ports: [] });
  const unit = UNIT[key] ?? key;
  const fail = (msg: string[]) => { s.active = false; s.ports = []; s.error = msg[0]; return [`Job for ${unit}.service failed because the control process exited with error code.`, `See "systemctl status ${unit}.service" and "journalctl -xeu ${unit}.service" for details.`]; };
  if (verb === "stop") { s.active = false; s.ports = []; return []; }
  if (key === "ssh") {
    const r = sshPorts(m);
    if (r.error) return fail([r.error]);
    s.active = true; s.ports = r.ports; s.error = undefined;
  } else if (key === "apache2") {
    if (!m.installed.includes("apache2")) return [`Failed to ${verb} apache2.service: Unit apache2.service not found.`];
    const plan = apachePlan(m);
    const ports = plan.ports.length ? plan.ports : [80];
    const clash = listeners(m, "apache2").find((l) => ports.includes(l.port) && l.proto === "tcp");
    if (clash) return fail([`(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:${clash.port}`]);
    s.active = true; s.ports = ports; s.error = undefined;
  } else if (key === "dhcp") {
    if (!m.installed.includes("isc-dhcp-server")) return [`Failed to ${verb} isc-dhcp-server.service: Unit isc-dhcp-server.service not found.`];
    const p = dhcpProblem(m);
    if (p) { s.error = p; s.active = false; return fail([p]); }
    s.active = true; s.ports = [67]; s.error = undefined;
  } else if (key === "networking") {
    applyNet(m, parseInterfaces(fileText(m, "/etc/network/interfaces")));
    s.active = true;
  } else s.active = true;
  return [];
}

export interface Listener { proto: "tcp" | "udp"; addr: string; port: number; pid: number; name: string }
export function listeners(m: Machine, ignore?: string): Listener[] {
  const out: Listener[] = [{ proto: "udp", addr: "127.0.0.53%lo", port: 53, pid: 521, name: "systemd-resolve" }, { proto: "tcp", addr: "127.0.0.53%lo", port: 53, pid: 521, name: "systemd-resolve" }];
  if (m.svc.ssh?.active && ignore !== "ssh") for (const p of m.svc.ssh.ports) out.push({ proto: "tcp", addr: "0.0.0.0", port: p, pid: 812, name: "sshd" });
  if (m.svc.apache2?.active && ignore !== "apache2") for (const p of m.svc.apache2.ports) out.push({ proto: "tcp", addr: "*", port: p, pid: 1450, name: "apache2" });
  if (m.svc.dhcp?.active && ignore !== "dhcp") out.push({ proto: "udp", addr: "0.0.0.0", port: 67, pid: 1633, name: "dhcpd" });
  for (const p of m.procs) if (p.port) out.push({ proto: p.proto, addr: "0.0.0.0", port: p.port, pid: p.pid, name: p.name });
  return out;
}

// ---------- command implementations ----------

type Ctx = { m: Machine; root: boolean; stdin: string | null; out: string[]; edit?: RunResult["edit"] };
const needRoot = (c: Ctx, what: string) => { if (c.root) return false; c.out.push(what); return true; };

function writeFile(c: Ctx, path: string, content: string, append: boolean): boolean {
  if (protectedPath(path) && !c.root) { c.out.push(`bash: ${path}: Permission denied`); return false; }
  if (isDir(c.m, path)) { c.out.push(`bash: ${path}: Is a directory`); return false; }
  const parent = path.slice(0, path.lastIndexOf("/")) || "/";
  if (!isDir(c.m, parent)) { c.out.push(`bash: ${path}: No such file or directory`); return false; }
  c.m.fs[path] = append ? (c.m.fs[path] ?? "") + content : content;
  return true;
}

const flagsOf = (args: string[]) => args.filter((a) => a.startsWith("-") && a.length > 1 && !/^-\d/.test(a));
const plain = (args: string[]) => args.filter((a) => !(a.startsWith("-") && a.length > 1));

function ipAddrShow(m: Machine, only?: string): string[] {
  const out: string[] = [];
  m.ifaces.forEach((i, idx) => {
    if (only && i.name !== only) return;
    const lo = i.name === "lo";
    out.push(`${idx + 1}: ${i.name}: <${lo ? "LOOPBACK" : "BROADCAST,MULTICAST"}${i.up ? ",UP,LOWER_UP" : ""}> mtu ${lo ? 65536 : 1500} qdisc ${lo ? "noqueue" : "fq_codel"} state ${i.up ? (lo ? "UNKNOWN" : "UP") : "DOWN"} group default qlen 1000`);
    out.push(`    link/${lo ? "loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00" : `ether ${i.mac} brd ff:ff:ff:ff:ff:ff`}`);
    for (const a of i.addrs) out.push(`    inet ${a}${lo ? "" : ` brd ${bcast(a)}`} scope ${lo ? "host" : "global"} ${i.name}`, "       valid_lft forever preferred_lft forever");
  });
  return out.length ? out : [`Device "${only}" does not exist.`];
}

function ifconfig(m: Machine, only?: string): string[] {
  const out: string[] = [];
  for (const i of m.ifaces) {
    if (only && i.name !== only) continue;
    const lo = i.name === "lo";
    out.push(`${i.name}: flags=${i.up ? (lo ? "73<UP,LOOPBACK,RUNNING>" : "4163<UP,BROADCAST,RUNNING,MULTICAST>") : "4098<BROADCAST,MULTICAST>"}  mtu ${lo ? 65536 : 1500}`);
    for (const a of i.addrs) out.push(`        inet ${addrOf(a)}  netmask ${ipToString(maskOf(a))}${lo ? "" : `  broadcast ${bcast(a)}`}`);
    out.push(lo ? "        loop  txqueuelen 1000  (Local Loopback)" : `        ether ${i.mac}  txqueuelen 1000  (Ethernet)`, "");
  }
  return out.length ? out : [`${only}: error fetching interface information: Device not found`];
}

function routeShow(m: Machine): string[] {
  const rs = [...m.routes].sort((a, b) => (a.dst === "default" ? -1 : b.dst === "default" ? 1 : 0));
  return rs.map((r) => {
    const i = iface(m, r.dev);
    const src = i?.addrs[0] ? ` src ${addrOf(i.addrs[0])}` : "";
    return r.via ? `${r.dst} via ${r.via} dev ${r.dev}` : `${r.dst} dev ${r.dev} proto kernel scope link${src}`;
  });
}

function ipCmd(c: Ctx, a: string[]): void {
  const { m, out } = c;
  const rest = a[0]?.startsWith("-") ? a.slice(1) : a;
  const o = rest[0] ?? "";
  const verb = rest[1] ?? "show";
  const is = (full: string, min: number) => o.length >= min && full.startsWith(o);
  if (is("addr", 1) || o === "a" || o === "address") {
    if (verb === "show" || verb === "list" || verb === "ls" || !rest[1] || verb === "s") {
      const dev = rest[1] === "show" ? rest[2] === "dev" ? rest[3] : rest[2] : undefined;
      out.push(...ipAddrShow(m, dev));
    } else if (verb === "add" || verb === "del") {
      if (needRoot(c, "RTNETLINK answers: Operation not permitted")) return;
      const addr = rest[2], dev = rest[rest.indexOf("dev") + 1];
      const i = dev ? iface(m, dev) : undefined;
      if (!addr || !i) { out.push(`Cannot find device "${dev ?? ""}"`); return; }
      if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(addr) || parseIp(addrOf(addr)) === null) { out.push(`Error: inet prefix is expected rather than "${addr}".`); return; }
      if (verb === "add") {
        if (i.addrs.includes(addr)) { out.push("RTNETLINK answers: File exists"); return; }
        i.addrs.push(addr);
        m.routes.push({ dst: `${ipToString((parseIp(addrOf(addr))! & maskOf(addr)) >>> 0)}/${addr.split("/")[1]}`, dev });
      } else {
        if (!i.addrs.includes(addr)) { out.push("RTNETLINK answers: Cannot assign requested address"); return; }
        i.addrs = i.addrs.filter((x) => x !== addr);
        const net = ipToString((parseIp(addrOf(addr))! & maskOf(addr)) >>> 0);
        m.routes = m.routes.filter((r) => !(r.dev === dev && r.via === undefined && r.dst.startsWith(net)));
        m.routes = m.routes.filter((r) => !(r.via && r.dev === dev && !i.addrs.some((x) => sameSubnet(parseIp(addrOf(x))!, parseIp(r.via!)!, maskOf(x)))));
      }
    } else if (verb === "flush") {
      if (needRoot(c, "RTNETLINK answers: Operation not permitted")) return;
      const i = iface(m, rest[rest.indexOf("dev") + 1]);
      if (i) { i.addrs = []; m.routes = m.routes.filter((r) => r.dev !== i.name); }
    } else out.push(`Command "${verb}" is unknown, try "ip address help".`);
  } else if (is("link", 1)) {
    if (verb === "set") {
      if (needRoot(c, "RTNETLINK answers: Operation not permitted")) return;
      const i = iface(m, rest[2]);
      if (!i) { out.push(`Cannot find device "${rest[2]}"`); return; }
      if (rest[3] === "up") i.up = true; else if (rest[3] === "down") i.up = false; else out.push("Error: argument is wrong: up or down expected");
    } else out.push(...ipAddrShow(m).filter((l) => /^\d+:|link\//.test(l)));
  } else if (is("route", 1) || o === "r") {
    if (verb === "show" || verb === "list" || !rest[1]) { event(m, "ip-route"); out.push(...routeShow(m)); return; }
    if (needRoot(c, "RTNETLINK answers: Operation not permitted")) return;
    const dst = rest[2];
    const via = rest.includes("via") ? rest[rest.indexOf("via") + 1] : undefined;
    const devArg = rest.includes("dev") ? rest[rest.indexOf("dev") + 1] : undefined;
    if (verb === "add" || verb === "replace") {
      if (!dst || (dst !== "default" && !/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(dst))) { out.push(`Error: Invalid prefix or "default" expected.`); return; }
      const exists = m.routes.find((r) => r.dst === dst);
      if (exists && verb === "add") { out.push("RTNETLINK answers: File exists"); return; }
      if (via) {
        const ok = m.ifaces.find((i) => i.up && i.addrs.some((x) => sameSubnet(parseIp(addrOf(x))!, parseIp(via) ?? 0, maskOf(x))));
        if (!ok || parseIp(via) === null) { out.push("Error: Nexthop has invalid gateway."); return; }
        m.routes = m.routes.filter((r) => r.dst !== dst);
        m.routes.push({ dst, via, dev: devArg ?? ok.name });
      } else if (devArg) { m.routes = m.routes.filter((r) => r.dst !== dst); m.routes.push({ dst, dev: devArg }); }
      else out.push("Error: either \"to\" is duplicate, or \"via\" or \"dev\" is expected.");
    } else if (verb === "del" || verb === "delete") {
      const before = m.routes.length;
      m.routes = m.routes.filter((r) => r.dst !== dst);
      if (m.routes.length === before) out.push("RTNETLINK answers: No such process");
    } else out.push(`Command "${verb}" is unknown, try "ip route help".`);
  } else out.push(`Object "${o}" is unknown, try "ip help".`);
}

function ping(c: Ctx, a: string[]) {
  const { m, out } = c;
  const count = Number(a[a.indexOf("-c") + 1]) || 4;
  const host = plain(a).filter((x) => x !== String(count) || !a.includes("-c")).pop();
  if (!host) { out.push("ping: usage error: Destination address required"); return; }
  const ip = resolve(m, host);
  if (!ip) { out.push(`ping: ${host}: Temporary failure in name resolution`); return; }
  if (route(m, ip).ok) {
    event(m, `ping:${ip}`);
    const ttl = ownIps(m).includes(ip) || ip.startsWith("127.") ? 64 : m.world.lan.includes(ip) ? 64 : 117;
    out.push(`PING ${host} (${ip}) 56(84) bytes of data.`);
    for (let i = 1; i <= count; i++) out.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=${ttl} time=${(0.4 + i * 0.07).toFixed(1)} ms`);
    out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms`);
  } else {
    const r = route(m, ip);
    out.push(`PING ${host} (${ip}) 56(84) bytes of data.`);
    if (r.reason.startsWith("ping:")) out.push(r.reason);
    else if (r.reason) { for (let i = 1; i <= Math.min(count, 3); i++) out.push(r.reason.replace("icmp_seq=1", `icmp_seq=${i}`)); out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, 0 received, +${Math.min(count, 3)} errors, 100% packet loss, time ${(count - 1) * 1001}ms`); }
    else out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, 0 received, 100% packet loss, time ${(count - 1) * 1001}ms`);
  }
}

function traceroute(c: Ctx, a: string[], name: string) {
  const { m, out } = c;
  const host = plain(a).pop();
  if (!host) { out.push(`Usage: ${name} <host>`); return; }
  const ip = resolve(m, host);
  if (!ip) { out.push(`${name}: ${host}: Temporary failure in name resolution`); return; }
  event(m, "traceroute");
  const me = primary(m).addrs[0] ? addrOf(primary(m).addrs[0]) : "0.0.0.0";
  const r = route(m, ip);
  out.push(name === "tracepath" ? `1?: [LOCALHOST]                      pmtu 1500` : `traceroute to ${host} (${ip}), 30 hops max, 60 byte packets`);
  const gw = m.routes.find((x) => x.dst === "default")?.via;
  const onLink = m.ifaces.some((i) => i.addrs.some((x) => sameSubnet(parseIp(addrOf(x))!, parseIp(ip)!, maskOf(x))));
  if (r.ok) {
    if (onLink || ownIps(m).includes(ip)) out.push(` 1  ${ip}  0.5 ms  0.4 ms  0.4 ms`);
    else out.push(` 1  ${gw}  0.6 ms  0.5 ms  0.5 ms`, ` 2  203.0.113.1  4.2 ms  4.1 ms  4.0 ms`, ` 3  ${ip}  9.8 ms  9.7 ms  9.9 ms`);
  } else if (!gw && !onLink) out.push("connect: Network is unreachable");
  else out.push(` 1  ${me}  3001.1 ms !H  3001.0 ms !H  3000.9 ms !H`);
}

function listeningTable(m: Machine, tool: "ss" | "netstat", a: string[]): string[] {
  event(m, tool);
  const rows = listeners(m);
  const out: string[] = [];
  if (tool === "ss") {
    out.push("Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process");
    for (const l of rows) out.push(`${l.proto.padEnd(5)} ${l.proto === "tcp" ? "LISTEN" : "UNCONN"} 0      ${l.proto === "tcp" ? "128   " : "0     "} ${`${l.addr}:${l.port}`.padEnd(19)} ${(l.proto === "tcp" ? "0.0.0.0:*" : "0.0.0.0:*").padEnd(17)} ${a.join("").includes("p") ? `users:(("${l.name}",pid=${l.pid},fd=${3 + (l.pid % 5)}))` : ""}`.trimEnd());
  } else {
    out.push("Active Internet connections (only servers)", "Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name");
    for (const l of rows) out.push(`${l.proto.padEnd(5)} 0      0      ${`${l.addr === "*" ? ":::" : l.addr}:${l.port}`.padEnd(23)} ${"0.0.0.0:*".padEnd(23)} ${l.proto === "tcp" ? "LISTEN     " : "           "} ${a.join("").includes("p") ? `${l.pid}/${l.name}` : "-"}`);
  }
  return out;
}

function iptablesRun(c: Ctx, a: string[]) {
  const { m, out } = c;
  if (needRoot(c, "iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)")) return;
  let table: "filter" | "nat" = "filter";
  const args = [...a];
  const ti = args.indexOf("-t");
  if (ti >= 0) { const t = args[ti + 1]; if (t !== "filter" && t !== "nat") { out.push(`iptables v1.8.10: can't initialize iptables table \`${t}': Table does not exist (do you need to insmod?)`); return; } table = t; args.splice(ti, 2); }
  const op = args[0];
  const chains = table === "nat" ? ["PREROUTING", "INPUT", "OUTPUT", "POSTROUTING"] : ["INPUT", "FORWARD", "OUTPUT"];
  const chain = args[1];
  if (op === "-L" || op === "-S" || op === "-nL" || op === "-vnL") {
    const wanted = args.slice(1).filter((x) => !x.startsWith("-"))[0];
    if (op === "-S") {
      for (const ch of chains.filter((x) => !wanted || x === wanted)) out.push(table === "filter" ? `-P ${ch} ${m.policy[ch] ?? "ACCEPT"}` : `-P ${ch} ACCEPT`);
      for (const r of m.rules.filter((x) => x.table === table && (!wanted || x.chain === wanted))) out.push(`-A ${r.chain} ${r.spec}`);
      return;
    }
    for (const ch of chains.filter((x) => !wanted || x === wanted)) {
      out.push(`Chain ${ch} (policy ${table === "filter" ? m.policy[ch] ?? "ACCEPT" : "ACCEPT"})`, "target     prot opt source               destination");
      for (const r of m.rules.filter((x) => x.table === table && x.chain === ch)) out.push(describeRule(r));
      out.push("");
    }
    return;
  }
  if (op === "-A" || op === "-I") {
    if (!chains.includes(chain)) { out.push(`iptables: No chain/target/match by that name.`); return; }
    const spec = args.slice(2).join(" ");
    const target = spec.match(/-j\s+(\S+)/)?.[1];
    if (!target) { out.push("iptables v1.8.10: no target given (use -j)"); return; }
    if (!["ACCEPT", "DROP", "REJECT", "MASQUERADE", "SNAT", "DNAT", "LOG", "RETURN"].includes(target)) { out.push(`iptables v1.8.10: Couldn't load target \`${target}'`); return; }
    if (target === "MASQUERADE" && !(table === "nat" && chain === "POSTROUTING")) { out.push("iptables: MASQUERADE is only valid in the nat table's POSTROUTING chain (-t nat -A POSTROUTING)."); return; }
    if (/--dport/.test(spec) && !/-p\s+(tcp|udp)/.test(spec)) { out.push("iptables v1.8.10: unknown option \"--dport\" (add -p tcp or -p udp first)"); return; }
    const rule: Rule = { table, chain, spec: spec.replace(/\s+/g, " ") };
    if (op === "-I") m.rules.unshift(rule); else m.rules.push(rule);
    return;
  }
  if (op === "-D") { const spec = args.slice(2).join(" ").replace(/\s+/g, " "); const idx = m.rules.findIndex((r) => r.table === table && r.chain === chain && r.spec === spec); if (idx < 0) out.push("iptables: Bad rule (does a matching rule exist in that chain?)."); else m.rules.splice(idx, 1); return; }
  if (op === "-F") { m.rules = m.rules.filter((r) => r.table !== table || (chain && r.chain !== chain)); return; }
  if (op === "-P") { if (table === "filter" && chains.includes(chain) && (args[2] === "ACCEPT" || args[2] === "DROP")) m.policy[chain] = args[2]; else out.push("iptables: Bad policy name."); return; }
  out.push(`iptables v1.8.10: unknown option "${op ?? ""}"`);
}

function describeRule(r: Rule): string {
  const g = (re: RegExp) => r.spec.match(re)?.[1];
  const target = g(/-j\s+(\S+)/) ?? "";
  const prot = g(/-p\s+(\S+)/) ?? "all";
  const src = g(/-s\s+(\S+)/) ?? "0.0.0.0/0";
  const dst = g(/-d\s+(\S+)/) ?? "0.0.0.0/0";
  const extra = [g(/--dport\s+(\S+)/) && `dpt:${g(/--dport\s+(\S+)/)}`, g(/--icmp-type\s+(\S+)/) && `icmptype ${g(/--icmp-type\s+(\S+)/) === "echo-request" ? 8 : g(/--icmp-type\s+(\S+)/)}`, g(/-o\s+(\S+)/) && `out ${g(/-o\s+(\S+)/)}`].filter(Boolean).join(" ");
  return `${target.padEnd(10)} ${prot.padEnd(4)} --  ${src.padEnd(20)} ${dst.padEnd(20)} ${extra}`.trimEnd();
}

function ufwRun(c: Ctx, a: string[]) {
  const { m, out } = c;
  if (!m.installed.includes("ufw")) { out.push("ufw: command not found"); return; }
  const verb = a[0];
  if (verb === "status") {
    if (!m.ufw.enabled) { out.push("Status: inactive"); return; }
    if (needRoot(c, "ERROR: You need to be root to run this script")) return;
    const verbose = a.includes("verbose");
    out.push("Status: active");
    if (verbose) out.push("Logging: on (low)", `Default: ${m.ufw.defaultIn} (incoming), allow (outgoing), disabled (routed)`, "New profiles: skip");
    out.push("", "To                         Action      From", "--                         ------      ----");
    m.ufw.rules.forEach((r, i) => { const [to, action, from] = r.split("|"); out.push(`${a.includes("numbered") ? `[${String(i + 1).padStart(2)}] ` : ""}${to.padEnd(26)} ${action.padEnd(11)} ${from}`); });
    return;
  }
  if (needRoot(c, "ERROR: You need to be root to run this script")) return;
  const addRule = (action: "ALLOW" | "DENY" | "REJECT" | "LIMIT") => {
    let from = "Anywhere", to = "";
    const rest = a.slice(1).filter((x) => x !== "in");
    const fi = rest.indexOf("from");
    if (fi >= 0) {
      from = rest[fi + 1] === "any" ? "Anywhere" : rest[fi + 1];
      if (from !== "Anywhere" && parseIp(from.split("/")[0]) === null) { out.push(`ERROR: Bad source address`); return; }
      const pi = rest.indexOf("port");
      const proto = rest.indexOf("proto");
      if (pi >= 0) to = rest[pi + 1] + (proto >= 0 && rest[proto + 1] ? `/${rest[proto + 1]}` : "");
      else to = "Anywhere";
    } else {
      const spec = rest[0] ?? "";
      const named: Record<string, string> = { ssh: "22/tcp", http: "80/tcp", https: "443/tcp", "OpenSSH": "OpenSSH", www: "80/tcp", "Apache Full": "Apache Full" };
      to = named[spec] ?? spec;
      if (!/^(\d+(:\d+)?(\/(tcp|udp))?|OpenSSH|Apache Full|22\/tcp|80\/tcp|443\/tcp)$/.test(to)) { out.push("ERROR: Could not find a profile matching '" + spec + "'"); return; }
    }
    const row = `${to}|${action} IN|${from}`;
    if (m.ufw.rules.includes(row)) { out.push("Skipping adding existing rule"); return; }
    m.ufw.rules.push(row);
    out.push(m.ufw.enabled ? "Rule added" : "Rules updated (ufw is inactive: run `sudo ufw enable`)");
  };
  if (verb === "enable") { m.ufw.enabled = true; out.push("Command may disrupt existing ssh connections. Proceed with operation (y|n)? y", "Firewall is active and enabled on system startup"); }
  else if (verb === "disable") { m.ufw.enabled = false; out.push("Firewall stopped and disabled on system startup"); }
  else if (verb === "reset") { m.ufw = { enabled: false, defaultIn: "deny", rules: [] }; out.push("Resetting all rules to installed defaults."); }
  else if (verb === "default") { if ((a[1] === "deny" || a[1] === "allow") && a[2] === "incoming") { m.ufw.defaultIn = a[1]; out.push(`Default incoming policy changed to '${a[1]}'`, "(be sure to update your rules accordingly)"); } else out.push("ERROR: Invalid syntax. Usage: ufw default allow|deny|reject DIRECTION"); }
  else if (verb === "allow") addRule("ALLOW");
  else if (verb === "deny") addRule("DENY");
  else if (verb === "reject") addRule("REJECT");
  else if (verb === "delete") {
    const n = Number(a[1]);
    if (Number.isInteger(n) && n >= 1 && n <= m.ufw.rules.length) { m.ufw.rules.splice(n - 1, 1); out.push("Rule deleted"); }
    else out.push("ERROR: Could not delete non-existent rule (use `ufw status numbered` and `ufw delete <number>`)");
  } else out.push(`ERROR: Invalid syntax. Try: ufw allow from 192.168.1.100 to any port 22`);
}

const PACKAGES: Record<string, string[]> = {
  apache2: ["apache2"], "isc-dhcp-server": ["isc-dhcp-server"], tcpdump: ["tcpdump"], "net-tools": ["net-tools"], ufw: ["ufw"], "openssh-server": ["openssh-server"], traceroute: ["traceroute"], curl: ["curl"], lsof: ["lsof"], nginx: [], dnsmasq: [],
};

function install(m: Machine, pkg: string): string[] {
  if (pkg === "nginx" || pkg === "dnsmasq") return [`${pkg}: not simulated in this lab. Use ${pkg === "nginx" ? "apache2" : "isc-dhcp-server"} for this task.`];
  if (!(pkg in PACKAGES)) return [`E: Unable to locate package ${pkg}`];
  if (m.installed.includes(pkg)) return [`${pkg} is already the newest version.`];
  m.installed.push(pkg);
  const out = [`Reading package lists... Done`, `Setting up ${pkg} ...`];
  if (pkg === "apache2") {
    m.fs["/etc/apache2/ports.conf"] ??= "Listen 80\n\n<IfModule ssl_module>\n\tListen 443\n</IfModule>\n";
    m.fs["/etc/apache2/ports.conf"] = "Listen 80\n";
    m.fs["/etc/apache2/sites-available/000-default.conf"] = "<VirtualHost *:80>\n    ServerAdmin webmaster@localhost\n    DocumentRoot /var/www/html\n    ErrorLog ${APACHE_LOG_DIR}/error.log\n</VirtualHost>\n";
    m.fs["/etc/apache2/sites-enabled/000-default.conf"] = m.fs["/etc/apache2/sites-available/000-default.conf"];
    m.fs["/var/www/html/index.html"] = "<h1>Apache2 Ubuntu Default Page</h1>\n";
    addDir(m, "/var/www/html");
    startService(m, "apache2", "start");
    m.svc.apache2.enabled = true;
  } else if (pkg === "isc-dhcp-server") {
    m.fs["/etc/dhcp/dhcpd.conf"] = "# dhcpd.conf\n#\n# option domain-name \"example.org\";\n# default-lease-time 600;\n# max-lease-time 7200;\n#subnet 10.5.5.0 netmask 255.255.255.224 {\n#  range 10.5.5.26 10.5.5.30;\n#}\n";
    m.fs["/etc/default/isc-dhcp-server"] = '# Defaults for isc-dhcp-server\nINTERFACESv4=""\nINTERFACESv6=""\n';
    m.svc.dhcp = { active: false, enabled: true, ports: [], error: 'No interface configured: set INTERFACESv4="<interface>" in /etc/default/isc-dhcp-server' };
    out.push("invoke-rc.d: initscript isc-dhcp-server, action \"start\" failed (not configured yet: edit /etc/dhcp/dhcpd.conf).");
  }
  return out;
}

function systemctl(c: Ctx, a: string[]) {
  const { m, out } = c;
  const verb = a[0];
  const name = a[1]?.replace(/\.service$/, "");
  if (!verb || (verb !== "daemon-reload" && !name)) { out.push("Too few arguments."); return; }
  if (verb === "daemon-reload") { if (!c.root) out.push("Failed to reload daemon: Access denied"); return; }
  const key = ALIASES[name];
  if (!key) { out.push(`Failed to ${verb} ${name}.service: Unit ${name}.service not found.`); return; }
  const unit = UNIT[key] ?? name;
  const s = (m.svc[key] ??= { active: false, enabled: false, ports: [] });
  if (verb === "status") {
    if (key === "apache2" && !m.installed.includes("apache2") || (key === "dhcp" && !m.installed.includes("isc-dhcp-server"))) { out.push(`Unit ${unit}.service could not be found.`); return; }
    out.push(`● ${unit}.service - ${key === "ssh" ? "OpenBSD Secure Shell server" : key === "apache2" ? "The Apache HTTP Server" : key === "dhcp" ? "ISC DHCP IPv4 server" : unit}`, `     Loaded: loaded (/lib/systemd/system/${unit}.service; ${s.enabled ? "enabled" : "disabled"}; preset: enabled)`, s.active ? "     Active: active (running) since Mon 2025-10-20 10:00:00 UTC" : `     Active: failed (Result: exit-code) since Mon 2025-10-20 10:00:00 UTC`);
    if (s.ports.length && s.active) out.push(`     Listening: ${s.ports.join(", ")}`);
    if (s.error) out.push("", `${unit}[1234]: ${s.error.split("\n")[0]}`);
    return;
  }
  if (verb === "is-active") { out.push(s.active ? "active" : "inactive"); return; }
  if (verb === "is-enabled") { out.push(s.enabled ? "enabled" : "disabled"); return; }
  if (!c.root) { out.push(`Failed to ${verb} ${unit}.service: Interactive authentication required.`, "See system logs and 'systemctl status " + unit + ".service' for details. (use sudo)"); return; }
  if (verb === "enable" || verb === "disable") { s.enabled = verb === "enable"; out.push(verb === "enable" ? `Created symlink /etc/systemd/system/multi-user.target.wants/${unit}.service` : `Removed /etc/systemd/system/multi-user.target.wants/${unit}.service`); return; }
  if (verb === "start" || verb === "restart" || verb === "reload" || verb === "stop") { out.push(...startService(m, key, verb === "reload" ? "restart" : verb)); return; }
  out.push(`Unknown command verb ${verb}.`);
}

const TCPDUMP_FLAGS = (filter: string, me: string, c: Ctx): string[] => {
  const out: string[] = [];
  const peer = c.m.world.lan[0] ?? "192.168.10.1";
  const web = c.m.world.internet[0] ?? "8.8.8.8";
  const port80 = /port\s+80|http/.test(filter);
  for (let i = 0; i < 10; i++) {
    const t = `10:15:${String(10 + Math.floor(i / 2)).padStart(2, "0")}.${String(120000 + i * 31337).slice(0, 6)}`;
    if (/icmp/.test(filter) || (!port80 && !/tcp/.test(filter))) out.push(`${t} IP ${i % 2 === 0 ? `${me} > ${web}` : `${web} > ${me}`}: ICMP echo ${i % 2 === 0 ? "request" : "reply"}, id 4021, seq ${Math.floor(i / 2) + 1}, length 64`);
    else out.push(`${t} IP ${i % 2 === 0 ? `${me}.${40000 + i} > ${peer}.80` : `${peer}.80 > ${me}.${40000 + i - 1}`}: Flags [${i === 0 ? "S" : i === 1 ? "S." : i === 2 ? "." : i % 2 ? "P." : "."}], seq ${1000 + i * 100}, length ${i > 2 ? 120 : 0}`);
  }
  return out;
};

const PCAP = [
  "10:21:07.113420 IP 10.0.0.5.52144 > 10.0.0.9.80: Flags [S], seq 3318822011, win 64240, length 0",
  "10:21:07.113877 IP 10.0.0.9.80 > 10.0.0.5.52144: Flags [S.], seq 1180220110, ack 3318822012, win 65160, length 0",
  "10:21:07.113902 IP 10.0.0.5.52144 > 10.0.0.9.80: Flags [.], ack 1, win 502, length 0",
  "10:21:07.114300 IP 10.0.0.5.52144 > 10.0.0.9.80: Flags [P.], seq 1:79, ack 1, win 502, length 78: HTTP: GET /index.html HTTP/1.1",
  "10:21:07.114810 IP 10.0.0.9.80 > 10.0.0.5.52144: Flags [P.], seq 1:311, ack 79, win 509, length 310: HTTP: HTTP/1.1 200 OK",
  "10:21:07.115020 IP 10.0.0.5.52144 > 10.0.0.9.80: Flags [F.], seq 79, ack 311, win 501, length 0",
  "10:21:07.115240 IP 10.0.0.9.80 > 10.0.0.5.52144: Flags [F.], seq 311, ack 80, win 509, length 0",
  "10:21:07.115251 IP 10.0.0.5.52144 > 10.0.0.9.80: Flags [.], ack 312, win 501, length 0",
];
export const PCAP_ANSWER = { client: "10.0.0.5", server: "10.0.0.9" };

function sedI(c: Ctx, a: string[]) {
  const { m, out } = c;
  const inplace = a.some((x) => /^-[a-z]*i/.test(x));
  const expr = plain(a)[0];
  const file = plain(a)[1];
  const mm = expr?.match(/^s(.)(.*?)\1(.*?)\1([gI]*)$/);
  if (!mm || !file) { out.push("sed: -e expression #1: unsupported here (use: sed -i 's/old/new/' file)"); return; }
  const p = abs(m, file);
  if (!(p in m.fs)) { out.push(`sed: can't read ${file}: No such file or directory`); return; }
  let re: RegExp;
  try { re = new RegExp(mm[2], mm[4].replace("I", "i").includes("g") ? "g" : ""); } catch { out.push("sed: invalid regular expression"); return; }
  const result = m.fs[p].split("\n").map((l) => l.replace(re, mm[3].replace(/\\\//g, "/"))).join("\n");
  if (inplace) { if (protectedPath(p) && !c.root) { out.push(`sed: couldn't open temporary file: Permission denied`); return; } m.fs[p] = result; }
  else out.push(result.replace(/\n$/, ""));
}

function lsCmd(c: Ctx, a: string[]) {
  const { m, out } = c;
  const long = flagsOf(a).join("").includes("l");
  const target = abs(m, plain(a)[0] ?? ".");
  const names = new Set<string>();
  if (target in m.fs) { out.push(plain(a)[0]); return; }
  if (!isDir(m, target)) { out.push(`ls: cannot access '${plain(a)[0]}': No such file or directory`); return; }
  const prefix = target === "/" ? "/" : target + "/";
  for (const f of [...Object.keys(m.fs), ...m.dirs]) if (f.startsWith(prefix) && f !== target) names.add(f.slice(prefix.length).split("/")[0]);
  const list = [...names].filter((n) => flagsOf(a).join("").includes("a") || !n.startsWith(".")).sort();
  if (long) { out.push(`total ${list.length * 4}`); for (const n of list) { const full = prefix + n; const dir = !(full in m.fs); out.push(`${dir ? "drwxr-xr-x" : "-rw-r--r--"} 1 ${protectedPath(full) ? "root root" : "student student"} ${dir ? 4096 : m.fs[full].length} Oct 20 10:00 ${n}`); } }
  else if (list.length) out.push(list.join("  "));
}

const HELP_TEXT = [
  "This is a simulated Ubuntu server. Commands that work here:",
  "  files      ls cat echo printf tee sed -i grep head wc cp mkdir touch rm cd pwd nano vi",
  "  network    ip addr|route|link  ifconfig  ping  traceroute  tracepath  ss -tulnp  netstat -tulnp  curl -I  hostname  getent hosts",
  "  config     netplan apply  systemctl start|stop|restart|status|enable <ssh|apache2|isc-dhcp-server|networking>  sysctl  resolvectl status",
  "  packages   apt install <apache2|isc-dhcp-server|tcpdump|...>",
  "  security   ufw  iptables  ssh-keygen  ssh-copy-id  ssh  sshd -t  dhcpd -t",
  "  diagnose   tcpdump  lsof -i  ps aux  kill",
  "  sudo       prefix a command with sudo (or run sudo -i). Redirects (>) happen as you, so use: echo text | sudo tee file",
  "  answer     answer <value...> for questions that ask you to report something",
];

// Execute one simple command (no pipes). Returns false for "not a command we know".
function runCommand(c: Ctx, tokens: string[]): void {
  const { m, out } = c;
  const t = tokens;
  if (!t.length) return;
  if (t[0] === "sudo") {
    const rest = t.slice(1).filter((x) => !(x === "-E" || x === "-H"));
    if (!rest.length) { out.push("usage: sudo command"); return; }
    if (rest[0] === "-i" || rest[0] === "-s" || (rest[0] === "su" && !rest[1])) { m.user = "root"; m.cwd = "/root"; if (!m.dirs.includes("/root")) m.dirs.push("/root"); return; }
    const inner: Ctx = { ...c, root: true };
    runCommand(inner, rest);
    if (inner.edit) c.edit = inner.edit; // the copy is what the command saw
    return;
  }
  const [cmd, ...a] = t;
  const root = c.root || m.user === "root";
  const cx: Ctx = { ...c, root };
  switch (cmd) {
    case "help": case "?": out.push(...HELP_TEXT); return;
    case "su": if (a[0] === "-" || !a[0] || a[0] === "root") { out.push("Password: (accepted in this lab)"); m.user = "root"; m.cwd = "/root"; } else out.push(`su: user ${a[0]} does not exist`); return;
    case "exit": case "logout": if (m.user === "root") { m.user = "student"; m.cwd = HOME; } else out.push("(this is the only session; use the Reset button to start over)"); return;
    case "whoami": out.push(m.user); return;
    case "id": out.push(m.user === "root" ? "uid=0(root) gid=0(root) groups=0(root)" : "uid=1000(student) gid=1000(student) groups=1000(student),27(sudo)"); return;
    case "pwd": out.push(m.cwd); return;
    case "hostname": if (a[0] === "-I") out.push(ownIps(m).filter((x) => !x.startsWith("127.")).join(" ")); else out.push(m.hostname); return;
    case "uname": out.push(a[0] === "-a" ? `Linux ${m.hostname} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux` : "Linux"); return;
    case "clear": c.out.length = 0; out.push("\u0000CLEAR"); return;
    case "cd": { const p = abs(m, a[0] ?? "~"); if (isDir(m, p)) m.cwd = p; else out.push(`bash: cd: ${a[0]}: No such file or directory`); return; }
    case "ls": lsCmd(cx, a); return;
    case "touch": for (const f of plain(a)) { const p = abs(m, f); if (protectedPath(p) && !root) out.push(`touch: cannot touch '${f}': Permission denied`); else m.fs[p] ??= ""; } return;
    case "mkdir": for (const f of plain(a)) { const p = abs(m, f); if (protectedPath(p) && !root) out.push(`mkdir: cannot create directory '${f}': Permission denied`); else if (isDir(m, p) && !a.includes("-p")) out.push(`mkdir: cannot create directory '${f}': File exists`); else if (!a.includes("-p") && !isDir(m, p.slice(0, p.lastIndexOf("/")) || "/")) out.push(`mkdir: cannot create directory '${f}': No such file or directory (use -p)`); else addDir(m, p); } return;
    case "rm": for (const f of plain(a)) { const p = abs(m, f); if (protectedPath(p) && !root) out.push(`rm: cannot remove '${f}': Permission denied`); else if (p in m.fs) delete m.fs[p]; else if (!a.some((x) => x.includes("f"))) out.push(`rm: cannot remove '${f}': No such file or directory`); } return;
    case "cp": { const [src, dst] = plain(a); const sp = abs(m, src ?? ""), dp = abs(m, dst ?? ""); if (!(sp in m.fs)) { out.push(`cp: cannot stat '${src}': No such file or directory`); return; } const target = isDir(m, dp) ? `${dp}/${sp.split("/").pop()}` : dp; if (protectedPath(target) && !root) out.push(`cp: cannot create regular file '${dst}': Permission denied`); else m.fs[target] = m.fs[sp]; return; }
    case "cat": {
      if (!plain(a).length) { out.push(...(c.stdin ?? "").replace(/\n$/, "").split("\n")); return; }
      for (const f of plain(a)) { const p = abs(m, f); if (p === PCAP_PATH) out.push("cat: capture.pcap: binary file (use: tcpdump -nn -r capture.pcap)"); else if (p in m.fs) out.push(m.fs[p].replace(/\n$/, "")); else out.push(`cat: ${f}: ${isDir(m, p) ? "Is a directory" : "No such file or directory"}`); }
      return;
    }
    case "echo": { let txt = a.filter((x) => x !== "-n" && x !== "-e").join(" "); if (a.includes("-e")) txt = txt.replace(/\\n/g, "\n").replace(/\\t/g, "\t"); out.push(txt); return; }
    case "printf": { const fmt = (a[0] ?? "").replace(/\\n/g, "\n").replace(/\\t/g, "\t"); let i = 1; out.push(fmt.replace(/%s/g, () => a[i++] ?? "").replace(/\n$/, "")); return; }
    case "tee": { const append = a.includes("-a"); for (const f of plain(a)) { writeFile({ ...cx, out }, abs(m, f), (c.stdin ?? "").replace(/\n?$/, "\n"), append); } out.push(...(c.stdin ?? "").replace(/\n$/, "").split("\n")); return; }
    case "grep": {
      const flags = flagsOf(a).join(""); const [pat, ...files] = plain(a);
      const text = c.stdin ?? ""; const label = files.length > 1;
      const lines: string[] = [];
      let re: RegExp; try { re = new RegExp(pat ?? "", flags.includes("i") ? "i" : ""); } catch { out.push("grep: invalid regular expression"); return; }
      const scan = (name: string | null, body: string) => body.split("\n").forEach((l, i) => { if (re.test(l) !== flags.includes("v") && (l || body.length)) lines.push(`${label && name ? name + ":" : ""}${flags.includes("n") ? i + 1 + ":" : ""}${l}`); });
      if (files.length) for (const f of files) { const p = abs(m, f); if (p in m.fs) scan(f, m.fs[p].replace(/\n$/, "")); else out.push(`grep: ${f}: No such file or directory`); } else scan(null, text.replace(/\n$/, ""));
      out.push(...lines); return;
    }
    case "head": { const n = a.includes("-n") ? Number(a[a.indexOf("-n") + 1]) : 10; const f = plain(a).filter((x) => x !== String(n)).pop(); const body = f ? m.fs[abs(m, f)] ?? "" : c.stdin ?? ""; out.push(...body.replace(/\n$/, "").split("\n").slice(0, n)); return; }
    case "wc": { const body = plain(a)[0] ? m.fs[abs(m, plain(a)[0])] ?? "" : c.stdin ?? ""; const n = body ? body.replace(/\n$/, "").split("\n").length : 0; out.push(a.includes("-l") ? String(n) : `${n} ${body.split(/\s+/).filter(Boolean).length} ${body.length}`); return; }
    case "sed": sedI(cx, a); return;
    case "nano": case "vi": case "vim": case "gedit": {
      const f = plain(a)[0]; if (!f) { out.push(`${cmd}: give a file name, e.g. ${cmd} /etc/hosts`); return; }
      const p = abs(m, f);
      if (isDir(m, p)) { out.push(`${cmd}: ${f} is a directory`); return; }
      const parent = p.slice(0, p.lastIndexOf("/")) || "/";
      if (!isDir(m, parent)) { out.push(`${cmd}: ${parent}: No such directory`); return; }
      c.edit = { path: p, content: m.fs[p] ?? "", readonly: protectedPath(p) && !root };
      return;
    }
    case "apt": case "apt-get": {
      if (a[0] === "update" || a[0] === "upgrade") { if (!root) out.push("E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied). Use sudo."); else out.push("Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease", "Reading package lists... Done"); return; }
      if (a[0] === "install") { if (!root) { out.push("E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)", "E: Unable to acquire the dpkg frontend lock, are you root? (use sudo)"); return; } for (const p of plain(a.slice(1))) out.push(...install(m, p)); return; }
      out.push(`E: Invalid operation ${a[0] ?? ""}`); return;
    }
    case "dpkg": if (a[0] === "-l") { out.push("Name  Version  Description", ...m.installed.map((p) => `ii  ${p}  1.0  ${p}`)); } return;
    case "sh": case "bash": {
      if (a[0] === "-c" && a[1]) { const r = execLine(m, a[1], root); out.push(...r.out); if (r.edit) c.edit = r.edit; } else out.push(`${cmd}: use ${cmd} -c '<commands>' in this lab`);
      return;
    }
    case "which": for (const f of plain(a)) out.push(`/usr/bin/${f}`); return;
    case "ip": ipCmd(cx, a); return;
    case "ifconfig": if (!m.installed.includes("net-tools")) { out.push("Command 'ifconfig' not found, but can be installed with: sudo apt install net-tools"); return; } if (a.includes("up") || a.includes("down")) { if (needRoot(cx, "SIOCSIFFLAGS: Operation not permitted")) return; const i = iface(m, a[0]); if (i) i.up = a.includes("up"); return; } out.push(...ifconfig(m, plain(a)[0])); return;
    case "ping": ping(cx, a); return;
    case "traceroute": if (!m.installed.includes("traceroute")) { out.push("Command 'traceroute' not found, but can be installed with: sudo apt install traceroute (or use tracepath)"); return; } traceroute(cx, a, "traceroute"); return;
    case "tracepath": traceroute(cx, a, "tracepath"); return;
    case "ss": out.push(...listeningTable(m, "ss", a)); return;
    case "netstat": if (!m.installed.includes("net-tools")) { out.push("Command 'netstat' not found, but can be installed with: sudo apt install net-tools (or use ss)"); return; } out.push(...listeningTable(m, "netstat", a)); return;
    case "lsof": { const port = a.join(" ").match(/:(\d+)/)?.[1]; event(m, "lsof"); if (!root) { out.push("(lsof only shows other users' processes when run with sudo)"); }
      out.push("COMMAND  PID     USER   FD   TYPE DEVICE NODE NAME"); for (const l of listeners(m).filter((x) => !port || x.port === Number(port))) out.push(`${l.name.padEnd(8)} ${String(l.pid).padEnd(7)} ${(m.procs.find((p) => p.pid === l.pid)?.user ?? "root").padEnd(6)} 3u  IPv4  ${l.pid}    0t0  ${l.proto.toUpperCase()} *:${l.port} ${l.proto === "tcp" ? "(LISTEN)" : ""}`); return; }
    case "ps": {
      out.push("USER         PID %CPU %MEM COMMAND");
      out.push("root         812  0.0  0.1 /usr/sbin/sshd -D", "root         521  0.0  0.1 /lib/systemd/systemd-resolved");
      if (m.svc.apache2?.active) out.push("root        1450  0.0  0.2 /usr/sbin/apache2 -k start");
      for (const p of m.procs) out.push(`${p.user.padEnd(12)} ${String(p.pid).padStart(4)}  0.1  0.5 ${p.cmd}`);
      return;
    }
    case "kill": {
      const pids = plain(a).map(Number).filter(Boolean);
      if (!pids.length) { out.push("kill: usage: kill [-9] pid"); return; }
      for (const pid of pids) {
        const p = m.procs.find((x) => x.pid === pid);
        if (!p) { out.push(`bash: kill: (${pid}) - No such process`); continue; }
        if (p.user !== "student" && !root) { out.push(`bash: kill: (${pid}) - Operation not permitted`); continue; }
        m.procs = m.procs.filter((x) => x.pid !== pid); event(m, `killed:${pid}`);
      }
      return;
    }
    case "curl": {
      const url = plain(a).find((x) => x.includes("://") || /^[\w.-]+(:\d+)?(\/|$)/.test(x));
      const um = url?.match(/^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/);
      if (!um) { out.push("curl: try 'curl -I http://localhost:8080'"); return; }
      const host = um[1], port = Number(um[2] ?? (url!.startsWith("https") ? 443 : 80));
      const ip = resolve(m, host);
      if (!ip) { out.push(`curl: (6) Could not resolve host: ${host}`); return; }
      if (ownIps(m).includes(ip) || ip.startsWith("127.")) {
        const head = httpHead(m, port);
        if (head.length === 1) { out.push(head[0]); return; }
        event(m, `curl:${port}:${head[0].split(" ")[1]}`);
        out.push(...(a.includes("-I") ? head : [head[0].includes("200") ? "<h1>It works</h1>" : head[0]]));
        return;
      }
      out.push(reach(m, ip) ? `HTTP/1.1 200 OK (remote ${ip})` : `curl: (7) Failed to connect to ${host} port ${port}: Network is unreachable`); return;
    }
    case "getent": { if (a[0] !== "hosts" || !a[1]) { out.push("Usage: getent hosts <name>"); return; } const ip = resolve(m, a[1]); if (ip) out.push(`${ip.padEnd(15)} ${a[1]}`); return; }
    case "nslookup": case "host": case "dig": { const h = plain(a)[0]; if (!h) { out.push(`usage: ${cmd} <name>`); return; } const ip = resolve(m, h); out.push(ip ? `Name:    ${h}` : `** server can't find ${h}: NXDOMAIN`, ...(ip ? [`Address: ${ip}`] : [])); return; }
    case "resolvectl": case "systemd-resolve": out.push("Global", `  DNS Servers: ${m.dns.join(" ") || "(none)"}`); return;
    case "netplan": {
      if (a[0] !== "apply" && a[0] !== "try") { out.push("usage: netplan apply"); return; }
      if (needRoot(cx, "Permission denied: netplan apply must be run as root (use sudo)")) return;
      const files = Object.entries(m.fs).filter(([p]) => p.startsWith("/etc/netplan/") && p.endsWith(".yaml")).sort();
      const cfgs: NetCfg[] = [];
      for (const [p, text] of files) { const r = parseNetplan(text); if (r.error) { out.push(`${p}: ${r.error}`, "Error in network definition: see the message above."); return; } cfgs.push(...r.cfgs); }
      const unknown = cfgs.find((x) => !iface(m, x.name));
      if (unknown) out.push(`Warning: no interface named '${unknown.name}' here (this machine has: ${m.ifaces.filter((i) => i.name !== "lo").map((i) => i.name).join(", ")}).`);
      applyNet(m, cfgs); event(m, "netplan-apply"); return;
    }
    case "ifdown": case "ifup": { if (needRoot(cx, `${cmd}: must be root (use sudo)`)) return; const cfg = parseInterfaces(fileText(m, "/etc/network/interfaces")).find((x) => x.name === a[0]); const i = iface(m, a[0]); if (!i) { out.push(`${cmd}: unknown interface ${a[0]}`); return; } if (cmd === "ifdown") { i.addrs = []; m.routes = m.routes.filter((r) => r.dev !== i.name); } else if (cfg) { i.up = true; applyNet(m, [cfg]); } return; }
    case "systemctl": case "service": if (cmd === "service") { systemctl(cx, [a[1], a[0]]); return; } systemctl(cx, a); return;
    case "sysctl": {
      const setting = a.find((x) => x.includes("=")); const key = (setting ?? plain(a)[0] ?? "").split("=")[0];
      if (a.includes("-p")) { if (needRoot(cx, "sysctl: permission denied on key (use sudo)")) return; const m2 = fileText(m, "/etc/sysctl.conf").match(/^\s*net\.ipv4\.ip_forward\s*=\s*(\d)/m); if (m2) { m.fs["/proc/sys/net/ipv4/ip_forward"] = m2[1] + "\n"; out.push(`net.ipv4.ip_forward = ${m2[1]}`); } return; }
      if (setting && a.includes("-w")) { if (needRoot(cx, `sysctl: permission denied on key '${key}'`)) return; if (key !== "net.ipv4.ip_forward") { out.push(`sysctl: cannot stat /proc/sys/${key.replace(/\./g, "/")}: No such file or directory`); return; } m.fs["/proc/sys/net/ipv4/ip_forward"] = setting.split("=")[1] + "\n"; out.push(setting.replace("=", " = ")); return; }
      if (key === "net.ipv4.ip_forward") out.push(`net.ipv4.ip_forward = ${(m.fs["/proc/sys/net/ipv4/ip_forward"] ?? "0").trim()}`); else out.push(`sysctl: cannot stat /proc/sys/${key.replace(/\./g, "/")}: No such file or directory`);
      return;
    }
    case "ufw": ufwRun(cx, a); return;
    case "iptables": case "iptables-save": if (cmd === "iptables-save") { iptablesRun(cx, ["-S"]); return; } iptablesRun(cx, a); return;
    case "sshd": if (a[0] === "-t") { const r = sshPorts(m); out.push(...(r.error ? [r.error] : [])); } else out.push("usage: sshd -t"); return;
    case "dhcpd": if (a[0] === "-t") { const p = dhcpProblem(m); out.push(p ?? "Internet Systems Consortium DHCP Server 4.4.3\nConfig file OK (no errors found)"); } return;
    case "apachectl": case "apache2ctl": if (a[0] === "configtest") out.push(m.installed.includes("apache2") ? "Syntax OK" : `${cmd}: command not found`); else if (a[0] === "-S" || a[0] === "-t") out.push("Syntax OK"); return;
    case "ssh-keygen": {
      const f = a.includes("-f") ? a[a.indexOf("-f") + 1] : "~/.ssh/id_rsa";
      const type = a.includes("-t") ? a[a.indexOf("-t") + 1] : "rsa";
      const key = abs(m, f);
      if (key in m.fs && !a.includes("-y")) { out.push(`${f} already exists.`, "Overwrite (y/n)? n"); return; }
      addDir(m, key.slice(0, key.lastIndexOf("/")));
      m.fs[key] = `-----BEGIN OPENSSH PRIVATE KEY-----\n${btoa(key).repeat(3)}\n-----END OPENSSH PRIVATE KEY-----\n`;
      m.fs[key + ".pub"] = `ssh-${type} AAAAB3NzaC1${btoa(key).slice(0, 24)} student@${m.hostname}\n`;
      event(m, "ssh-keygen");
      out.push(`Generating public/private ${type} key pair.`, "(passphrase prompts are skipped in this lab: an empty passphrase is used)", `Your identification has been saved in ${f}`, `Your public key has been saved in ${f}.pub`, "The key fingerprint is:", `SHA256:${btoa(key).slice(0, 43)} student@${m.hostname}`);
      return;
    }
    case "ssh-copy-id": case "ssh": {
      const ssh = m.world.ssh;
      const portArg = a.includes("-p") ? Number(a[a.indexOf("-p") + 1]) : 22;
      const target = plain(a).filter((x) => x !== String(portArg) && !x.startsWith("-")).find((x) => /@|^\d+\.\d+\.\d+\.\d+$|^[\w.-]+$/.test(x) && x !== "ssh");
      const dest = target?.includes("@") ? target.split("@")[1] : target;
      const user = target?.includes("@") ? target.split("@")[0] : "student";
      if (!dest) { out.push(cmd === "ssh" ? "usage: ssh [-p port] user@host" : "usage: ssh-copy-id [-p port] user@host"); return; }
      const ip = resolve(m, dest);
      if (!ip) { out.push(`ssh: Could not resolve hostname ${dest}: Name or service not known`); return; }
      if (!reach(m, ip)) { out.push(`ssh: connect to host ${dest} port ${portArg}: ${route(m, ip).reason.includes("unreachable") && route(m, ip).reason.includes("Network") ? "Network is unreachable" : "No route to host"}`); return; }
      if (!ssh || ip !== ssh.ip) { out.push(`ssh: connect to host ${dest} port ${portArg}: Connection refused`); return; }
      if (portArg !== ssh.port) { out.push(`ssh: connect to host ${dest} port ${portArg}: Connection refused`); return; }
      if (user !== ssh.user) { out.push(`${user}@${dest}: Permission denied (publickey,password).`); return; }
      if (cmd === "ssh-copy-id") {
        const pub = Object.keys(m.fs).find((p) => p.startsWith(`${HOME}/.ssh/`) && p.endsWith(".pub"));
        if (!pub) { out.push("/usr/bin/ssh-copy-id: ERROR: No identities found (run ssh-keygen first)"); return; }
        m.keyAuthorized = true; event(m, "ssh-copy-id");
        out.push(`/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "${pub}"`, `(password prompt skipped in this lab)`, `Number of key(s) added: 1`, "", `Now try logging into the machine, with: "ssh -p ${ssh.port} '${user}@${dest}'"`);
        return;
      }
      if (!m.keyAuthorized) { out.push(`${user}@${dest}'s password: ` , "Permission denied, please try again. (this lab cannot type passwords: copy your key with ssh-copy-id first)"); return; }
      const remoteCmd = plain(a).slice(plain(a).indexOf(target!) + 1).join(" ");
      event(m, "ssh-login");
      if (remoteCmd) out.push(remoteCmd === "hostname" ? ssh.host : `(ran '${remoteCmd}' on ${ssh.host})`);
      else out.push(`Welcome to Ubuntu 24.04 LTS (${ssh.host})`, `${user}@${ssh.host}:~$ (logged in without a password: this proves the key works; the session ends here)`);
      return;
    }
    case "tcpdump": {
      if (!m.installed.includes("tcpdump")) { out.push("Command 'tcpdump' not found, but can be installed with: sudo apt install tcpdump"); return; }
      if (needRoot(cx, "tcpdump: Permission denied: you don't have permission to perform this capture (use sudo)")) return;
      const ri = a.indexOf("-r");
      if (ri >= 0) {
        const f = abs(m, a[ri + 1] ?? "");
        if (f !== PCAP_PATH) { out.push(`tcpdump: ${a[ri + 1] ?? ""}: No such file or directory`); return; }
        event(m, "pcap"); out.push(`reading from file ${a[ri + 1]}, link-type EN10MB (Ethernet)`, ...PCAP); return;
      }
      const n = a.includes("-c") ? Number(a[a.indexOf("-c") + 1]) : 0;
      const dev = a.includes("-i") ? a[a.indexOf("-i") + 1] : null;
      if (!dev) { out.push("tcpdump: no interface chosen: use -i any (or -i enp0s3)"); return; }
      if (dev !== "any" && !iface(m, dev)) { out.push(`tcpdump: ${dev}: No such device exists`); return; }
      const filter = plain(a).filter((x) => x !== dev && x !== String(n) && !x.startsWith("-") ).join(" ");
      const me = primary(m).addrs[0] ? addrOf(primary(m).addrs[0]) : "0.0.0.0";
      out.push(`tcpdump: data link type LINUX_SLL2`, `listening on ${dev}, link-type EN10MB (Ethernet), snapshot length 262144 bytes`);
      const pk = TCPDUMP_FLAGS(filter, me, c);
      const take = n > 0 ? Math.min(n, 10) : 10;
      out.push(...pk.slice(0, take).map((l) => (a.includes("-nn") || a.includes("-n") ? l : l)));
      out.push(`${take} packets captured`, `${take} packets received by filter`, "0 packets dropped by kernel");
      if (n === 10) event(m, "tcpdump10"); else event(m, "tcpdump");
      if (!n) out.push("(a real tcpdump keeps running until Ctrl-C; add -c 10 to stop after 10 packets)");
      return;
    }
    case "answer": {
      const vals = plain(a);
      if (vals.length >= 2 && vals[0] === PCAP_ANSWER.client && vals[1] === PCAP_ANSWER.server) { event(m, "answer-ok"); out.push("Correct: 10.0.0.5 is the client (it sends the SYN) and 10.0.0.9 is the server (it replies SYN-ACK)."); }
      else if (vals.length >= 2) out.push("Not quite. In a TCP handshake the client sends [S] (SYN); the server answers [S.] (SYN-ACK).");
      else out.push("usage: answer <client-ip> <server-ip>");
      return;
    }
    default:
      out.push(`${cmd}: command not found`);
  }
}

// Run a line (;, &&, pipes, > and >>). asRoot is true for `sudo sh -c '...'`; plain redirects still run as the logged-in user.
function execLine(m: Machine, line: string, asRoot: boolean): { out: string[]; cleared: boolean; edit?: RunResult["edit"] } {
  const out: string[] = [];
  let cleared = false;
  let edit: RunResult["edit"];
  const seq = splitTop(line, ["&&", ";"]);
  for (let si = 0; si < seq.parts.length; si++) {
    const seg = seq.parts[si].trim();
    if (!seg) continue;
    const stages = splitTop(seg, ["|"]).parts;
    let stdin: string | null = null;
    let segOut: string[] = [];
    let failed = false;
    for (let pi = 0; pi < stages.length; pi++) {
      let toks = tokenize(stages[pi]);
      let redirect: { op: string; file: string } | null = null;
      const ri = toks.findIndex((x) => x === ">" || x === ">>");
      if (ri >= 0) { redirect = { op: toks[ri], file: toks[ri + 1] ?? "" }; toks = toks.slice(0, ri).concat(toks.slice(ri + 2)); }
      const ctx: Ctx = { m, root: asRoot || m.user === "root", stdin, out: [] };
      runCommand(ctx, toks);
      if (ctx.edit) edit = ctx.edit;
      let produced = ctx.out;
      if (produced.includes("\u0000CLEAR")) { cleared = true; produced = []; }
      if (redirect) {
        const body = produced.join("\n") + (produced.length ? "\n" : "");
        if (!redirect.file) out.push("bash: syntax error near unexpected token `newline'");
        else { const w: Ctx = { m, root: asRoot || m.user === "root", stdin: null, out: [] }; const ok = writeFile(w, abs(m, redirect.file), body, redirect.op === ">>"); if (!ok) { produced = w.out; failed = true; } else produced = []; }
      }
      stdin = produced.join("\n") + (produced.length ? "\n" : "");
      segOut = produced;
      if (ctx.out.some((l) => /command not found|Permission denied|No such file|error|ERROR|Invalid|failed|not found/i.test(l))) failed = true;
    }
    out.push(...segOut);
    if (failed && seq.ops[si] === "&&") break;
  }
  return { out, cleared, edit };
}

export function runLine(prev: Machine, raw: string): RunResult {
  const m: Machine = structuredClone(prev);
  const promptText = promptOf(prev);
  const line = raw.trim();
  if (!line) { m.lines.push(promptText); return { m }; }
  const r = execLine(m, line, false);
  if (r.cleared) m.lines = []; else m.lines.push(`${promptText} ${raw}`, ...r.out);
  if (m.lines.length > 500) m.lines = m.lines.slice(-500);
  return { m, edit: r.edit };
}

export function promptOf(m: Machine): string {
  const dir = m.cwd === HOME ? "~" : m.cwd.startsWith(HOME + "/") ? "~" + m.cwd.slice(HOME.length) : m.cwd;
  return m.user === "root" ? `root@${m.hostname}:${dir === "~" ? "~" : dir}#` : `student@${m.hostname}:${dir}$`;
}

export function saveFile(prev: Machine, path: string, content: string): Machine {
  const m = structuredClone(prev);
  m.fs[path] = content.endsWith("\n") || !content ? content : content + "\n";
  addDir(m, path.slice(0, path.lastIndexOf("/")) || "/");
  return m;
}

export const forwardingOn = (m: Machine) => (m.fs["/proc/sys/net/ipv4/ip_forward"] ?? "0").trim() === "1";
export { reach, resolve, addrOf, iface, ownIps };
