import { consumeQuota, linkPreviewQuota, quotaRefusal } from "../quota";

// The rate limit on the four `/api/og/**` routes (Mitchell, 2026-09-27): the
// Postgres counter `quota.ts` already keeps, not a new store — there is no
// Redis (ADR-052).
//
// **It sits behind the CDN.** The routes answer with `s-maxage`, so a repeat
// fetch of the same link is served by Vercel's edge and never runs the
// function, and so never reaches this counter. Only cache misses are charged.
// That is also why a refusal says `no-store`: a cached 429 would be served to
// every unfurler of that link, not just the one that tripped the limit.

/**
 * The caller's IP: the first hop of `x-forwarded-for`, which Vercel sets from
 * the connecting client (overwriting whatever the client sent), then
 * `x-real-ip`. Off Vercel both are client-supplied, which is fine for a limiter
 * whose job is bounding cost, not proving identity.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Charge this request to its IP. `null` means go ahead; otherwise the 429 (or
 * 503 when the counter itself is down, `consumeQuota`'s fail-closed rule) to
 * return, marked uncacheable.
 */
export async function limitLinkPreview(request: Request): Promise<Response | null> {
  const decision = await consumeQuota(linkPreviewQuota(), clientIp(request));
  if (decision.allowed) return null;
  const refusal = quotaRefusal(decision);
  refusal.headers.set("Cache-Control", "no-store");
  return refusal;
}
