import { clientKey, rateLimit } from "@/lib/rate-limit";
import { resetSession, runSql, SAMPLE_SQL, SESSION_ID } from "@/lib/sql";

export async function POST(req: Request) {
  if (!rateLimit(`sql:${clientKey(req)}`, 60)) {
    return Response.json({ error: "Too many requests, slow down." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const { sessionId, action = "query", query } = body ?? {};
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return Response.json({ error: "Invalid session." }, { status: 400 });
  }
  try {
    if (action === "reset") {
      await resetSession(sessionId);
      return Response.json({ results: [] });
    }
    if (action === "seed") {
      await resetSession(sessionId);
      await runSql(sessionId, SAMPLE_SQL);
      return Response.json({ results: [] });
    }
    if (typeof query !== "string" || !query.trim() || query.length > 20_000) {
      return Response.json({ error: "Invalid query." }, { status: 400 });
    }
    return Response.json({ results: await runSql(sessionId, query) });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    const unreachable = e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT";
    return Response.json(
      { error: unreachable ? "Cannot reach MySQL. Start it with `docker compose up -d` and check .env.local." : (e.message ?? "Query failed.") },
      { status: unreachable ? 503 : 400 },
    );
  }
}
