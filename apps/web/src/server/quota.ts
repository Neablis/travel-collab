// Per-actor request quotas for the two endpoints that spend a vendor's money
// on the operator's key: the AI assistant (AI_GATEWAY_API_KEY) and the geocode
// proxy (LOCATIONIQ_API_KEY). Security review 2026-08-28, findings H1 and L4 —
// before this, any signed-in account could loop near-body-limit prompts through
// a 32-round-trip handler with nothing between it and the bill, and the AI kill
// switch was remediation after the fact rather than prevention.
//
// NOT to be confused with `server/ai/rateLimit.ts`, which is a different thing
// with a similar name: that one paces calls WITHIN a single request (sleep
// between geocoder lookups so one AI request doesn't breach LocationIQ's
// per-second limit). This one bounds how many REQUESTS an actor may make
// across the whole deployment. Kept as a sibling rather than folded in, because
// they share no state, no failure mode, and no dependencies — that one is a
// pure array helper in the domain-adjacent sense, this one is I/O.
//
// Why Postgres and not memory: this deploys to Vercel serverless, where each
// instance is short-lived and there is no shared process. An in-memory counter
// caps nothing — an attacker's requests fan out across instances, and each one
// starts at zero. The review suggested reusing the `events` table's per-actor
// timestamps, and that was rejected: a prompt the model answers with zero tool
// calls appends NO event (handleAiRequest's "couldn't turn that into any
// changes" path) yet still pays for the round-trips, and the geocode proxy
// never writes an event at all. Counting events would meter exactly the
// requests that are cheapest to make and miss the abusive ones.
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import type { Db } from "./db/client";
import { rateLimitCounters } from "./db/schema";

/**
 * A fixed-window ceiling. `perUser` and `global` share one window so a single
 * policy is one row per actor plus one shared row; layering a second window
 * (burst + daily, as the AI policies below do) is just a second policy in the
 * array, not a second mechanism.
 */
export interface QuotaPolicy {
  /** Bucket namespace. Must be stable — changing it resets everyone's count. */
  readonly name: string;
  readonly windowMs: number;
  readonly perUser: number;
  /** Ceiling across every actor, so one policy also caps a botnet of accounts. */
  readonly global: number;
}

export type QuotaDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** "unavailable" = the counter store itself failed; see the fail-closed note. */
      reason: "user" | "global" | "unavailable";
      retryAfterSeconds: number;
    };

/** The one piece of I/O, injected so the policy logic is testable without a database. */
export interface QuotaCounters {
  /**
   * Atomically add one to `bucket` for the window starting at `windowStart` and
   * return the resulting count. A count from an older window is discarded, not
   * added to.
   */
  bump(bucket: string, windowStart: Date): Promise<number>;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Read at call time, not at module load: the same reason `isDemoDataResetEnabled()`
// does (src/lib/demoDataReset.ts) — a value that is a function of the
// environment should be re-read when it is used, so a test or a redeploy does
// not need a module reload to take effect.
//
// A malformed value falls back to the default rather than to "unlimited": for a
// spend gate, a typo in a Vercel env var must never be the thing that removes
// the ceiling.
function envCeiling(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * AI assistant quotas. Two windows on purpose:
 *
 * - hourly — the abuse window. A scripted loop is bounded to 30 requests an
 *   hour per account, which is far above any human session (the assistant is
 *   invoked deliberately, one prompt at a time, and each one takes seconds).
 * - daily — the bill. The hourly cap alone still permits 720 requests a day
 *   per account against a 32-round-trip handler; 100 is the number that
 *   bounds what one compromised or throwaway account can actually cost.
 *
 * The global ceilings bound the same two things across all accounts, which is
 * the only defence against sign-up-a-new-Google-account-and-repeat.
 */
export function aiQuotas(): QuotaPolicy[] {
  return [
    {
      name: "ai-hourly",
      windowMs: HOUR_MS,
      perUser: envCeiling("AI_RATE_LIMIT_PER_USER_HOURLY", 30),
      global: envCeiling("AI_RATE_LIMIT_GLOBAL_HOURLY", 300),
    },
    {
      name: "ai-daily",
      windowMs: DAY_MS,
      perUser: envCeiling("AI_RATE_LIMIT_PER_USER_DAILY", 100),
      global: envCeiling("AI_RATE_LIMIT_GLOBAL_DAILY", 1000),
    },
  ];
}

/**
 * Geocode-proxy quota (review finding L4). One daily window, because the thing
 * being protected IS a daily number: LocationIQ's free tier is 5,000
 * lookups/day, so the global ceiling is set below it deliberately — this is a
 * cap on the vendor quota, not just a smoothing of bursts.
 *
 * Per-user 300/day is generous for a search box the user drives with an
 * explicit button press (LocationInput has no typeahead), and still bounds a
 * single account to ~6% of the daily allowance.
 */
export function geocodeQuota(): QuotaPolicy[] {
  return [
    {
      name: "geocode-daily",
      windowMs: DAY_MS,
      perUser: envCeiling("GEOCODE_RATE_LIMIT_PER_USER_DAILY", 300),
      global: envCeiling("GEOCODE_RATE_LIMIT_GLOBAL_DAILY", 4000),
    },
  ];
}

/**
 * Charge one request against every policy, in order. Returns the first refusal.
 *
 * FAILS CLOSED. A counter-store error refuses the request rather than waving it
 * through, matching the posture the rest of the server already takes on spend
 * and permission: `aiLiveFlag`'s `defaultValue: false` degrades an unreachable
 * flag service to simulated rather than to spending, `isDemoDataResetEnabled()`
 * resolves anything that is not exactly the opt-in to false, and
 * `requireTripAccess` lets a database error propagate (a 500, i.e. denied)
 * rather than assuming access. It also costs nothing this deployment has not
 * already lost: the AI handler's own `guard()` reads the trip from the same
 * database a moment earlier, so a database that cannot serve this query cannot
 * serve the request either. The geocode proxy is the one place this adds a
 * dependency it did not have — accepted deliberately, because "the database is
 * down" should not be the state in which the vendor key becomes free to burn.
 */
export async function consumeQuota(
  policies: readonly QuotaPolicy[],
  userId: string,
  counters: QuotaCounters = pgCounters(),
  now: Date = new Date(),
): Promise<QuotaDecision> {
  for (const policy of policies) {
    const windowStart = windowStartFor(policy, now);
    const retryAfterSeconds = secondsUntilWindowEnd(policy, windowStart, now);
    let userCount: number;
    try {
      userCount = await counters.bump(`${policy.name}:user:${userId}`, windowStart);
    } catch {
      return { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };
    }
    if (userCount > policy.perUser) {
      // Deliberately return BEFORE charging the global bucket: an actor already
      // over their own ceiling is served nothing, so counting them globally
      // would let one abuser exhaust everyone else's headroom with requests
      // that never happened.
      return { allowed: false, reason: "user", retryAfterSeconds };
    }
    let globalCount: number;
    try {
      globalCount = await counters.bump(`${policy.name}:global`, windowStart);
    } catch {
      return { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };
    }
    if (globalCount > policy.global) {
      // The actor's own counter keeps this request. Slightly conservative (they
      // are charged for something they did not get) and not worth a compensating
      // decrement: a global ceiling being hit is already an incident, not a
      // steady state.
      return { allowed: false, reason: "global", retryAfterSeconds };
    }
  }
  return { allowed: true };
}

/** The refusal a route returns. 429 for a ceiling, 503 for a broken counter. */
export function quotaRefusal(decision: Extract<QuotaDecision, { allowed: false }>): Response {
  const status = decision.reason === "unavailable" ? 503 : 429;
  const error =
    decision.reason === "unavailable"
      ? "rate limiter unavailable"
      : decision.reason === "global"
        ? "this deployment is over its request limit — try again later"
        : "you've made too many requests — try again later";
  return Response.json(
    { error, reason: decision.reason, retryAfterSeconds: decision.retryAfterSeconds },
    { status, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
  );
}

/** Fixed windows aligned to the epoch, so every instance agrees without coordinating. */
function windowStartFor(policy: QuotaPolicy, now: Date): Date {
  return new Date(Math.floor(now.getTime() / policy.windowMs) * policy.windowMs);
}

function secondsUntilWindowEnd(policy: QuotaPolicy, windowStart: Date, now: Date): number {
  return Math.max(1, Math.ceil((windowStart.getTime() + policy.windowMs - now.getTime()) / 1000));
}

/**
 * One row per bucket, forever — not one row per bucket per window. The upsert
 * carries the window forward in place, so the table's size is bounded by the
 * number of actors rather than by traffic, and there is no sweep job to forget
 * to run.
 *
 * `greatest(...)` and the strict `>` comparison make the window monotonic per
 * bucket. Two serverless instances with slightly skewed clocks can otherwise
 * hand each other an older window and reset a counter mid-window, which is
 * exactly the race an attacker with retries would find first.
 */
export function pgCounters(database: Db = db): QuotaCounters {
  return {
    async bump(bucket, windowStart) {
      const [row] = await database
        .insert(rateLimitCounters)
        .values({ bucket, windowStart, hits: 1 })
        .onConflictDoUpdate({
          target: rateLimitCounters.bucket,
          set: {
            hits: sql`case when excluded.window_start > ${rateLimitCounters.windowStart} then 1 else ${rateLimitCounters.hits} + 1 end`,
            windowStart: sql`greatest(${rateLimitCounters.windowStart}, excluded.window_start)`,
          },
        })
        .returning({ hits: rateLimitCounters.hits });
      // `RETURNING` on an upsert that took the DO UPDATE branch always yields a
      // row; a missing one would mean the statement matched nothing, which for
      // an INSERT is not reachable. Treated as "no headroom known" rather than
      // as zero.
      if (row === undefined) throw new Error("quota upsert returned no row");
      return row.hits;
    },
  };
}
