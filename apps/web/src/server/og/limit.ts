import { after } from "next/server";
import { consumeQuota, linkPreviewQuota, memoryCounters, quotaRefusal, registrationAddress } from "../quota";

// The rate limit on the four `/api/og/**` routes (Mitchell, 2026-09-27).
//
// **Counted in this process, not in Postgres** (2026-11-17). It was the
// Postgres counter `quota.ts` keeps, on the reasoning that a CDN in front of
// the app answered repeat fetches, so only cache misses ever reached it. Since
// M59 nothing fronts the app (`libraryCache.ts`), so every unfurl, Applebot's
// included, reached it, and each was an upsert: a database that had nothing
// else to do was woken for a limiter. Neon never got the five idle minutes it
// needs to scale to zero (production compute active about 20 hours a day).
// One long-lived server now holds the count; `memoryCounters` says what that
// costs. Never the shared Redis: ADR-059 keeps it an expendable cache, and a
// limiter spends a command per request.
//
// A refusal still says `no-store`: a cached 429 would be served to every
// unfurler of that link, not just the one that tripped the limit.
const counters = memoryCounters();

/**
 * The caller's IP: the first hop of `x-forwarded-for`, which the reverse proxy
 * (Coolify's Traefik) sets from the connecting client, then `x-real-ip`.
 * Both are client-supplied if the proxy does not overwrite them, which is fine for a limiter
 * whose job is bounding cost, not proving identity. An IPv6 address stands as its /64 and a
 * mapped IPv4 as its IPv4 (`registrationAddress`), so one subscriber is one bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return registrationAddress(forwarded);
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? registrationAddress(real) : "unknown";
}

/**
 * Charge this request to its IP. `null` means go ahead; otherwise the 429 to
 * return, marked uncacheable. Reads and writes no database.
 */
export async function limitLinkPreview(request: Request): Promise<Response | null> {
  const decision = await consumeQuota(linkPreviewQuota(), clientIp(request), counters);
  if (decision.allowed) return null;
  const refusal = quotaRefusal(decision);
  refusal.headers.set("Cache-Control", "no-store");
  return refusal;
}

// The sweep below is no longer this route's: link previews leave no
// `rate_limit_counters` rows now. It stays here because the other IP-keyed
// Postgres limiters (`publicLibraryLimit.ts`, `oauth/register`) share it and
// its one-at-a-time flag; each passes the sweep for its own policies.

// **One sweep at a time per instance** (CodeRabbit, PR #259). A sweep with a
// backlog deletes most of the IP-keyed rows, and the planner rightly scans the
// table for that (the partial `rate_limit_counters_link_preview_window` index
// serves the usual small sweep), so two overlapping sweeps would be two scans
// for the work of one. The flag clears when the sweep settles, whether it
// succeeded or not.
let sweeping = false;

/**
 * Start a sweep after the response unless one is already in flight on this
 * instance. Returns whether it started. `run` is the caller's sweep; `defer`
 * is `after` in a request, and injected by the tests.
 */
export function scheduleSweep(
  run: () => Promise<void>,
  defer: (task: () => Promise<void>) => void = after,
): boolean {
  if (sweeping) return false;
  sweeping = true;
  try {
    // After the response, and never able to fail it: a missed sweep leaves a
    // few more ended rows for the next one, which changes no decision.
    defer(() =>
      run()
        .catch(() => undefined)
        .finally(() => {
          sweeping = false;
        }),
    );
    return true;
  } catch {
    // `after` throws outside a request scope; nothing was scheduled.
    sweeping = false;
    return false;
  }
}
