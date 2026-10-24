"use client";

import { useMemo, useState } from "react";
import { binaryDotted, ipToString, maskToPrefix, parseIp, parseMask, splitSubnet, subnetInfo, type SubnetInfo } from "@/lib/network";
import { cn } from "./ui";

const EXAMPLES = ["192.168.10.77/26", "10.0.5.130 255.255.252.0", "172.16.0.1/20", "192.168.1.1/30"];

// "192.168.1.5/24", "192.168.1.5 255.255.255.0" or "192.168.1.5 /24".
function parseInput(text: string): { address: number; prefix: number } | string {
  const parts = text.trim().split(/[\s/]+/).filter(Boolean);
  if (parts.length !== 2) return "Enter an address and a mask, e.g. 192.168.10.77/26 or 192.168.10.77 255.255.255.192";
  const address = parseIp(parts[0]);
  if (address === null) return `"${parts[0]}" is not an IPv4 address (four numbers from 0 to 255).`;
  const mask = parseMask(parts[1]);
  if (mask === null) return `"${parts[1]}" is not a valid mask. Use a prefix (/26) or a mask whose 1-bits come first (255.255.255.192).`;
  return { address, prefix: maskToPrefix(mask)! };
}

function Bits({ value, prefix }: { value: number; prefix: number }) {
  const text = binaryDotted(value);
  let seen = 0;
  return (
    <span className="font-mono">
      {[...text].map((ch, i) => {
        if (ch === ".") return <span key={i} className="text-zinc-600">.</span>;
        const net = seen++ < prefix;
        return <span key={i} className={net ? "text-sky-400" : "text-amber-300"}>{ch}</span>;
      })}
    </span>
  );
}

export default function SubnetCalc() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [parts, setParts] = useState(4);
  const [hostsNeeded, setHostsNeeded] = useState(50);

  const parsed = useMemo(() => parseInput(text), [text]);
  const info: SubnetInfo | null = typeof parsed === "string" ? null : subnetInfo(parsed.address, parsed.prefix);
  const split = info ? splitSubnet(info.network, info.prefix, parts) : null;

  const needPrefix = (() => {
    for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hostsNeeded) return p;
    return null;
  })();

  const rows: [string, string, string?][] = info ? [
    ["Address", ipToString(info.address)],
    ["Subnet mask", `${ipToString(info.mask)}  (/${info.prefix})`],
    ["Wildcard mask", ipToString(info.wildcard)],
    ["Network address", ipToString(info.network)],
    ["Broadcast address", ipToString(info.broadcast)],
    ["First usable host", info.firstHost === null ? "none" : ipToString(info.firstHost)],
    ["Last usable host", info.lastHost === null ? "none" : ipToString(info.lastHost)],
    ["Usable hosts", info.hosts.toLocaleString(), info.prefix >= 31 ? "point-to-point or single host" : "2^(32-prefix) - 2"],
    ["Class / scope", `${info.ipClass}, ${info.scope}`],
  ] : [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4">
      <section>
        <h2 className="text-sm font-semibold text-zinc-200">Subnet calculator</h2>
        <p className="mt-1 text-xs text-zinc-500">The network address is the address AND the mask; the broadcast address sets every host bit to 1. The first and last addresses of a subnet are not usable by hosts.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Address and mask" aria-invalid={info === null}
            className={cn("h-9 w-full max-w-sm rounded-md border bg-zinc-900 px-3 font-mono text-sm outline-none transition-colors focus:border-sky-500", info ? "border-zinc-700" : "border-rose-700")} />
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setText(ex)} className="cursor-pointer rounded-md border border-zinc-800 px-2 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 active:bg-zinc-800">{ex}</button>
          ))}
        </div>
        {typeof parsed === "string" && <p className="mt-2 text-xs text-rose-400" role="alert">{parsed}</p>}
      </section>

      {info && (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <dl className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40 text-sm">
              {rows.map(([k, v, note]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <dt className="text-zinc-400">{k}</dt>
                  <dd className="text-right font-mono text-zinc-100">{v}{note && <span className="block font-sans text-[11px] text-zinc-500">{note}</span>}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
              <p className="font-semibold uppercase tracking-wide text-zinc-500">In binary <span className="ml-2 font-normal normal-case"><span className="text-sky-400">network bits</span> · <span className="text-amber-300">host bits</span></span></p>
              {([["Address", info.address], ["Mask", info.mask], ["Network", info.network], ["Broadcast", info.broadcast]] as const).map(([label, v]) => (
                <div key={label}><div className="text-zinc-500">{label}</div><Bits value={v} prefix={info.prefix} /></div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="text-sm font-semibold text-zinc-200">How big a subnet do I need?</h3>
            <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              I need
              <input type="number" min={1} max={2 ** 30} value={hostsNeeded} onChange={(e) => setHostsNeeded(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-zinc-100 outline-none focus:border-sky-500" />
              hosts, so use
              <span className="font-mono text-zinc-100">{needPrefix === null ? "no valid prefix" : `/${needPrefix} (${ipToString(subnetInfo(0, needPrefix).mask)}), ${(2 ** (32 - needPrefix) - 2).toLocaleString()} usable`}</span>
            </label>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="text-sm font-semibold text-zinc-200">Split {ipToString(info.network)}/{info.prefix} into equal subnets</h3>
            <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              at least
              <input type="number" min={1} max={64} value={parts} onChange={(e) => setParts(Math.min(64, Math.max(1, Number(e.target.value) || 1)))}
                className="h-8 w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-zinc-100 outline-none focus:border-sky-500" />
              subnets (rounded up to a power of two)
            </label>
            {split === null ? <p className="mt-2 text-xs text-amber-300">That does not fit: each subnet needs at least 2 usable hosts.</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left font-mono text-xs">
                  <thead className="text-zinc-500"><tr><th className="py-1 pr-3 font-medium">#</th><th className="pr-3 font-medium">Network</th><th className="pr-3 font-medium">First host</th><th className="pr-3 font-medium">Last host</th><th className="font-medium">Broadcast</th></tr></thead>
                  <tbody>
                    {split.map((s, i) => (
                      <tr key={s.network} className="border-t border-zinc-800 text-zinc-200">
                        <td className="py-1 pr-3 text-zinc-500">{i + 1}</td>
                        <td className="pr-3">{ipToString(s.network)}/{s.prefix}</td>
                        <td className="pr-3">{ipToString(s.firstHost!)}</td>
                        <td className="pr-3">{ipToString(s.lastHost!)}</td>
                        <td>{ipToString(s.broadcast)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
