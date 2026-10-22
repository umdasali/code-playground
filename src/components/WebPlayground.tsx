"use client";

import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";

type Part = "html" | "css" | "js";
type Level = "log" | "info" | "warn" | "error";
interface Line { level: Level; text: string }

const STARTERS: Record<Part, string> = {
  html: `<main>
  <h1>Hello, web!</h1>
  <p>Clicked <strong id="count">0</strong> times</p>
  <button id="btn">Click me</button>
</main>
`,
  css: `body {
  font-family: system-ui, sans-serif;
  display: grid;
  place-items: center;
  min-height: 100vh;
  margin: 0;
  background: #f4f4f5;
}
main { text-align: center; }
button {
  padding: 0.5rem 1.25rem;
  border: 0;
  border-radius: 999px;
  background: #0284c7;
  color: white;
  font-size: 1rem;
  cursor: pointer;
}
button:hover { background: #0369a1; }
`,
  js: `const btn = document.getElementById("btn");
const count = document.getElementById("count");
let n = 0;

btn.addEventListener("click", () => {
  n++;
  count.textContent = n;
  console.log("clicked", n);
});
`,
};

const EDITORS: { part: Part; label: string; lang: string }[] = [
  { part: "html", label: "HTML", lang: "html" },
  { part: "css", label: "CSS", lang: "css" },
  { part: "js", label: "JavaScript", lang: "javascript" },
];

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

// Runs inside the iframe: forwards console output and errors to the parent, tagged with this run's id.
const bridge = (run: number) => `<script>(function(){
  var RUN=${run};
  function fmt(v){
    if (typeof v==="string") return v;
    if (v instanceof Error) return v.stack||String(v);
    try { return JSON.stringify(v,null,2)===undefined?String(v):JSON.stringify(v,null,2); } catch(e){ return String(v); }
  }
  function send(level,args){ parent.postMessage({pg:true,run:RUN,level:level,text:Array.prototype.map.call(args,fmt).join(" ")},"*"); }
  ["log","info","warn","error"].forEach(function(l){
    var orig=console[l]; console[l]=function(){ send(l,arguments); orig.apply(console,arguments); };
  });
  window.addEventListener("error",function(e){ send("error",[e.message+(e.lineno?" (line "+e.lineno+")":"")]); });
  window.addEventListener("unhandledrejection",function(e){ send("error",["Unhandled promise rejection: "+fmt(e.reason)]); });
})();<\/script>`;

function buildDoc(code: Record<Part, string>, run: number) {
  const js = code.js.replaceAll("</script", "<\\/script");
  const css = code.css.replaceAll("</style", "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${bridge(run)}${code.html}<script>${js}<\/script></body></html>`;
}

export default function WebPlayground() {
  const [code, setCode] = useState<Record<Part, string>>(() => ({
    html: store.get("pg:web:html") ?? STARTERS.html,
    css: store.get("pg:web:css") ?? STARTERS.css,
    js: store.get("pg:web:js") ?? STARTERS.js,
  }));
  const [active, setActive] = useState<Part>("html");
  const [auto, setAuto] = useState(true);
  const [doc, setDoc] = useState<{ html: string; run: number }>({ html: "", run: 0 });
  const [lines, setLines] = useState<Line[]>([]);
  const runId = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const codeRef = useRef(code);
  useEffect(() => { codeRef.current = code; });

  const run = useCallback(() => {
    runId.current += 1;
    setLines([]);
    setDoc({ html: buildDoc(codeRef.current, runId.current), run: runId.current });
  }, []);

  // Debounced live preview; the timeout also covers the first render.
  useEffect(() => {
    if (!auto && runId.current > 0) return;
    const t = setTimeout(run, runId.current === 0 ? 0 : 600);
    return () => clearTimeout(t);
  }, [code, auto, run]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (e.source !== frame.current?.contentWindow || !m?.pg || m.run !== runId.current) return;
      setLines((l) => [...l.slice(-199), { level: m.level, text: String(m.text) }]);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const edit = (part: Part, v: string) => {
    setCode((c) => ({ ...c, [part]: v }));
    store.set(`pg:web:${part}`, v);
  };
  const reset = () => {
    for (const p of ["html", "css", "js"] as Part[]) store.set(`pg:web:${p}`, STARTERS[p]);
    setCode(STARTERS);
  };

  const activeEd = EDITORS.find((e) => e.part === active)!;
  const color: Record<Level, string> = { log: "text-zinc-200", info: "text-sky-300", warn: "text-amber-300", error: "text-rose-400" };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5 text-xs">
        <label className="flex items-center gap-1.5 text-zinc-400">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Live preview
        </label>
        <button onClick={run} className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500">Run ▶</button>
        <button onClick={reset} className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800">Reset code</button>
        <span className="ml-auto text-zinc-500">Runs in a sandboxed iframe</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="flex min-h-0 flex-col border-r border-zinc-800">
          <div className="flex border-b border-zinc-800 bg-zinc-900/60">
            {EDITORS.map((ed) => (
              <button key={ed.part} onClick={() => setActive(ed.part)}
                className={`border-b-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide ${active === ed.part ? "border-sky-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}>
                {ed.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <Editor height="100%" theme="vs-dark" language={activeEd.lang} path={`web-${active}`} value={code[active]}
              onChange={(v) => edit(active, v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Preview</div>
          <iframe ref={frame} title="Preview" srcDoc={doc.html} sandbox="allow-scripts allow-modals allow-forms" className="min-h-0 flex-[2] bg-white" />
          <div className="flex items-center border-y border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Console
            <button onClick={() => setLines([])} className="ml-auto rounded border border-zinc-700 px-2 py-0.5 normal-case tracking-normal hover:bg-zinc-800">Clear</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-black/40 p-2 font-mono text-xs">
            {lines.length === 0 && <span className="text-zinc-500">console.log output and errors appear here.</span>}
            {lines.map((l, i) => <pre key={i} className={`whitespace-pre-wrap border-b border-zinc-900 py-0.5 ${color[l.level]}`}>{l.text}</pre>)}
          </div>
        </div>
      </div>
    </div>
  );
}
