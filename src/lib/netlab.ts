// A small network simulator for the Network tab: three PCs, a switch and a router on two LANs, with a Cisco-style CLI
// on the switch and router and a VPCS-style one on the PCs. Everything is pure state-in, state-out.
import { ipToString, maskToPrefix, parseIp, parseMask, prefixToMask, sameSubnet } from "./network";

export type DevId = "pcA" | "pcB" | "pcC" | "s1" | "r1";
export const DEVICES: { id: DevId; name: string; kind: "pc" | "switch" | "router" }[] = [
  { id: "pcA", name: "PC-A", kind: "pc" },
  { id: "pcB", name: "PC-B", kind: "pc" },
  { id: "pcC", name: "PC-C", kind: "pc" },
  { id: "s1", name: "S1", kind: "switch" },
  { id: "r1", name: "R1", kind: "router" },
];

export interface Pc { ip: number | null; mask: number | null; gw: number | null }
export interface Port { name: string; admin: boolean; desc: string; speed: string; duplex: string; ip: number | null; mask: number | null }
export interface Lab {
  pcA: Pc; pcB: Pc; pcC: Pc;
  s1: { hostname: string; ports: Port[] };
  r1: { hostname: string; ports: Port[] };
}
export type Mode = "user" | "priv" | "config" | "if";
export interface Session { mode: Mode; iface: string | null; lines: string[] }
export interface SimState { lab: Lab; sess: Record<DevId, Session> }

const port = (name: string, admin: boolean): Port => ({ name, admin, desc: "", speed: "auto", duplex: "auto", ip: null, mask: null });
const blankPc = (): Pc => ({ ip: null, mask: null, gw: null });

export function freshLab(): Lab {
  return {
    pcA: blankPc(), pcB: blankPc(), pcC: blankPc(),
    s1: { hostname: "Switch", ports: [port("FastEthernet0/1", true), port("FastEthernet0/2", true), port("FastEthernet0/3", true)] },
    r1: { hostname: "Router", ports: [port("GigabitEthernet0/0", false), port("GigabitEthernet0/1", false)] }, // routers boot with ports shut down
  };
}

const banner: Record<DevId, string> = {
  pcA: "PC-A  type 'help' for commands", pcB: "PC-B  type 'help' for commands", pcC: "PC-C  type 'help' for commands",
  s1: "Switch S1  ports Fa0/1 (PC-A), Fa0/2 (PC-B), Fa0/3 (to R1 Gi0/0)", r1: "Router R1  Gi0/0 (to S1 Fa0/3), Gi0/1 (to PC-C)",
};

export function freshState(lab: Lab = freshLab()): SimState {
  const sess = {} as Record<DevId, Session>;
  for (const d of DEVICES) sess[d.id] = { mode: d.kind === "pc" ? "priv" : "user", iface: null, lines: [banner[d.id]] };
  return { lab, sess };
}

// A broken network to troubleshoot: wrong mask, a shut port, a missing gateway, a down router port.
export function faultyLab(): Lab {
  const lab = freshLab();
  const n = (s: string) => parseIp(s)!;
  const m24 = prefixToMask(24);
  lab.pcA = { ip: n("192.168.10.10"), mask: m24, gw: n("192.168.10.1") };
  lab.pcB = { ip: n("192.168.10.11"), mask: prefixToMask(16), gw: n("192.168.10.1") }; // wrong mask
  lab.pcC = { ip: n("192.168.20.10"), mask: m24, gw: null }; // no default gateway
  lab.r1.ports[0] = { ...lab.r1.ports[0], admin: true, ip: n("192.168.10.1"), mask: m24 };
  lab.r1.ports[1] = { ...lab.r1.ports[1], admin: false, ip: n("192.168.20.1"), mask: m24 }; // forgotten "no shutdown"
  lab.s1.ports[1] = { ...lab.s1.ports[1], admin: false }; // PC-B's port shut down
  return lab;
}

// ---------- topology and connectivity ----------

type Node = { id: DevId; ip: number | null; mask: number | null; gw: number | null; iface?: Port };
const SEGMENT: Record<string, number> = { pcA: 0, pcB: 1, "r1:0": 2 }; // index of the S1 port each node is plugged into

const portUp = (p: Port) => p.admin;
const lanPorts = (lab: Lab) => lab.s1.ports;

// Can two nodes on LAN 1 exchange frames through the switch?
function lan1Linked(lab: Lab, a: string, b: string) {
  const pa = lanPorts(lab)[SEGMENT[a]], pb = lanPorts(lab)[SEGMENT[b]];
  const ra = a === "r1:0" ? lab.r1.ports[0] : null, rb = b === "r1:0" ? lab.r1.ports[0] : null;
  return portUp(pa) && portUp(pb) && (!ra || portUp(ra)) && (!rb || portUp(rb));
}

function nodes(lab: Lab): { key: string; node: Node }[] {
  const pc = (id: "pcA" | "pcB" | "pcC"): Node => ({ id, ...lab[id] });
  return [
    { key: "pcA", node: pc("pcA") }, { key: "pcB", node: pc("pcB") }, { key: "pcC", node: pc("pcC") },
    { key: "r1:0", node: { id: "r1", ip: lab.r1.ports[0].ip, mask: lab.r1.ports[0].mask, gw: null, iface: lab.r1.ports[0] } },
    { key: "r1:1", node: { id: "r1", ip: lab.r1.ports[1].ip, mask: lab.r1.ports[1].mask, gw: null, iface: lab.r1.ports[1] } },
  ];
}

// Are two attachment points on the same working Ethernet segment?
function linked(lab: Lab, a: string, b: string): boolean {
  if (a === b) return true;
  const lan1 = (k: string) => k === "pcA" || k === "pcB" || k === "r1:0";
  if (lan1(a) && lan1(b)) return lan1Linked(lab, a, b);
  if ((a === "pcC" && b === "r1:1") || (a === "r1:1" && b === "pcC")) return lab.r1.ports[1].admin;
  return false;
}

type Verdict = { ok: true } | { ok: false; unreachableFrom: string | null };
const timeout: Verdict = { ok: false, unreachableFrom: null };

// Router forwards a packet toward dst using its connected routes only.
function routerForward(lab: Lab, dst: number, arrivedOn: string): Verdict {
  const all = nodes(lab);
  const routerIfaces = all.filter((x) => x.key.startsWith("r1:") && x.node.ip !== null && x.node.mask !== null && x.node.iface!.admin);
  const own = routerIfaces.find((x) => x.node.ip === dst);
  if (own) return { ok: true };
  const out = routerIfaces.find((x) => sameSubnet(x.node.ip!, dst, x.node.mask!));
  const inIface = all.find((x) => x.key === arrivedOn)?.node.ip ?? null;
  if (!out) return { ok: false, unreachableFrom: inIface !== null ? ipToString(inIface) : null };
  const target = all.find((x) => !x.key.startsWith("r1:") && x.node.ip === dst);
  if (!target || !linked(lab, out.key, target.key)) return { ok: false, unreachableFrom: ipToString(out.node.ip!) };
  return { ok: true };
}

// Send one packet from a PC to dst, as the PC's own addressing sees it.
function pcSend(lab: Lab, from: "pcA" | "pcB" | "pcC", dst: number, depth = 0): Verdict {
  const me = lab[from];
  if (me.ip === null || me.mask === null || depth > 4) return timeout;
  if (dst === me.ip) return { ok: true };
  const all = nodes(lab);
  const onLink = sameSubnet(me.ip, dst, me.mask);
  const hop = onLink ? dst : me.gw;
  if (hop === null || !sameSubnet(me.ip, hop, me.mask)) return { ok: false, unreachableFrom: ipToString(me.ip) };
  const next = all.find((x) => x.node.ip === hop && x.key !== from);
  if (!next || !linked(lab, from, next.key)) return onLink ? { ok: false, unreachableFrom: ipToString(me.ip) } : timeout;
  if (next.node.id === "r1") {
    if (!next.node.iface!.admin) return timeout;
    if (hop === dst) return { ok: true };
    return routerForward(lab, dst, next.key);
  }
  return hop === dst ? { ok: true } : timeout; // an on-link PC that is not the target would have to forward
}

export type PingResult = { replies: boolean[]; unreachableFrom: string | null; srcIp: number | null };

export function pingFrom(lab: Lab, from: DevId, dst: number, count: number): PingResult {
  let srcIp: number | null = null;
  let there: Verdict = timeout;
  let back: Verdict = timeout;
  if (from === "pcA" || from === "pcB" || from === "pcC") {
    srcIp = lab[from].ip;
    there = pcSend(lab, from, dst);
    if (there.ok) {
      const target = nodes(lab).find((x) => x.node.ip === dst);
      if (!target) there = timeout;
      else if (target.node.id === "r1") back = { ok: true }; // the router answers from the interface that received the request
      else back = pcSend(lab, target.node.id as "pcA" | "pcB" | "pcC", srcIp!);
    }
  } else if (from === "r1") {
    const out = nodes(lab).find((x) => x.key.startsWith("r1:") && x.node.ip !== null && x.node.mask !== null && x.node.iface!.admin && sameSubnet(x.node.ip, dst, x.node.mask));
    const own = nodes(lab).find((x) => x.key.startsWith("r1:") && x.node.ip === dst && x.node.iface!.admin);
    if (own) { there = { ok: true }; back = { ok: true }; srcIp = own.node.ip; }
    else if (out) {
      srcIp = out.node.ip;
      const target = nodes(lab).find((x) => !x.key.startsWith("r1:") && x.node.ip === dst);
      if (target && linked(lab, out.key, target.key)) {
        there = { ok: true };
        back = pcSend(lab, target.node.id as "pcA" | "pcB" | "pcC", out.node.ip!);
      }
    }
  }
  const ok = there.ok && back.ok;
  const unreachableFrom = !there.ok ? there.unreachableFrom : null;
  return { replies: Array.from({ length: count }, () => ok), unreachableFrom: ok ? null : unreachableFrom, srcIp };
}

// ---------- CLI helpers ----------

const abbr = (tok: string | undefined, full: string, min = 1) => !!tok && tok.length >= min && full.startsWith(tok.toLowerCase());

// "gi0/0", "g0/0", "GigabitEthernet0/0" -> the matching port, or undefined.
function findPort(ports: Port[], text: string): Port | undefined {
  const m = text.toLowerCase().match(/^([a-z]+)\s*(\d+\/\d+)$/);
  if (!m) return undefined;
  return ports.find((p) => p.name.toLowerCase().startsWith(m[1]) && p.name.endsWith(m[2]) && p.name.toLowerCase().replace(/[\d/]+$/, "").startsWith(m[1]));
}
const shortName = (n: string) => n.replace("GigabitEthernet", "Gi").replace("FastEthernet", "Fa");

function ifaceStatus(lab: Lab, dev: "s1" | "r1", p: Port): { status: string; proto: string } {
  if (!p.admin) return { status: "administratively down", proto: "down" };
  if (dev === "r1" && p.name.endsWith("0/0") && !lab.s1.ports[2].admin) return { status: "down", proto: "down" };
  if (dev === "s1" && p.name.endsWith("0/3") && !lab.r1.ports[0].admin) return { status: "down", proto: "down" };
  return { status: "up", proto: "up" };
}

function runningConfig(lab: Lab, dev: "s1" | "r1") {
  const d = lab[dev];
  const lines = ["Building configuration...", "", `hostname ${d.hostname}`, "!"];
  for (const p of d.ports) {
    lines.push(`interface ${p.name}`);
    if (p.desc) lines.push(` description ${p.desc}`);
    if (dev === "r1") lines.push(p.ip !== null && p.mask !== null ? ` ip address ${ipToString(p.ip)} ${ipToString(p.mask)}` : " no ip address");
    if (p.speed !== "auto") lines.push(` speed ${p.speed}`);
    if (p.duplex !== "auto") lines.push(` duplex ${p.duplex}`);
    if (!p.admin) lines.push(" shutdown");
    lines.push("!");
  }
  lines.push("end");
  return lines;
}

const prompt = (lab: Lab, dev: DevId, s: Session) => {
  if (dev === "pcA" || dev === "pcB" || dev === "pcC") return `${DEVICES.find((d) => d.id === dev)!.name}>`;
  const host = lab[dev].hostname;
  return s.mode === "user" ? `${host}>` : s.mode === "priv" ? `${host}#` : s.mode === "config" ? `${host}(config)#` : `${host}(config-if)#`;
};
export const promptFor = (st: SimState, dev: DevId) => prompt(st.lab, dev, st.sess[dev]);

function pingText(lab: Lab, from: DevId, arg: string | undefined, cisco: boolean): string[] {
  const dst = arg ? parseIp(arg) : null;
  if (!arg) return [cisco ? "% Incomplete command." : "Usage: ping <ip address>"];
  if (dst === null) return [cisco ? `% Unrecognized host or address, or protocol not running.` : `Cannot resolve ${arg}`];
  if (!cisco && lab[from as "pcA"].ip === null) return ["Network is unreachable (this PC has no IP address; use: ip 192.168.10.10/24 192.168.10.1)"];
  const r = pingFrom(lab, from, dst, cisco ? 5 : 4);
  if (cisco) {
    const sym = r.replies.map((ok) => (ok ? "!" : r.unreachableFrom ? "U" : ".")).join("");
    const got = r.replies.filter(Boolean).length;
    return [`Type escape sequence to abort.`, `Sending ${r.replies.length}, 100-byte ICMP Echos to ${arg}, timeout is 2 seconds:`, sym, `Success rate is ${got * 100 / r.replies.length} percent (${got}/${r.replies.length})${got ? ", round-trip min/avg/max = 1/1/2 ms" : ""}`];
  }
  const lines = [`Pinging ${arg} with 32 bytes of data:`];
  const me = lab[from as "pcA"];
  const ttl = lab.r1.ports.some((p) => p.ip === dst) ? 255 : sameSubnet(me.ip!, dst, me.mask!) ? 128 : 127; // routers answer with 255, a routed PC reply loses one hop
  for (const ok of r.replies) {
    lines.push(ok ? `Reply from ${arg}: bytes=32 time<1ms TTL=${ttl}` : r.unreachableFrom ? `Reply from ${r.unreachableFrom}: Destination host unreachable.` : "Request timed out.");
  }
  const got = r.replies.filter(Boolean).length;
  lines.push("", `Ping statistics for ${arg}: Sent = ${r.replies.length}, Received = ${got}, Lost = ${r.replies.length - got} (${Math.round(((r.replies.length - got) * 100) / r.replies.length)}% loss)`);
  return lines;
}

const HELP: Record<string, string[]> = {
  pc: ["ip <addr>/<prefix> <gateway>   set the address, e.g. ip 192.168.10.10/24 192.168.10.1", "ip <addr> <mask> <gateway>   same, with a dotted mask", "ipconfig                     show the address settings", "ping <address>               test connectivity", "clear                        clear the screen"],
  user: ["enable                       enter privileged mode", "ping <address>", "show ip interface brief", "show interfaces status (switch)"],
  priv: ["configure terminal           enter configuration mode", "show ip interface brief", "show running-config", "show ip route (router)", "show interfaces status (switch)", "ping <address>", "copy running-config startup-config", "disable"],
  config: ["hostname <name>", "interface <type><number>   e.g. interface g0/0 or interface fa0/1", "end"],
  if: ["ip address <addr> <mask>   (router)", "no ip address", "description <text>", "shutdown / no shutdown", "speed <10|100|auto>   duplex <half|full|auto>   (switch)", "exit / end"],
};

// Run one line typed on a device and return the new state.
export function execute(prev: SimState, dev: DevId, raw: string): SimState {
  const st: SimState = structuredClone(prev);
  const s = st.sess[dev];
  const lab = st.lab;
  const echo = `${prompt(prev.lab, dev, prev.sess[dev])} ${raw}`;
  const out: string[] = [];
  const line = raw.trim();
  const t = line.split(/\s+/);
  const w = t[0]?.toLowerCase();

  const finish = (): SimState => { s.lines.push(echo, ...out); if (s.lines.length > 400) s.lines = s.lines.slice(-400); return st; };
  if (!line) { out.length = 0; return finish(); }

  // ----- PCs -----
  if (dev === "pcA" || dev === "pcB" || dev === "pcC") {
    const pc = lab[dev];
    if (w === "clear" || w === "cls") { s.lines = []; return st; }
    if (w === "help" || w === "?") out.push(...HELP.pc);
    else if (w === "ipconfig") {
      out.push(pc.ip === null ? "No IP address configured. Use: ip 192.168.10.10/24 192.168.10.1" : [
        `IPv4 Address . . . . . : ${ipToString(pc.ip)}`, `Subnet Mask  . . . . . : ${ipToString(pc.mask!)}`, `Default Gateway  . . . : ${pc.gw === null ? "(none)" : ipToString(pc.gw)}`].join("\n"));
    } else if (w === "ping") out.push(...pingText(lab, dev, t[1], false));
    else if (w === "ip") {
      const slash = t[1]?.match(/^([\d.]+)\/(\d{1,2})$/);
      const addr = slash ? parseIp(slash[1]) : parseIp(t[1] ?? "");
      const mask = slash ? parseMask(slash[2]) : parseMask(t[2] ?? "");
      const gwText = slash ? t[2] : t[3];
      const gw = gwText ? parseIp(gwText) : null;
      if (addr === null || mask === null) out.push("Invalid address or mask. Example: ip 192.168.10.10/24 192.168.10.1");
      else if (gwText && gw === null) out.push(`Invalid gateway: ${gwText}`);
      else {
        const info = (addr & mask) >>> 0;
        if (addr === info || addr === ((info | ~mask) >>> 0)) out.push("That is the network or broadcast address of the subnet; pick a host address.");
        else { lab[dev] = { ip: addr, mask, gw }; out.push(`${DEVICES.find((d) => d.id === dev)!.name} set to ${ipToString(addr)} ${ipToString(mask)} (/${maskToPrefix(mask)}), gateway ${gw === null ? "none" : ipToString(gw)}`); }
      }
    } else out.push(`Unknown command: ${w}. Type 'help'.`);
    return finish();
  }

  // ----- switch / router -----
  const isRouter = dev === "r1";
  const device = lab[dev];
  const ports = device.ports;
  const invalid = () => out.push("% Invalid input detected.");

  if (w === "?" || (w === "help")) { out.push(...HELP[s.mode]); return finish(); }
  if (t[0] === "do" && s.mode !== "user" && s.mode !== "priv") { // "do show ..." from config modes
    const inner = execute({ ...st, sess: { ...st.sess, [dev]: { ...s, mode: "priv" as Mode } } }, dev, t.slice(1).join(" "));
    out.push(...inner.sess[dev].lines.slice(s.lines.length + 1)); // skip the echo of the inner command
    return finish();
  }

  if (s.mode === "user" || s.mode === "priv") {
    if (abbr(w, "enable", 2) && s.mode === "user") s.mode = "priv";
    else if (abbr(w, "disable", 4) && s.mode === "priv") s.mode = "user";
    else if (abbr(w, "configure", 4) && s.mode === "priv") {
      if (t[1] && abbr(t[1], "terminal")) { s.mode = "config"; out.push("Enter configuration commands, one per line.  End with 'end'."); }
      else out.push("% Incomplete command. (configure terminal)");
    } else if (abbr(w, "ping", 2)) out.push(...pingText(lab, dev, t[1], true));
    else if (abbr(w, "show", 2)) {
      if (abbr(t[1], "ip") && abbr(t[2], "interface") && abbr(t[3], "brief")) {
        out.push("Interface              IP-Address      OK? Method Status                Protocol");
        for (const p of ports) {
          const { status, proto } = ifaceStatus(lab, dev, p);
          out.push(`${p.name.padEnd(22)} ${(p.ip !== null ? ipToString(p.ip) : "unassigned").padEnd(15)} YES manual ${status.padEnd(21)} ${proto}`);
        }
      } else if (abbr(t[1], "running-config", 2) || abbr(t[1], "run", 3)) out.push(...runningConfig(lab, dev));
      else if (isRouter && abbr(t[1], "ip") && abbr(t[2], "route")) {
        out.push("Codes: C - connected, L - local", "");
        const up = ports.filter((p) => p.admin && p.ip !== null && p.mask !== null);
        if (!up.length) out.push("(no routes: bring an interface up with an IP address)");
        for (const p of up) {
          out.push(`C    ${ipToString((p.ip! & p.mask!) >>> 0)}/${maskToPrefix(p.mask!)} is directly connected, ${p.name}`);
          out.push(`L    ${ipToString(p.ip!)}/32 is directly connected, ${p.name}`);
        }
      } else if (!isRouter && abbr(t[1], "interfaces") && abbr(t[2], "status")) {
        out.push("Port      Name               Status       Vlan  Duplex  Speed");
        for (const p of ports) {
          const { status } = ifaceStatus(lab, dev, p);
          const connected = p.admin && status === "up";
          out.push(`${shortName(p.name).padEnd(9)} ${(p.desc || "").slice(0, 18).padEnd(18)} ${(!p.admin ? "disabled" : connected ? "connected" : "notconnect").padEnd(12)} 1     ${p.duplex === "auto" ? "a-full" : p.duplex}  ${p.speed === "auto" ? "a-100" : p.speed}`);
        }
      } else invalid();
    } else if ((abbr(w, "copy", 2) && abbr(t[1], "running-config", 3)) || abbr(w, "write", 2)) out.push("Destination filename [startup-config]", "Building configuration...", "[OK]");
    else invalid();
    return finish();
  }

  // configuration modes
  if (w === "end" || (w === "exit" && s.mode === "config")) { s.mode = "priv"; s.iface = null; return finish(); }
  if (w === "exit" && s.mode === "if") { s.mode = "config"; s.iface = null; return finish(); }

  if (s.mode === "config") {
    if (abbr(w, "hostname", 4)) {
      if (!t[1]) out.push("% Incomplete command."); else device.hostname = t[1];
    } else if (abbr(w, "interface", 3)) {
      const p = findPort(ports, t.slice(1).join(""));
      if (!t[1]) out.push("% Incomplete command.");
      else if (!p) out.push(`% Invalid interface. This ${isRouter ? "router has Gi0/0 and Gi0/1" : "switch has Fa0/1, Fa0/2 and Fa0/3"}.`);
      else { s.mode = "if"; s.iface = p.name; }
    } else invalid();
    return finish();
  }

  // interface mode
  const p = ports.find((x) => x.name === s.iface)!;
  const no = w === "no";
  const cmd = (no ? t[1] : w)?.toLowerCase();
  if (abbr(cmd, "shutdown", 4)) p.admin = no;
  else if (abbr(cmd, "ip", 2) && isRouter && abbr(no ? t[2] : t[1], "address", 2)) {
    if (no) { p.ip = null; p.mask = null; }
    else {
      const addr = parseIp(t[2] ?? ""), mask = parseMask(t[3] ?? "");
      if (!t[2]) out.push("% Incomplete command.");
      else if (addr === null) out.push("% Invalid input detected.");
      else if (!t[3]) out.push("% Incomplete command.");
      else if (mask === null) out.push("% Invalid input detected (bad subnet mask).");
      else if (addr === ((addr & mask) >>> 0) || addr === (((addr & mask) | ~mask) >>> 0)) out.push("Bad mask: that is the network or broadcast address of the subnet.");
      else {
        const clash = ports.find((q) => q !== p && q.ip !== null && q.mask !== null && sameSubnet(q.ip, addr, q.mask) && sameSubnet(q.ip, addr, mask));
        if (clash) out.push(`% ${ipToString(addr)} overlaps with ${clash.name}`);
        else { p.ip = addr; p.mask = mask; }
      }
    }
  } else if (abbr(w, "description", 4)) p.desc = no ? "" : t.slice(1).join(" ");
  else if (!isRouter && abbr(w, "speed", 3)) p.speed = no ? "auto" : (["10", "100", "auto"].includes(t[1]) ? t[1] : (out.push("% Invalid input detected."), p.speed));
  else if (!isRouter && abbr(w, "duplex", 3)) p.duplex = no ? "auto" : (["half", "full", "auto"].includes(t[1]) ? t[1] : (out.push("% Invalid input detected."), p.duplex));
  else invalid();
  return finish();
}

// ---------- goals ----------

export interface Goal { text: string; done: boolean }
export function goals(lab: Lab): Goal[] {
  const ip = (s: string) => parseIp(s)!;
  const inNet = (pc: Pc, net: string, gw: string) => pc.ip !== null && pc.mask !== null && sameSubnet(pc.ip, ip(net), prefixToMask(24)) && maskToPrefix(pc.mask) === 24 && pc.gw === ip(gw);
  const r = lab.r1.ports;
  const ping = (from: DevId, to: Pc) => to.ip !== null && pingFrom(lab, from, to.ip, 1).replies[0];
  return [
    { text: "PC-A and PC-B are in 192.168.10.0/24 with gateway 192.168.10.1", done: inNet(lab.pcA, "192.168.10.0", "192.168.10.1") && inNet(lab.pcB, "192.168.10.0", "192.168.10.1") },
    { text: "PC-C is in 192.168.20.0/24 with gateway 192.168.20.1", done: inNet(lab.pcC, "192.168.20.0", "192.168.20.1") },
    { text: "R1 Gi0/0 is 192.168.10.1/24 and Gi0/1 is 192.168.20.1/24, both up", done: r[0].admin && r[1].admin && r[0].ip === ip("192.168.10.1") && r[1].ip === ip("192.168.20.1") && r[0].mask !== null && maskToPrefix(r[0].mask) === 24 && r[1].mask !== null && maskToPrefix(r[1].mask) === 24 },
    { text: "PC-A can ping PC-B (same LAN, through the switch)", done: ping("pcA", lab.pcB) },
    { text: "PC-A can ping PC-C (across the router)", done: ping("pcA", lab.pcC) },
    { text: "PC-C can ping PC-B", done: ping("pcC", lab.pcB) },
  ];
}
