import { RUN_LIMITS } from "@/lib/languages";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { runBash, runC } from "@/lib/runner";

export async function POST(req: Request) {
  if (!rateLimit(`run:${clientKey(req)}`)) {
    return Response.json({ error: "Too many runs, slow down." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const { lang, code, stdin = "" } = body ?? {};
  if (typeof code !== "string" || typeof stdin !== "string") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (code.length > RUN_LIMITS.code || stdin.length > RUN_LIMITS.stdin) {
    return Response.json({ error: "Input too large." }, { status: 413 });
  }

  switch (lang) {
    case "c":
    case "cpp":
      return Response.json(await runC(code, stdin, lang === "cpp"));
    case "bash":
      return Response.json(await runBash(code, stdin));
    default:
      return Response.json({ error: "Unsupported language." }, { status: 400 });
  }
}
