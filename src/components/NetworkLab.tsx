"use client";

import { Cable, Calculator, Router, Server, type LucideIcon } from "lucide-react";
import { useState } from "react";
import CableLab from "./CableLab";
import LinuxLab from "./LinuxLab";
import SubnetCalc from "./SubnetCalc";
import TopologyLab from "./TopologyLab";
import { cn } from "./ui";

type Lab = "cable" | "subnet" | "topology" | "linux";
const LABS: { id: Lab; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "cable", label: "Crimping", hint: "Wire an RJ45 cable", icon: Cable },
  { id: "subnet", label: "Subnetting", hint: "Subnet calculator", icon: Calculator },
  { id: "topology", label: "Network lab", hint: "IPs, ping, router and switch CLI", icon: Router },
  { id: "linux", label: "Linux server", hint: "Static IP, DHCP, Apache, SSH, firewall, troubleshooting", icon: Server },
];

export default function NetworkLab() {
  const [lab, setLab] = useState<Lab>(() => {
    try { const v = localStorage.getItem("pg:netlab") as Lab | null; if (v && LABS.some((l) => l.id === v)) return v; } catch {}
    return "topology";
  });
  const pick = (l: Lab) => { setLab(l); try { localStorage.setItem("pg:netlab", l); } catch {} };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2" role="tablist" aria-label="Network labs">
        {LABS.map(({ id, label, hint, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={lab === id} onClick={() => pick(id)} title={hint}
            className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
              lab === id ? "border-sky-500 bg-sky-600/20 text-white" : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100 active:bg-zinc-800")}>
            <Icon size={14} aria-hidden />{label}
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-zinc-500 md:inline">Simulated in your browser: nothing here touches a real network.</span>
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", lab !== "topology" && lab !== "linux" && "overflow-y-auto")}>
        {lab === "cable" ? <CableLab /> : lab === "subnet" ? <SubnetCalc /> : lab === "linux" ? <LinuxLab /> : <TopologyLab />}
      </div>
    </main>
  );
}
