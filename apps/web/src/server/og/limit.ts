import { isIPv6 } from "node:net";
import { after } from "next/server";
import { consumeQuota, linkPreviewQuota, quotaRefusal, sweepExpiredCounters } from "../quota";

// The rate limit on the four `/api/og/**` routes (Mitchell, 2026-09-27): the
// Postgres counter `quota.ts` already keeps. Never the shared Redis: ADR-059
// keeps it an expendable cache, and a limiter spends a command per request.
//
// **It sits behind the CDN.** The routes answer with `s-maxage`, so a repeat
// fetch of the same link is served by the CDN in front of the VPS and never runs the
// function, and so never reaches this counter. Only cache misses are charged.
// That is also why a refusal says `no-store`: a cached 429 would be served to
// every unfurler of that link, not just the one that tripped the limit.

/**
 * The caller's IP: the first hop of `x-forwarded-for`, which the reverse proxy
 * (Coolify's Traefik) sets from the connecting client, then `x-real-ip`.
 * Both are client-supplied if the proxy does not overwrite them, which is fine for a limiter
 * whose job is bounding cost, not proving identity.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return bucketOf(forwarded);
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? bucketOf(real) : "unknown";
}

/**
 * An IPv6 address as its /64, the smallest block one subscriber is routinely
 * given: per address, one host could rotate through 2^64 buckets and never meet
 * its limit. IPv4, and anything that is not an IPv6 address, stands as sent.
 */
function bucketOf(ip: string): string {
  if (!isIPv6(ip)) return ip;
  // An IPv4 behind a dual-stack socket is still one IPv4 address; and a dotted tail
  // counts as two groups, which the arithmetic below does not know.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (ip.includes(".")) return ip;
  const [head = "", tail] = ip.toLowerCase().replace(/%.*$/, "").split("::");
  const groups = head === "" ? [] : head.split(":");
  const rest = tail === undefined || tail === "" ? [] : tail.split(":");
  const padding = tail === undefined ? [] : Array<string>(8 - groups.length - rest.length).fill("0");
  return [...groups, ...padding, ...rest].slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":") + "::/64";
}

/**
 * Charge this request to its IP. `null` means go ahead; otherwise the 429 (or
 * 503 when the counter itself is down, `consumeQuota`'s fail-closed rule) to
 * return, marked uncacheable.
 */
export async function limitLinkPreview(
  request: Request,
  onAllowed: () => void = maybeSweep,
): Promise<Response | null> {
  const decision = await consumeQuota(linkPreviewQuota(), clientIp(request));
  if (decision.allowed) {
    // Only an allowed request may start a sweep (CodeRabbit, PR #259): refused
    // traffic is the abusive kind, and letting it trigger DELETEs would hand a
    // flood a lever on the database. `onAllowed` is injected by the tests.
    onAllowed();
    return null;
  }
  const refusal = quotaRefusal(decision);
  refusal.headers.set("Cache-Control", "no-store");
  return refusal;
}

// **The sweep rides on this route, not on a cron.** Keyed by IP, every address
// that unfurls a link leaves a `rate_limit_counters` row, and `bump` never
// removes one; this is the only caller whose key space is unbounded, so it is
// the one that cleans up after itself. The only crons are the Coolify scheduled tasks
// (/api/cron/embed-days 04:00 UTC, /api/cron/tier-rollup 04:30 UTC), and adding one for a single DELETE would be a second
// mechanism with its own secret to forget.
//
// One request in a hundred is plenty: rows are one-minute windows, so a sweep
// that runs every few minutes of real traffic keeps the table near the number
// of IPs seen in that span. With no traffic there are no new rows to sweep.
const SWEEP_PROBABILITY = 0.01;

function maybeSweep(): void {
  if (Math.random() < SWEEP_PROBABILITY) scheduleSweep();
}

// **One sweep at a time per instance** (CodeRabbit, PR #259). A sweep with a
// backlog deletes most of the IP-keyed rows, and the planner rightly scans the
// table for that (the partial `rate_limit_counters_link_preview_window` index
// serves the usual small sweep), so two overlapping sweeps would be two scans
// for the work of one. The flag clears when the sweep settles, whether it
// succeeded or not.
let sweeping = false;

/**
 * Start a sweep after the response unless one is already in flight on this
 * instance. Returns whether it started. `run` and `defer` are injected by the
 * tests; `defer` is `after` in a request.
 */
export function scheduleSweep(
  run: () => Promise<void> = () => sweepExpiredCounters(linkPreviewQuota()),
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
