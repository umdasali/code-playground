// Pure networking helpers: IPv4 maths for the subnet calculator and the lab, plus Ethernet cable wiring data.

export function parseIp(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

export const ipToString = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

export const prefixToMask = (p: number) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);

// A valid mask is a run of ones followed by a run of zeros. Returns the prefix length or null.
export function maskToPrefix(mask: number): number | null {
  let p = 0;
  while (p < 32 && (mask >>> (31 - p)) & 1) p++;
  return prefixToMask(p) === mask >>> 0 ? p : null;
}

// Accepts "255.255.255.0", "/24" or "24".
export function parseMask(s: string): number | null {
  const t = s.trim();
  const prefix = t.match(/^\/?(\d{1,2})$/);
  if (prefix) { const p = Number(prefix[1]); return p <= 32 ? prefixToMask(p) : null; }
  const m = parseIp(t);
  return m !== null && maskToPrefix(m) !== null ? m : null;
}

export interface SubnetInfo {
  address: number;
  prefix: number;
  mask: number;
  wildcard: number;
  network: number;
  broadcast: number;
  firstHost: number | null;
  lastHost: number | null;
  hosts: number;
  ipClass: string;
  scope: string;
}

export function subnetInfo(address: number, prefix: number): SubnetInfo {
  const mask = prefixToMask(prefix);
  const network = (address & mask) >>> 0;
  const wildcard = ~mask >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const hosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : 2 ** (32 - prefix) - 2;
  const first = address >>> 24;
  const ipClass = first < 128 ? "A" : first < 192 ? "B" : first < 224 ? "C" : first < 240 ? "D (multicast)" : "E (reserved)";
  const o = [address >>> 24, (address >>> 16) & 255];
  const scope = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) ? "Private"
    : o[0] === 127 ? "Loopback" : o[0] === 169 && o[1] === 254 ? "Link-local (APIPA)" : "Public";
  return {
    address, prefix, mask, wildcard, network, broadcast, hosts, ipClass, scope,
    firstHost: prefix >= 31 ? (prefix === 31 ? network : null) : network + 1,
    lastHost: prefix >= 31 ? (prefix === 31 ? broadcast : null) : broadcast - 1,
  };
}

export const sameSubnet = (a: number, b: number, mask: number) => ((a ^ b) & mask) >>> 0 === 0;

export const binaryDotted = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].map((o) => o.toString(2).padStart(8, "0")).join(".");

// Split a network into equal subnets (count rounded up to a power of two).
export function splitSubnet(network: number, prefix: number, count: number): SubnetInfo[] | null {
  const extra = Math.ceil(Math.log2(Math.max(1, count)));
  if (prefix + extra > 30) return null;
  const newPrefix = prefix + extra;
  const size = 2 ** (32 - newPrefix);
  return Array.from({ length: 2 ** extra }, (_, i) => subnetInfo((network + i * size) >>> 0, newPrefix));
}

// ---------- Cable wiring ----------

export type WireColor = "white-orange" | "orange" | "white-green" | "blue" | "white-blue" | "green" | "white-brown" | "brown";

export const WIRE_LABEL: Record<WireColor, string> = {
  "white-orange": "White/Orange", orange: "Orange", "white-green": "White/Green", blue: "Blue",
  "white-blue": "White/Blue", green: "Green", "white-brown": "White/Brown", brown: "Brown",
};
// Solid colour, and the stripe colour (null for solid wires), for drawing a wire.
export const WIRE_STYLE: Record<WireColor, { base: string; stripe: string | null }> = {
  "white-orange": { base: "#f97316", stripe: "#f8fafc" }, orange: { base: "#f97316", stripe: null },
  "white-green": { base: "#22c55e", stripe: "#f8fafc" }, green: { base: "#22c55e", stripe: null },
  "white-blue": { base: "#3b82f6", stripe: "#f8fafc" }, blue: { base: "#3b82f6", stripe: null },
  "white-brown": { base: "#92400e", stripe: "#f8fafc" }, brown: { base: "#92400e", stripe: null },
};
export const ALL_COLORS = Object.keys(WIRE_LABEL) as WireColor[];

export const T568A: WireColor[] = ["white-green", "green", "white-orange", "blue", "white-blue", "orange", "white-brown", "brown"];
export const T568B: WireColor[] = ["white-orange", "orange", "white-green", "blue", "white-blue", "green", "white-brown", "brown"];

export type CableType = "straight" | "crossover";
export const CABLE_TYPES: Record<CableType, { label: string; use: string; endA: "T568A" | "T568B"; endB: "T568A" | "T568B" }> = {
  straight: { label: "Straight-through", use: "Different device types: PC to switch, switch to router, PC to router.", endA: "T568B", endB: "T568B" },
  crossover: { label: "Crossover", use: "Like devices: PC to PC, switch to switch, router to router (modern ports auto-detect, but exams ask).", endA: "T568A", endB: "T568B" },
};
export const STANDARDS = { T568A, T568B };

export interface TestResult {
  // For each pin on end A: which pin on end B carries the same wire (null if the colour is missing at B).
  links: (number | null)[];
  // Pins whose wire does not arrive where the cable type needs it.
  wrong: number[];
  duplicates: boolean;
  ok: boolean;
}

// What a cable tester shows: pin i on end A is connected to pin links[i] on end B.
export function testCable(type: CableType, endA: (WireColor | null)[], endB: (WireColor | null)[]): TestResult {
  const expected = (CABLE_TYPES[type].endA === CABLE_TYPES[type].endB)
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [2, 5, 0, 3, 4, 1, 6, 7]; // a crossover swaps pairs 1-2 and 3-6
  const links = endA.map((c) => (c ? endB.indexOf(c) : -1)).map((j) => (j < 0 ? null : j));
  const filled = [...endA, ...endB].every(Boolean);
  const duplicates = new Set(endA).size !== endA.length || new Set(endB).size !== endB.length;
  const wrong = links.map((j, i) => (j === expected[i] ? -1 : i)).filter((i) => i >= 0);
  return { links, wrong, duplicates, ok: filled && !duplicates && wrong.length === 0 };
}
