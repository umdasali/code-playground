"use client";

import { Check, Eye, Shuffle, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ALL_COLORS, CABLE_TYPES, STANDARDS, T568A, T568B, testCable, WIRE_LABEL, WIRE_STYLE, type CableType, type WireColor } from "@/lib/network";
import { Button, cn } from "./ui";

const STEPS = [
  "Strip about 2.5 cm (1 inch) of the outer jacket without nicking the wires inside.",
  "Untwist the four pairs and straighten each wire.",
  "Arrange the eight wires side by side in the order of the standard (T568B for a straight-through cable).",
  "Trim the wires flat so about 1.2 cm (half an inch) sticks out beyond the jacket.",
  "Hold the plug with the clip facing down, push the wires in until every one touches the end, with the jacket reaching inside the plug.",
  "Crimp with the RJ45 tool, then test with a cable tester: all eight lights must pass in order (1 to 8).",
];

// A fixed scramble so the exercise starts from a mistake worth fixing.
const SCRAMBLED: WireColor[] = ["blue", "white-orange", "brown", "green", "white-green", "white-brown", "orange", "white-blue"];

export function Wire({ color, className }: { color: WireColor | null; className?: string }) {
  if (!color) return <span className={cn("inline-block h-5 w-5 rounded-sm border border-dashed border-zinc-600", className)} />;
  const { base, stripe } = WIRE_STYLE[color];
  return <span title={WIRE_LABEL[color]} className={cn("inline-block h-5 w-5 rounded-sm border border-black/40", className)}
    style={{ background: stripe ? `repeating-linear-gradient(135deg, ${stripe} 0 3px, ${base} 3px 6px)` : base }} />;
}

function End({ title, wires, onChange }: { title: string; wires: (WireColor | null)[]; onChange: (w: (WireColor | null)[]) => void }) {
  const set = (i: number, c: WireColor | null) => onChange(wires.map((w, k) => (k === i ? c : w)));
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-zinc-200">{title}</h3>
        {(["T568A", "T568B"] as const).map((s) => (
          <button key={s} onClick={() => onChange([...STANDARDS[s]])} className="cursor-pointer rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 active:bg-zinc-700">Load {s}</button>
        ))}
      </div>
      {/* the plug seen from the clip side, pin 1 on the left */}
      <div className="mt-3 flex gap-1 rounded-md bg-zinc-950 p-2" aria-hidden>
        {wires.map((w, i) => <div key={i} className="flex flex-1 flex-col items-center gap-1"><Wire color={w} className="h-10 w-full" /><span className="text-[10px] text-zinc-500">{i + 1}</span></div>)}
      </div>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {wires.map((w, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="w-8 text-zinc-500">Pin {i + 1}</span>
            <Wire color={w} />
            <select value={w ?? ""} onChange={(e) => set(i, (e.target.value || null) as WireColor | null)} aria-label={`${title} pin ${i + 1}`}
              className="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-zinc-200 outline-none transition-colors hover:border-zinc-500 focus:border-sky-500">
              <option value="">(empty)</option>
              {ALL_COLORS.map((c) => <option key={c} value={c}>{WIRE_LABEL[c]}</option>)}
            </select>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function CableLab() {
  const [type, setType] = useState<CableType>("straight");
  const [endA, setEndA] = useState<(WireColor | null)[]>(SCRAMBLED);
  const [endB, setEndB] = useState<(WireColor | null)[]>([...T568B]);
  const cable = CABLE_TYPES[type];
  const result = useMemo(() => testCable(type, endA, endB), [type, endA, endB]);

  const solve = () => { setEndA([...STANDARDS[cable.endA]]); setEndB([...STANDARDS[cable.endB]]); };
  const shuffle = () => setEndA([...ALL_COLORS].sort(() => Math.random() - 0.5));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <section>
        <h2 className="text-sm font-semibold text-zinc-200">Crimp an Ethernet cable</h2>
        <p className="mt-1 text-xs text-zinc-500">Wire both RJ45 plugs, then read the cable tester. A cable has to deliver every pin to the right pin on the far end.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cable type">
          {(Object.keys(CABLE_TYPES) as CableType[]).map((t) => (
            <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)}
              className={cn("cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors", type === t ? "border-sky-500 bg-sky-600/20 text-white" : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100")}>
              {CABLE_TYPES[t].label}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button icon={Shuffle} onClick={shuffle} title="Scramble end A">Scramble</Button>
            <Button icon={Eye} onClick={solve} title="Fill in the correct wiring for this cable type">Show answer</Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-400">Use: {cable.use} Wire end A as <b className="text-zinc-200">{cable.endA}</b> and end B as <b className="text-zinc-200">{cable.endB}</b>.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <End title="End A" wires={endA} onChange={setEndA} />
        <End title="End B" wires={endB} onChange={setEndB} />
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-live="polite">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Cable tester</h3>
          <span className={cn("ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", result.ok ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
            {result.ok ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}{result.ok ? "Pass: cable is good" : "Fail"}
          </span>
        </div>
        <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {result.links.map((to, i) => {
            const bad = result.wrong.includes(i) || endA[i] === null;
            return (
              <li key={i} className={cn("flex items-center gap-2 rounded-md border px-2 py-1 font-mono text-xs", bad ? "border-rose-900/70 bg-rose-950/30 text-rose-300" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-300")}>
                <span className={cn("h-2 w-2 rounded-full", bad ? "bg-rose-500" : "bg-emerald-400")} aria-hidden />
                {i + 1} → {to === null ? "open" : to + 1}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-zinc-400">
          {result.ok ? "Every wire arrives where this cable type needs it." :
            result.duplicates ? "The same colour is used twice on one plug. Each plug needs all eight different wires." :
            endA.includes(null) || endB.includes(null) ? "Some pins are empty. Fill all eight pins on both plugs." :
            `Pin${result.wrong.length > 1 ? "s" : ""} ${result.wrong.map((p) => p + 1).join(", ")} on end A ${result.wrong.length > 1 ? "do" : "does"} not reach the right pin on end B. ${type === "straight" ? "A straight-through cable needs pin n to arrive at pin n." : "A crossover swaps pins 1 and 3 and pins 2 and 6."}`}
        </p>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <h3 className="text-sm font-semibold text-zinc-200">Step by step</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-zinc-400">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="mt-3 text-xs text-zinc-500">Pins 1, 2, 3 and 6 carry the data in 10/100 Mbps Ethernet; gigabit uses all eight. T568A order: {T568A.map((c) => WIRE_LABEL[c]).join(", ")}. T568B order: {T568B.map((c) => WIRE_LABEL[c]).join(", ")}.</p>
      </section>
    </div>
  );
}
