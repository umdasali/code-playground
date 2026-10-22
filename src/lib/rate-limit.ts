import "server-only";

const hits = new Map<string, number[]>();

// Fixed-window-ish limiter, per process. Swap for Redis/Upstash if you run several instances.
export function rateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return recent.length <= limit;
}

export function clientKey(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
