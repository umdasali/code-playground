"use client";

import Editor from "@monaco-editor/react";
import { Braces, Eraser, FileCode2, Globe, Palette, Play, RotateCcw, Terminal as TerminalIcon, type LucideIcon } from "lucide-react";
import { Button, cn } from "./ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { handlePreviewRequest } from "@/lib/laravel";

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

const EDITORS: { part: Part; label: string; lang: string; icon: LucideIcon }[] = [
  { part: "html", label: "HTML", lang: "html", icon: FileCode2 },
  { part: "css", label: "CSS", lang: "css", icon: Palette },
  { part: "js", label: "JavaScript", lang: "javascript", icon: Braces },
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

// Runs inside the iframe: fetch() and XMLHttpRequest calls to /api/... (or localhost:8000) are answered by the Laravel tab's app.
const apiBridge = (run: number) => `<script>(function(){
  var RUN=${run}, seq=0, pending={};
  var ABS=/^(https?:)?\\/\\/(localhost:8000|127\\.0\\.0\\.1:8000|laravel\\.test|app\\.test)(\\/|$)/i;
  function isApi(u){ u=String(u); return (u.charAt(0)==="/"&&u.charAt(1)!=="/")||/^api\\//.test(u)||ABS.test(u); }
  function call(method,url,headers,body){
    return new Promise(function(resolve){ var id=++seq; pending[id]=resolve;
      parent.postMessage({pg:true,type:"api",run:RUN,id:id,method:method,url:String(url),headers:headers,body:body},"*"); });
  }
  window.addEventListener("message",function(e){ var m=e.data; if(m&&m.pgApi&&pending[m.id]){ var r=pending[m.id]; delete pending[m.id]; r(m); } });
  var nativeFetch=window.fetch;
  window.fetch=function(input,init){
    var url=typeof input==="string"?input:(input&&input.url)||String(input);
    if(!isApi(url)) return nativeFetch.apply(this,arguments);
    init=init||{};
    var method=String(init.method||(input&&input.method)||"GET").toUpperCase();
    var headers={}, h=init.headers||(input&&input.headers);
    if(h){ if(Array.isArray(h)) h.forEach(function(p){headers[p[0]]=p[1];}); else if(h.forEach) h.forEach(function(v,k){headers[k]=v;}); else for(var k in h) headers[k]=h[k]; }
    var body=init.body;
    if(body!=null&&typeof body!=="string"){
      if(window.FormData&&body instanceof FormData){ var o={}; body.forEach(function(v,k){o[k]=v;}); body=JSON.stringify(o); if(!headers["Content-Type"]) headers["Content-Type"]="application/json"; }
      else body=String(body);
    }
    return call(method,url,headers,body).then(function(m){
      var empty=m.status===204||m.status===205||m.status===304;
      return new Response(empty?null:m.body,{status:m.status,headers:m.headers});
    });
  };
  var Native=window.XMLHttpRequest;
  function XHR(){
    var real=new Native(), self=this, api=false, method="GET", url="", headers={}, resHeaders={}, listeners={};
    self.readyState=0; self.status=0; self.statusText=""; self.responseText=""; self.response=""; self.responseType=""; self.timeout=0; self.withCredentials=false;
    self.UNSENT=0; self.OPENED=1; self.HEADERS_RECEIVED=2; self.LOADING=3; self.DONE=4;
    function fire(type){ var f=self["on"+type]; var ev={type:type,target:self}; if(typeof f==="function") f.call(self,ev); (listeners[type]||[]).forEach(function(l){ l.call(self,ev); }); }
    self.addEventListener=function(t,f){ (listeners[t]=listeners[t]||[]).push(f); };
    self.removeEventListener=function(t,f){ listeners[t]=(listeners[t]||[]).filter(function(x){return x!==f;}); };
    self.open=function(m,u){ method=m; url=u; if(isApi(u)){ api=true; self.readyState=1; fire("readystatechange"); } else real.open.apply(real,arguments); };
    self.setRequestHeader=function(k,v){ if(api) headers[k]=v; else real.setRequestHeader(k,v); };
    self.getResponseHeader=function(k){ return api?(resHeaders[String(k).toLowerCase()]||null):real.getResponseHeader(k); };
    self.getAllResponseHeaders=function(){ return api?Object.keys(resHeaders).map(function(k){return k+": "+resHeaders[k];}).join("\\r\\n"):real.getAllResponseHeaders(); };
    self.overrideMimeType=function(){}; self.abort=function(){ if(!api) real.abort(); };
    self.send=function(body){
      if(!api){
        real.responseType=self.responseType; real.timeout=self.timeout; real.withCredentials=self.withCredentials;
        ["readystatechange","load","error","abort","timeout","loadend","progress"].forEach(function(t){ real["on"+t]=function(){
          self.readyState=real.readyState; self.status=real.status; self.statusText=real.statusText;
          try{ self.responseText=real.responseText; }catch(e){} self.response=real.response; fire(t); }; });
        real.send(body); return;
      }
      call(method,url,headers,body).then(function(m){
        resHeaders={}; for(var k in m.headers) resHeaders[k.toLowerCase()]=m.headers[k];
        self.status=m.status; self.statusText=m.status===200?"OK":""; self.responseText=m.body; self.readyState=4;
        self.response=self.responseType==="json"?(function(){try{return JSON.parse(m.body);}catch(e){return null;}})():m.body;
        fire("readystatechange"); fire("load"); fire("loadend");
      });
    };
  }
  window.XMLHttpRequest=XHR;
})();<\/script>`;

function buildDoc(code: Record<Part, string>, run: number) {
  const js = code.js.replaceAll("</script", "<\\/script");
  const css = code.css.replaceAll("</style", "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${bridge(run)}${apiBridge(run)}${code.html}<script>${js}<\/script></body></html>`;
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
      if (m.type === "api") {
        // a fetch()/XHR from the page to /api/...: the Laravel tab's PHP app answers it
        const target = e.source as Window;
        const label = `${String(m.method).toUpperCase()} ${m.url}`;
        const note = (level: Level, text: string) => setLines((l) => [...l.slice(-199), { level, text }]);
        void handlePreviewRequest({ method: m.method, url: m.url, headers: m.headers, body: m.body }, (s) => note("info", s))
          .then((r) => {
            note(r.status < 400 ? "info" : "warn", `${label} → ${r.status} (${r.ms} ms)`);
            target.postMessage({ pgApi: true, id: m.id, status: r.status, headers: r.headers, body: r.body }, "*");
          })
          .catch((err: Error) => {
            note("error", `${label} failed: ${err.message}`);
            target.postMessage({ pgApi: true, id: m.id, status: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: err.message }) }, "*");
          });
        return;
      }
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
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-200">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-sky-500" /> Live preview
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button icon={RotateCcw} onClick={reset} iconOnlyOnSmall title="Restore the starter code">Reset</Button>
          <Button variant="primary" icon={Play} onClick={run} title="Re-run the preview">Run</Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
        <div className="flex h-[22rem] min-h-0 flex-col border-b border-zinc-800 lg:h-auto lg:border-b-0 lg:border-r">
          <div role="tablist" className="no-scrollbar flex overflow-x-auto border-b border-zinc-800 bg-zinc-900/60">
            {EDITORS.map((ed) => {
              const Icon = ed.icon;
              return (
                <button key={ed.part} role="tab" aria-selected={active === ed.part} onClick={() => setActive(ed.part)}
                  className={cn("group flex cursor-pointer items-center gap-1.5 border-b-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors active:bg-zinc-800",
                    active === ed.part ? "border-sky-500 text-white" : "border-transparent text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-100")}>
                  <Icon size={13} className={active === ed.part ? "text-sky-400" : "text-zinc-500 group-hover:text-zinc-300"} aria-hidden />{ed.label}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1">
            <Editor height="100%" theme="vs-dark" language={activeEd.lang} path={`web-${active}`} value={code[active]}
              onChange={(v) => edit(active, v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }} />
          </div>
        </div>
        <div className="flex h-[32rem] min-h-0 flex-col lg:h-auto">
          <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400"><Globe size={13} aria-hidden />Preview</div>
          <iframe ref={frame} title="Preview" srcDoc={doc.html} sandbox="allow-scripts allow-modals allow-forms" className="min-h-0 flex-[2] bg-white" />
          <div className="flex items-center gap-1.5 border-y border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <TerminalIcon size={13} aria-hidden />Console
            <Button size="sm" className="ml-auto" icon={Eraser} onClick={() => setLines([])} iconOnlyOnSmall title="Clear the console">Clear</Button>
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
