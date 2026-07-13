const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  request: Request,
  scope: string,
  limit = 30,
  windowMs = 60_000,
) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const key = `${scope}:${forwarded || "local"}`;
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit)
    throw new Response("Rate limit exceeded", {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)),
      },
    });
}
