"use client";

import { Bug, CircleCheck, Circle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DEVICES, execute, faultyLab, freshState, goals, promptFor, type DevId, type Lab, type SimState } from "@/lib/netlab";
import { ipToString, maskToPrefix } from "@/lib/network";
import CliConsole from "./CliConsole";
import { Button, cn } from "./ui";

const HINTS: Record<DevId, string[]> = {
  pcA: ["ip 192.168.10.10/24 192.168.10.1", "ipconfig", "ping 192.168.10.11", "ping 192.168.20.10"],
  pcB: ["ip 192.168.10.11/24 192.168.10.1", "ipconfig", "ping 192.168.10.10"],
  pcC: ["ip 192.168.20.10/24 192.168.20.1", "ipconfig", "ping 192.168.10.10"],
  s1: ["enable", "configure terminal", "interface fa0/2", "shutdown", "no shutdown", "description PC-B", "end", "show interfaces status", "show ip interface brief"],
  r1: ["enable", "configure terminal", "interface g0/0", "ip address 192.168.10.1 255.255.255.0", "no shutdown", "exit", "interface g0/1", "ip address 192.168.20.1 255.255.255.0", "end", "show ip interface brief", "show ip route", "ping 192.168.20.10"],
};

const ipText = (ip: number | null, mask: number | null) => (ip === null ? "no IP" : `${ipToString(ip)}${mask !== null ? `/${maskToPrefix(mask)}` : ""}`);

function Diagram({ lab, selected, onSelect }: { lab: Lab; selected: DevId; onSelect: (d: DevId) => void }) {
  const [p1, p2, p3] = lab.s1.ports;
  const [g0, g1] = lab.r1.ports;
  const link = (up: boolean) => (up ? "#34d399" : "#f43f5e");
  const nodes: { id: DevId; x: number; y: number; label: string; sub: string; w?: number }[] = [
    { id: "pcA", x: 60, y: 40, label: "PC-A", sub: ipText(lab.pcA.ip, lab.pcA.mask) },
    { id: "pcB", x: 60, y: 160, label: "PC-B", sub: ipText(lab.pcB.ip, lab.pcB.mask) },
    { id: "s1", x: 250, y: 100, label: lab.s1.hostname, sub: "switch" },
    { id: "r1", x: 450, y: 100, label: lab.r1.hostname, sub: "router" },
    { id: "pcC", x: 640, y: 100, label: "PC-C", sub: ipText(lab.pcC.ip, lab.pcC.mask) },
  ];
  const at = (id: DevId) => nodes.find((n) => n.id === id)!;
  const lines: { from: DevId; to: DevId; up: boolean; a?: string; b?: string }[] = [
    { from: "pcA", to: "s1", up: p1.admin, b: "Fa0/1" },
    { from: "pcB", to: "s1", up: p2.admin, b: "Fa0/2" },
    { from: "s1", to: "r1", up: p3.admin && g0.admin, a: "Fa0/3", b: "Gi0/0" },
    { from: "r1", to: "pcC", up: g1.admin, a: "Gi0/1" },
  ];
  return (
    <svg viewBox="0 0 700 220" className="w-full" role="img" aria-label="Network diagram: PC-A and PC-B connect to switch S1, S1 connects to router R1, R1 connects to PC-C">
      {lines.map((l, i) => {
        const a = at(l.from), b = at(l.to);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={link(l.up)} strokeWidth={2.5} strokeDasharray={l.up ? undefined : "5 4"} />
            <text x={mx} y={my - 6} textAnchor="middle" fontSize="10" fill="#a1a1aa">{[l.a, l.b].filter(Boolean).join(" · ")}</text>
          </g>
        );
      })}
      {nodes.map((n) => {
        const on = selected === n.id;
        return (
          <g key={n.id} onClick={() => onSelect(n.id)} className="cursor-pointer" role="button" tabIndex={0} aria-label={`Open ${n.label}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(n.id); }}>
            <rect x={n.x - 52} y={n.y - 24} width={104} height={48} rx={8} fill={on ? "#0c4a6e" : "#18181b"} stroke={on ? "#38bdf8" : "#52525b"} strokeWidth={on ? 2 : 1} />
            <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize="13" fontWeight="600" fill="#f4f4f5">{n.label}</text>
            <text x={n.x} y={n.y + 13} textAnchor="middle" fontSize="10" fill="#a1a1aa">{n.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function TopologyLab() {
  const [state, setState] = useState<SimState>(() => freshState());
  const [dev, setDev] = useState<DevId>("pcA");
  const [scenario, setScenario] = useState<"build" | "fix">("build");

  const run = (line: string) => setState((s) => execute(s, dev, line));
  const reset = (kind: "build" | "fix") => { setScenario(kind); setState(freshState(kind === "fix" ? faultyLab() : undefined)); };
  const list = goals(state.lab);
  const done = list.filter((g) => g.done).length;

  return (
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:overflow-hidden">
      <div className="space-y-4 border-zinc-800 p-4 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-zinc-200">{scenario === "fix" ? "Troubleshoot the network" : "Build the network"}</h2>
          <Button icon={Bug} onClick={() => reset("fix")} title="Start from a network with four faults">Broken network</Button>
          <Button icon={RotateCcw} onClick={() => reset("build")} title="Start from blank devices">Reset</Button>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2"><Diagram lab={state.lab} selected={dev} onSelect={setDev} /></div>
        <p className="text-xs text-zinc-500">Green links are up, dashed red links are down. Click a device (or a tab) to open its command line. Addressing plan: LAN 1 is 192.168.10.0/24 (gateway R1 .1), LAN 2 is 192.168.20.0/24 (gateway R1 .1).</p>

        <section aria-label="Goals" className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <h3 className="flex items-center text-sm font-semibold text-zinc-200">Goals<span className="ml-auto text-xs font-normal text-zinc-400">{done} / {list.length}</span></h3>
          <ul className="mt-2 space-y-1.5">
            {list.map((g) => (
              <li key={g.text} className={cn("flex items-start gap-2 text-xs", g.done ? "text-emerald-300" : "text-zinc-400")}>
                {g.done ? <CircleCheck size={14} className="mt-px shrink-0" aria-label="done" /> : <Circle size={14} className="mt-px shrink-0 text-zinc-600" aria-label="not done" />}{g.text}
              </li>
            ))}
          </ul>
          {done === list.length && <p className="mt-2 text-xs font-medium text-emerald-300" role="status">Everything works. Try shutting a switch port and see which goals break.</p>}
          {scenario === "fix" && done < list.length && <p className="mt-2 text-xs text-zinc-500">Faults: look at <code>ipconfig</code> on each PC, <code>show interfaces status</code> on S1 and <code>show ip interface brief</code> on R1. Use <code>ping</code> to find where it stops.</p>}
        </section>
      </div>

      <div className="flex min-h-[26rem] min-w-0 flex-col lg:min-h-0">
        <div className="no-scrollbar flex overflow-x-auto border-b border-zinc-800 bg-zinc-900/40" role="tablist" aria-label="Devices">
          {DEVICES.map((d) => (
            <button key={d.id} role="tab" aria-selected={dev === d.id} onClick={() => setDev(d.id)}
              className={cn("shrink-0 cursor-pointer border-b-2 px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70",
                dev === d.id ? "border-sky-500 text-white" : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 active:bg-zinc-800")}>
              {d.id === "s1" ? state.lab.s1.hostname : d.id === "r1" ? state.lab.r1.hostname : d.name}
            </button>
          ))}
        </div>
        <CliConsole key={dev} id={dev} lines={state.sess[dev].lines} prompt={promptFor(state, dev)} hints={HINTS[dev]} label={`${DEVICES.find((d) => d.id === dev)!.name} command line`} onRun={run} />
      </div>
    </div>
  );
}
