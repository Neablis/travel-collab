import { after } from "next/server";
import { consumeQuota, linkPreviewQuota, quotaRefusal, sweepExpiredCounters } from "../quota";

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
  if (Math.random() < SWEEP_PROBABILITY) scheduleSweep();
  const decision = await consumeQuota(linkPreviewQuota(), clientIp(request));
  if (decision.allowed) return null;
  const refusal = quotaRefusal(decision);
  refusal.headers.set("Cache-Control", "no-store");
  return refusal;
}

// **The sweep rides on this route, not on a cron.** Keyed by IP, every address
// that unfurls a link leaves a `rate_limit_counters` row, and `bump` never
// removes one; this is the only caller whose key space is unbounded, so it is
// the one that cleans up after itself. The deployment has no cron (vercel.json
// declares none), and adding one for a single DELETE would be a second
// mechanism with its own secret to forget.
//
// One request in a hundred is plenty: rows are one-minute windows, so a sweep
// that runs every few minutes of real traffic keeps the table near the number
// of IPs seen in that span. With no traffic there are no new rows to sweep.
const SWEEP_PROBABILITY = 0.01;

function scheduleSweep(): void {
  try {
    // After the response, and never able to fail it: a missed sweep leaves a
    // few more ended rows for the next one, which changes no decision.
    after(() => sweepExpiredCounters(linkPreviewQuota()).catch(() => undefined));
  } catch {
    // `after` throws outside a request scope (a test calling this directly).
  }
}
