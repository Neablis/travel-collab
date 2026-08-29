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
   * Atomically add `amount` (default 1) to `bucket` for the window starting at
   * `windowStart` and return the resulting count. A count from an older window
   * is discarded, not added to.
   *
   * `amount` exists for KI-67: a policy that can only ever add 1 can only ever
   * meter calls, and cost is not proportional to calls.
   */
  bump(bucket: string, windowStart: Date, amount?: number): Promise<number>;
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
// `rate_limit_counters.hits` is a Postgres `integer`, so a ceiling above its
// maximum is not a ceiling at all — the counter overflows before it is ever
// reached. `Number.isInteger` alone does not catch that: it accepts 1e21,
// which reads as a number, passes `> 0`, and silently means "unlimited" —
// the exact outcome the fallback-on-malformed rule above exists to prevent.
// `Number.isSafeInteger` plus the column's own bound is what makes the
// promise true.
//
// The usable maximum is one BELOW the column's, not equal to it. `bump()`
// increments first and `consumeQuota` then refuses on `count > ceiling`, so
// a refusal needs the counter to reach `ceiling + 1`. Set the ceiling at
// `int4` max and that value is unreachable: the increment overflows, the
// upsert throws, and the fail-closed path answers 503 — an availability
// failure wearing the costume of a spend limit. A ceiling whose refusal
// path cannot execute is not a ceiling either.
const MAX_INT4 = 2_147_483_647;
const MAX_COUNTER_HITS = MAX_INT4 - 1;

function envCeiling(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  const usable = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_COUNTER_HITS;
  return usable ? parsed : fallback;
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
 * The per-request step budget the AI handler compiles in (`MAX_STEPS` for the
 * board/combined surfaces in handleAiRequest.ts). Duplicated as a constant
 * rather than imported so this module keeps no dependency on the AI handler —
 * it is used here only to derive and document the step ceilings below, and to
 * bound what `settleAiSteps` will accept.
 */
const AI_MAX_STEPS_PER_REQUEST = 32;

/**
 * AI **cost** quotas, metered in model round-trips rather than in calls (KI-67).
 *
 * The request policies above bound how many times an actor may ask. They do not
 * bound what asking costs: `handleAiRequest` runs a tool-using loop with a
 * 32-step budget, so one request can burn 32 model round-trips while another
 * burns one, and both used to decrement the same allowance by exactly 1. The
 * measured consequence: a nominal ceiling of 30 requests an hour actually
 * permits **960** round-trips an hour, and an actor who wants to maximise spend
 * under the cap simply writes prompts that provoke long tool loops.
 *
 * These policies are ADDITIVE — the request policies keep their numbers and
 * their meaning, so no operator's configured value silently changes unit. A
 * request is refused if it exceeds EITHER layer, so this can only ever tighten
 * the ceiling, never loosen it.
 *
 * **Why steps and not tokens.** `meta.usage.totalTokens` is the truer cost
 * signal and is already computed, but a token budget has to answer "per token
 * or per currency?" the moment two models differ in price — a question with a
 * product decision inside it. Steps are the driver `TODO.md` already names
 * ("Watch `meta.steps` — that is the cost driver, and it is already
 * instrumented"), they are bounded and model-independent, and they are within
 * a small constant factor of tokens for this handler's fixed-size envelope.
 * Switching the denominator later is a change to these four numbers and the
 * value passed to `settleAiSteps`, not to the mechanism.
 *
 * **The numbers.** Per-user hourly is 30 requests × an 8-round-trip working
 * average, i.e. the same request budget priced at what a request realistically
 * costs rather than at its worst case. That cuts the reachable ceiling from 960
 * round-trips an hour to 240 — a 4× reduction in maximum spend — while leaving
 * ordinary use (most answers finish in one to three steps) nowhere near it. The
 * daily and global ceilings are scaled from their request counterparts the same
 * way. Every one is operator-overridable, and `envCeiling`'s fallback-on-
 * malformed rule applies to them exactly as it does above.
 */
export function aiStepQuotas(): QuotaPolicy[] {
  const AVERAGE_STEPS = 8;
  return [
    {
      name: "ai-steps-hourly",
      windowMs: HOUR_MS,
      perUser: envCeiling("AI_STEP_LIMIT_PER_USER_HOURLY", 30 * AVERAGE_STEPS),
      global: envCeiling("AI_STEP_LIMIT_GLOBAL_HOURLY", 300 * AVERAGE_STEPS),
    },
    {
      name: "ai-steps-daily",
      windowMs: DAY_MS,
      perUser: envCeiling("AI_STEP_LIMIT_PER_USER_DAILY", 100 * AVERAGE_STEPS),
      global: envCeiling("AI_STEP_LIMIT_GLOBAL_DAILY", 1000 * AVERAGE_STEPS),
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
 *
 * **Deliberately still metered in requests, unlike the AI policies (KI-67).**
 * That entry names this policy alongside the AI ones, but the defect it
 * describes is not present here: one request to `/api/geocode` is exactly one
 * LocationIQ lookup, so calls and cost are the same quantity and a
 * cost-proportional charge would be `1` every time. Adding the machinery would
 * buy nothing. The geocode key's real unmetered exposure is a different
 * problem, filed separately as KI-77: the AI handler's own server-side
 * enrichment geocodes through `getGeocoder()` without consulting this policy at
 * all, so an AI request can spend an unbounded-by-this-ceiling number of
 * lookups. That is a missing call site, not a wrong denominator.
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

/**
 * Charge the round-trips a completed AI request actually used, beyond the one
 * `consumeQuota` already pre-authorised (KI-67).
 *
 * **Why this is a second call and not a bigger first one.** You cannot
 * pre-authorise an unknown cost: the step count does not exist until
 * `generateText` returns. So admission stays a charge of 1 — enough to refuse
 * an actor who is already over — and the true cost is settled afterwards. That
 * is the shape change the entry identified as the design question, and it has
 * exactly one consequence worth stating plainly:
 *
 * **The request that crosses the line mid-flight is served, and its debt lands
 * on the actor's counter.** The alternative — failing after the provider has
 * already been paid — burns the money AND withholds the answer, which is
 * strictly worse for everyone including the operator. The ceiling is therefore
 * enforced on the NEXT request, and can be overshot by at most one request's
 * step budget. Bounded overshoot on a spend ceiling is the correct trade; an
 * unbounded one would not be.
 *
 * **Never refuses and never throws.** The work is already done, so there is no
 * decision left to make, and a counter write failing must not turn a successful
 * answer into an error the caller sees. A failed settlement loses that
 * request's excess cost from the ledger — one window of under-counting, the
 * same magnitude of over-permissiveness the counter table's own schema comment
 * already accepts — which is why this swallows rather than propagates. It is
 * also what keeps an int4 overflow at the very top of the range harmless.
 *
 * `steps` is clamped rather than trusted: it arrives from the AI response meta,
 * and a negative or absurd value must not be able to zero out or blow up an
 * actor's allowance.
 */
export async function settleAiSteps(
  policies: readonly QuotaPolicy[],
  userId: string,
  steps: number,
  counters: QuotaCounters = pgCounters(),
  now: Date = new Date(),
): Promise<void> {
  if (!Number.isFinite(steps)) return;
  const used = Math.min(Math.max(Math.trunc(steps), 1), AI_MAX_STEPS_PER_REQUEST);
  const extra = used - 1; // admission already charged the first round-trip
  if (extra <= 0) return;

  for (const policy of policies) {
    const windowStart = windowStartFor(policy, now);
    try {
      await counters.bump(`${policy.name}:user:${userId}`, windowStart, extra);
      await counters.bump(`${policy.name}:global`, windowStart, extra);
    } catch {
      // See the note above: a completed request is never failed over a counter.
    }
  }
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
    async bump(bucket, windowStart, amount = 1) {
      // Clamped to a positive integer before it reaches SQL. `amount` is the
      // only value here that does not originate in this module, and a
      // fractional or negative one would either corrupt an integer column or
      // let a caller DECREMENT someone's usage.
      const by = Math.max(1, Math.trunc(Number.isFinite(amount) ? amount : 1));
      const [row] = await database
        .insert(rateLimitCounters)
        .values({ bucket, windowStart, hits: by })
        .onConflictDoUpdate({
          target: rateLimitCounters.bucket,
          set: {
            // A new window starts AT `by`, not at 1: the charge being applied
            // is the first thing in the window and must not be discarded along
            // with the previous window's count.
            hits: sql`case when excluded.window_start > ${rateLimitCounters.windowStart} then ${by} else ${rateLimitCounters.hits} + ${by} end`,
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
