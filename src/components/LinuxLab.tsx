"use client";

import { Circle, CircleCheck, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EXERCISES, exerciseById, GROUPS, welcomeFor } from "@/lib/linuxlab";
import { promptOf, runLine, saveFile, type Machine, type RunResult } from "@/lib/linuxsim";
import CliConsole from "./CliConsole";
import { Button, cn } from "./ui";

type Edit = NonNullable<RunResult["edit"]>;

function freshMachine(id: string): Machine {
  const ex = exerciseById(id);
  const m = ex.make();
  m.lines = welcomeFor(ex);
  return m;
}

// A stand-in for nano/vi: edit the whole file in a textarea, then save.
function FileEditor({ edit, onSave, onClose }: { edit: Edit; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(edit.content);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !edit.readonly) { e.preventDefault(); onSave(text); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [text, edit.readonly, onSave, onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={`Edit ${edit.path}`}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <span className="truncate font-mono text-sm text-zinc-100">{edit.path}</span>
          {edit.readonly && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">read-only: reopen with sudo</span>}
          <div className="ml-auto flex gap-2">
            <Button icon={Save} variant="primary" size="sm" disabled={edit.readonly} onClick={() => onSave(text)} title="Save (Ctrl/⌘ + S)">Save</Button>
            <Button icon={X} size="sm" onClick={onClose} title="Close without saving (Esc)">Close</Button>
          </div>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={edit.readonly} spellCheck={false} autoFocus aria-label="File contents"
          className="h-[60vh] min-h-48 w-full resize-none bg-black/50 p-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none" />
        <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">YAML needs spaces, never tabs. Save, close, then run the command that applies the change (for example sudo netplan apply).</p>
      </div>
    </div>
  );
}

export default function LinuxLab() {
  const [exId, setExId] = useState(() => {
    try { const v = localStorage.getItem("pg:linuxex"); if (v && EXERCISES.some((e) => e.id === v)) return v; } catch {}
    return EXERCISES[0].id;
  });
  const [machine, setMachine] = useState<Machine>(() => freshMachine(exId));
  const [edit, setEdit] = useState<Edit | null>(null);
  const ex = exerciseById(exId);

  const checks = useMemo(() => ex.checks(machine), [ex, machine]);
  const done = checks.filter((c) => c.done).length;

  const pick = (id: string) => {
    setExId(id);
    setMachine(freshMachine(id));
    setEdit(null);
    try { localStorage.setItem("pg:linuxex", id); } catch {}
  };
  const run = (line: string) => {
    const r = runLine(machine, line);
    setMachine(r.m);
    if (r.edit) setEdit(r.edit);
  };
  const save = (text: string) => {
    if (!edit) return;
    const m = saveFile(machine, edit.path, text);
    m.lines = [...m.lines, `(saved ${edit.path})`];
    setMachine(m);
    setEdit(null);
  };

  return (
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:overflow-hidden">
      <div className="space-y-4 border-zinc-800 p-4 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-500">
            Exercise
            <select value={exId} onChange={(e) => pick(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-500 focus:border-sky-500">
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {EXERCISES.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <Button icon={RotateCcw} onClick={() => pick(exId)} className="self-end" title="Start this exercise again from a fresh server">Reset</Button>
        </div>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <h2 className="text-sm font-semibold text-zinc-200">{ex.title}</h2>
          <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">{ex.brief.map((p) => <p key={p}>{p}</p>)}</div>
        </section>

        <section aria-label="Checks" className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <h3 className="flex items-center text-sm font-semibold text-zinc-200">Checks<span className="ml-auto text-xs font-normal text-zinc-400">{done} / {checks.length}</span></h3>
          <ul className="mt-2 space-y-1.5">
            {checks.map((c) => (
              <li key={c.text} className={cn("flex items-start gap-2 text-xs", c.done ? "text-emerald-300" : "text-zinc-400")}>
                {c.done ? <CircleCheck size={14} className="mt-px shrink-0" aria-label="done" /> : <Circle size={14} className="mt-px shrink-0 text-zinc-600" aria-label="not done" />}{c.text}
              </li>
            ))}
          </ul>
          {done === checks.length && <p className="mt-2 text-xs font-medium text-emerald-300" role="status">All checks pass. Pick the next exercise.</p>}
        </section>

        <p className="text-xs text-zinc-500">A simulated Ubuntu server: files and services are kept in your browser and every exercise starts from a fresh machine. <code>nano</code>/<code>vi</code> open a simple editor. Type <code>help</code> for the commands that work. Real tests are timed, so try each one without the chips.</p>
      </div>

      <div className="flex min-h-[28rem] min-w-0 flex-col lg:min-h-0">
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-300">
          <span className="font-mono text-xs text-zinc-500">{machine.user === "root" ? "root" : "student"}@{machine.hostname}</span>
          <span className="ml-auto text-xs text-zinc-500">Ubuntu 24.04 (simulated)</span>
        </div>
        <CliConsole key={exId} id={`linux:${exId}`} lines={machine.lines} prompt={promptOf(machine)} hints={ex.hints} label="Server command line" onRun={run} />
      </div>
      {edit && <FileEditor key={edit.path + machine.lines.length} edit={edit} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  );
}
