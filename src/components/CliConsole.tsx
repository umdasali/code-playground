"use client";

import { Lightbulb } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

// Typed commands per console, for the up/down arrows; it outlives the component, which is remounted when its key changes.
const history: Record<string, string[]> = {};

interface Props {
  id: string; // history is kept per id
  lines: string[];
  tick?: number; // bump to re-scroll when the lines array is mutated in place
  prompt: string;
  hints: string[];
  label: string;
  onRun: (line: string) => void;
}

// A terminal-like pane: scrollback, a prompt with an input, arrow-key history and one-click command chips.
export default function CliConsole({ id, lines, tick, prompt, hints, label, onRun }: Props) {
  const [input, setInput] = useState("");
  const cursor = useRef(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [lines.length, id, tick]);

  const submit = (text: string) => {
    if (text.trim()) history[id] = [...(history[id] ?? []), text];
    cursor.current = -1;
    onRun(text);
    setInput("");
    inputRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const h = history[id] ?? [];
    if (e.key === "Enter") submit(input);
    else if (e.key === "ArrowUp" && h.length) { e.preventDefault(); cursor.current = Math.min(h.length - 1, cursor.current + 1); setInput(h[h.length - 1 - cursor.current]); }
    else if (e.key === "ArrowDown") { e.preventDefault(); cursor.current = Math.max(-1, cursor.current - 1); setInput(cursor.current < 0 ? "" : h[h.length - 1 - cursor.current]); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onClick={() => inputRef.current?.focus()} className="min-h-0 flex-1 cursor-text overflow-y-auto bg-black/50 p-3 font-mono text-xs leading-relaxed text-zinc-200">
        {lines.map((l, i) => <pre key={i} className="whitespace-pre-wrap break-words">{l === "" ? "\u00a0" : l}</pre>)}
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-emerald-400">{prompt}</span>
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
            aria-label={label} className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
      </div>
      {hints.length > 0 && (
        <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto border-t border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <span className="mr-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><Lightbulb size={12} aria-hidden />Click to run</span>
          {hints.map((h, i) => (
            <button key={`${i}:${h}`} onClick={() => submit(h)} className="cursor-pointer rounded-md border border-zinc-800 px-2 py-0.5 text-left font-mono text-[11px] text-zinc-400 transition-colors hover:border-sky-600 hover:text-white active:bg-zinc-800">{h}</button>
          ))}
        </div>
      )}
    </div>
  );
}
