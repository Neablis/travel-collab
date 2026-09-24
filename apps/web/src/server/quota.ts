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
// timestamps, and that was rejected: a turn the model answers with zero write
// tool calls appends NO event — every question does, and so does every page
// the assistant drafts — yet still pays for the round-trips, and the geocode
// proxy never writes an event at all. Counting events would meter exactly the
// requests that are cheapest to make and miss the abusive ones.
import { and, eq, sql } from "drizzle-orm";
import { NO_CEILINGS, type EntitlementCeilings } from "./assistant/entitlements";
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

  /**
   * Give back `amount` of a reservation on `bucket`, **only if the row is still
   * in `windowStart`'s window**. A rolled window is left alone: the count there
   * belongs to a window this reservation never charged, and subtracting from it
   * would refund someone else's usage.
   *
   * Separate from `bump` rather than a negative `amount`, deliberately.
   * `bump` clamps to a positive integer so that no caller can decrement a
   * counter; relaxing that clamp would let an actor drain their own usage,
   * which is a worse hole than KI-94's. This method can only ever subtract,
   * never below zero, and is reachable only through a `StepReservation`.
   */
  release(bucket: string, windowStart: Date, amount: number): Promise<void>;
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
 *
 * **`ceilings` is the account's pinned plan, and it moves NUMBERS ONLY**
 * (M20 link 5, ADR-043 decision 5). Two rules, and the first one is the whole
 * reason this is a parameter rather than a second set of policies:
 *
 *   * **The bucket `name` must not vary by tier.** `QuotaPolicy.name` is
 *     documented *"Must be stable — changing it resets everyone's count"*, and
 *     a tier-suffixed bucket would do exactly that: an upgrade would zero the
 *     account's usage, and anyone could farm free calls by toggling back and
 *     forth. The names below are literals for that reason, and a property test
 *     pins that no ceiling can reach them.
 *   * **Per-user ceilings come from the plan; global ceilings stay in the
 *     environment.** A per-user ceiling is a term that was SOLD, so it belongs
 *     on the immutable pinned version. A global ceiling is a deployment-wide
 *     abuse bound that protects the operator's bill and was never sold to
 *     anyone, so `envCeiling` keeps owning it and stays tunable by redeploy
 *     without republishing a plan.
 *
 * The **hourly** per-user ceiling also stays in the environment, and that is a
 * reading of M20 rather than an omission: its plan table sells *"AI requests ·
 * steps per day"*, and the hourly window is the abuse window — the burst bound
 * that stops a scripted loop, not a term anyone bought. `null` from the plan
 * means it named no ceiling, and today's default stands unchanged.
 */
export function aiQuotas(ceilings: EntitlementCeilings = NO_CEILINGS): QuotaPolicy[] {
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
      perUser: ceilings.perUserRequestsPerDay ?? envCeiling("AI_RATE_LIMIT_PER_USER_DAILY", 100),
      global: envCeiling("AI_RATE_LIMIT_GLOBAL_DAILY", 1000),
    },
  ];
}

/**
 * A defensive ceiling on what one request may settle, kept as a constant rather
 * than imported so this module keeps no dependency on the AI handler. It is
 * used to derive and document the step ceilings below, and to bound what
 * `settleAiSteps` will accept from a caller.
 *
 * It deliberately sits ABOVE the only budget compiled in today — a `/ask` turn
 * is 8 (`MAX_ASK_STEPS`, handleAskRequest.ts), and since ADR-033 there is no
 * other AI entry point to have one. It used to equal the board surface's 32-step
 * planning budget, which ADR-033 Decision 4 retired; the number is kept as a
 * bound on a bad caller, not as a mirror of a real budget. Lowering it to the
 * real maximum would be a behaviour change and wants its own decision.
 */
export const AI_MAX_STEPS_PER_REQUEST = 32;

/**
 * AI **cost** quotas, metered in model round-trips rather than in calls (KI-67).
 *
 * The request policies above bound how many times an actor may ask. They do not
 * bound what asking costs: the AI handler runs a tool-using loop, so one request
 * can burn its whole step budget while another burns one, and both used to
 * decrement the same allowance by exactly 1. The measured consequence, against
 * the 32-step budget KI-67 was filed on: a nominal ceiling of 30 requests an
 * hour actually permits **960** round-trips an hour, and an actor who wants to
 * maximise spend under the cap simply writes prompts that provoke long tool
 * loops.
 *
 * **`/ask` was missing both halves until 2026-09-02.** This pair was wired into
 * the command endpoint only; `/ask` — built afterwards, and the door users
 * actually reach — charged `aiQuotas()` alone and never settled, so it was
 * metered exactly the way KI-67 proved wrong for the whole life of the endpoint.
 * It now charges both layers at admission and settles from its one end-of-turn
 * writer.
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
 *
 * **`ceilings` works exactly as it does on `aiQuotas` above**, and the same two
 * rules apply verbatim: the bucket names are literals so an upgrade cannot
 * reset a counter, and only the daily per-user number is a sold term. A turn
 * must be SETTLED against the same ceilings it was admitted against, which is
 * why the handler passes the grant's entitlements to both calls rather than
 * letting the settlement fall back to the default.
 */
export function aiStepQuotas(ceilings: EntitlementCeilings = NO_CEILINGS): QuotaPolicy[] {
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
      perUser: ceilings.perUserStepsPerDay ?? envCeiling("AI_STEP_LIMIT_PER_USER_DAILY", 100 * AVERAGE_STEPS),
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
 * Outside-data quota (ADR-052 decision 8): our own ceiling on calls to MET
 * Norway and NASA POWER, charged per upstream call and **only on a cache
 * miss** — a notebook served from `external_data_cache` costs nothing here. A
 * refusal is not a 429 to the page: the point is served from the cache if it
 * can be, and is `unavailable` otherwise.
 *
 * Neither source sells calls, so this protects their goodwill rather than a
 * bill: MET asks to be contacted before 20 req/s, and POWER throttles
 * "repetitive and rapid requests" without a number. One trip's page is a
 * forecast and a normals call per distinct rounded point, normals are kept a
 * month and forecasts until MET's `Expires`, so 200 a day per person is many
 * trips opened many times; the global one bounds sign-up-and-repeat.
 */
export function weatherQuota(): QuotaPolicy[] {
  return [
    {
      name: "weather-daily",
      windowMs: DAY_MS,
      perUser: envCeiling("WEATHER_RATE_LIMIT_PER_USER_DAILY", 200),
      global: envCeiling("WEATHER_RATE_LIMIT_GLOBAL_DAILY", 5000),
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
 * What a reservation charged, and where. The `windowStarts` map is the whole
 * reason this is a value rather than a number: a release must target the exact
 * window its reservation charged, and by the time a turn ends the clock may
 * have moved into the next one.
 */
export interface StepReservation {
  readonly policies: readonly QuotaPolicy[];
  readonly userId: string;
  readonly reserved: number;
  readonly windowStarts: ReadonlyMap<string, Date>;
}

/**
 * Charge the FULL step budget up front, then let `settleAiSteps` give back what
 * the turn did not use (KI-94).
 *
 * The old shape charged one step and settled the rest afterwards, which bounded
 * a single actor's overshoot to one budget but bounded nothing under
 * concurrency: N requests in flight had each charged 1, so they could jointly
 * pass the global ceiling before any of them settled. Reserving the maximum
 * makes in-flight exposure exactly the reservation.
 *
 * **`budget` defaults to the defensive bound, not to a real one.**
 * `AI_MAX_STEPS_PER_REQUEST` exists to cap a caller this module knows nothing
 * about; a caller that DOES know its own per-request ceiling (`/ask`'s
 * `MAX_ASK_STEPS`) passes it explicitly, so in-flight exposure is the real
 * budget rather than 4x it. This keeps the AI loop's actual step count out of
 * `quota.ts` entirely — the caller supplies the number, this module never
 * imports it.
 *
 * **Checked in the same order `consumeQuota` argues for (its own comment
 * above), and rolled back on any refusal.** The user ceiling is checked
 * BEFORE the global bucket is ever touched — bumping global first would
 * charge everyone else's shared headroom for a request that was never going
 * to be served, and at `budget` units instead of `consumeQuota`'s 1 that is a
 * `budget`x amplification of the exact DoS the check-user-first order exists
 * to prevent. And unlike `consumeQuota` (a 1-unit charge with no refund
 * primitive, where leaving a refused charge in place was the accepted
 * trade-off), every bucket THIS call has bumped is released the moment any
 * check refuses — including an earlier policy in the array that already
 * admitted (`aiStepQuotas()` is [hourly, daily]; a daily refusal must not
 * strand hourly's charge, because a refused call returns `reservation: null`
 * and there is no `StepReservation` left to settle it against).
 *
 * Returns `reservation: null` whenever the decision refuses, so a caller cannot
 * settle against a turn that never ran.
 */
export async function reserveAiSteps(
  policies: readonly QuotaPolicy[],
  userId: string,
  counters: QuotaCounters = pgCounters(),
  now: Date = new Date(),
  budget: number = AI_MAX_STEPS_PER_REQUEST,
): Promise<{ decision: QuotaDecision; reservation: StepReservation | null }> {
  const windowStarts = new Map<string, Date>();
  // Every bucket this attempt has actually bumped, in bump order — released in
  // full on any refusal. A best-effort rollback: losing one over-counts, which
  // errs toward refusing the NEXT request rather than admitting one that
  // should not be (the same posture `settleAiSteps` takes on a failed release).
  const bumped: { bucket: string; windowStart: Date }[] = [];
  const rollback = async () => {
    for (const { bucket, windowStart } of bumped) {
      try {
        await counters.release(bucket, windowStart, budget);
      } catch {
        // Best-effort; see the comment above.
      }
    }
  };

  for (const policy of policies) {
    const windowStart = windowStartFor(policy, now);
    const retryAfterSeconds = secondsUntilWindowEnd(policy, windowStart, now);
    windowStarts.set(policy.name, windowStart);

    const userBucket = `${policy.name}:user:${userId}`;
    let userCount: number;
    try {
      userCount = await counters.bump(userBucket, windowStart, budget);
      bumped.push({ bucket: userBucket, windowStart });
    } catch {
      // Fail closed, exactly as `consumeQuota` does: a broken counter store must
      // not become an open door.
      await rollback();
      // 60, not the window remainder — `consumeQuota` answers the same
      // condition the same way, and for the same reason: a counter store that
      // failed is a transient fault, not a ceiling that has been reached.
      // `quotaRefusal` puts this straight into `Retry-After` on a 503, so the
      // remainder would tell a client to wait out the rest of an hour or a day
      // for a blip. (CodeRabbit, PR #178.)
      return { decision: { allowed: false, reason: "unavailable", retryAfterSeconds: 60 }, reservation: null };
    }

    // Checked BEFORE the global bucket is touched — see this function's own
    // comment for why the order matters more here than it does in
    // `consumeQuota`.
    if (userCount > policy.perUser) {
      await rollback();
      return { decision: { allowed: false, reason: "user", retryAfterSeconds }, reservation: null };
    }

    const globalBucket = `${policy.name}:global`;
    let globalCount: number;
    try {
      globalCount = await counters.bump(globalBucket, windowStart, budget);
      bumped.push({ bucket: globalBucket, windowStart });
    } catch {
      await rollback();
      // 60, not the window remainder — `consumeQuota` answers the same
      // condition the same way, and for the same reason: a counter store that
      // failed is a transient fault, not a ceiling that has been reached.
      // `quotaRefusal` puts this straight into `Retry-After` on a 503, so the
      // remainder would tell a client to wait out the rest of an hour or a day
      // for a blip. (CodeRabbit, PR #178.)
      return { decision: { allowed: false, reason: "unavailable", retryAfterSeconds: 60 }, reservation: null };
    }

    if (globalCount > policy.global) {
      await rollback();
      return { decision: { allowed: false, reason: "global", retryAfterSeconds }, reservation: null };
    }
  }

  return {
    decision: { allowed: true },
    reservation: { policies, userId, reserved: budget, windowStarts },
  };
}

/**
 * Give back what a completed AI request did not use of its `reserveAiSteps`
 * reservation (KI-94, KI-67 before it).
 *
 * **In-flight exposure is now exactly the reservation.** `reserveAiSteps`
 * charges the full budget at admission and this releases what the turn did not
 * use, so N concurrent requests can hold at most N × budget and the global
 * ceiling is asserted against the real figure rather than against N × 1.
 * Closes KI-94 (filed as KI-78 and renumbered on merge) and KI-97 with it.
 *
 * **Never refuses and never throws.** The work is already done, so there is no
 * decision left to make, and a counter write failing must not turn a successful
 * answer into an error the caller sees. A failed release loses that request's
 * refund — one window of over-counting, the safe direction, since it errs
 * toward refusing the NEXT request rather than admitting it.
 *
 * `steps` is clamped rather than trusted: it arrives from the AI response meta,
 * and a negative or absurd value must not be able to zero out or blow up an
 * actor's allowance. Non-finite input keeps the full reservation charged —
 * unknown usage is the conservative charge, not the cheap one.
 */
export async function settleAiSteps(
  reservation: StepReservation,
  steps: number,
  counters: QuotaCounters = pgCounters(),
): Promise<void> {
  // **A real zero settles as zero.** The floor used to be 1, from when
  // admission charged a single step up front and one round-trip had therefore
  // always happened by the time anything settled. Admission now reserves the
  // whole budget and this function refunds down from it, so a genuine zero —
  // a page-scoped turn whose thread failed validation, which calls no
  // classifier and runs no agent — is a fact, and flooring it to 1 charged an
  // allowance for a request that never reached a provider. Repeatable by a
  // caller, since `safeValidateUIMessages` failing is caller-controlled.
  // (CodeRabbit, PR #178.)
  //
  // A non-finite `steps` — and a NEGATIVE one — still settles at the FULL
  // reservation. Unknown usage keeps the conservative charge, because the
  // alternative is refunding a turn whose cost nobody measured, and a negative
  // count is garbage rather than a measurement of zero. Only a real, non-
  // negative number is trusted, which is what keeps "a genuine zero" and
  // "nobody knows" distinguishable.
  const counted = Math.trunc(steps);
  const used =
    Number.isFinite(steps) && counted >= 0 ? Math.min(counted, reservation.reserved) : reservation.reserved;
  const unused = reservation.reserved - used;
  if (unused <= 0) return;

  for (const policy of reservation.policies) {
    const windowStart = reservation.windowStarts.get(policy.name);
    if (windowStart === undefined) continue;
    try {
      await counters.release(`${policy.name}:user:${reservation.userId}`, windowStart, unused);
      await counters.release(`${policy.name}:global`, windowStart, unused);
    } catch {
      // A completed request is never failed over a counter. Losing a refund
      // over-counts, which errs toward refusing the NEXT request rather than
      // admitting it — the safe direction.
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
/** One policy's current standing for one account: what is used, and the cap. */
export interface QuotaStanding {
  used: number;
  limit: number;
}

/**
 * **Read a per-user counter without charging it** (M20 link 5's display half).
 *
 * The account sheet's two meters need what `consumeQuota` knows, and must not
 * do what `consumeQuota` does: rendering a page is not a request, and a meter
 * that costs a question to look at would be a quota bug wearing a progress bar.
 * So this reads `rate_limit_counters` directly and never calls `bump`.
 *
 * **A bucket whose row is from an older window reads as zero**, which mirrors
 * `bump`'s own rule that a count from a stale window is discarded rather than
 * added to. Without the `window_start` predicate a meter would show yesterday's
 * total against today's ceiling until the account's next request rolled it.
 *
 * The GLOBAL half of each policy is deliberately not read. It is not this
 * account's to see, and the milestone is explicit that the environment's global
 * ceiling is never shown to a holder because it was never sold to anyone.
 */
export async function peekQuota(
  policy: QuotaPolicy,
  userId: string,
  now: Date = new Date(),
  database: Db = db,
): Promise<QuotaStanding> {
  const windowStart = windowStartFor(policy, now);
  const [row] = await database
    .select({ hits: rateLimitCounters.hits })
    .from(rateLimitCounters)
    .where(
      and(
        eq(rateLimitCounters.bucket, `${policy.name}:user:${userId}`),
        eq(rateLimitCounters.windowStart, windowStart),
      ),
    )
    .limit(1);
  return { used: row?.hits ?? 0, limit: policy.perUser };
}

/** The policy a meter is about: the DAILY one, which is the one that is sold. */
export function dailyPolicy(policies: readonly QuotaPolicy[]): QuotaPolicy {
  // The hourly policies are operational guard rails from env vars; the daily
  // ones carry `ceilings.perUser*` and are therefore the numbers a plan
  // version actually promises. Picking by window rather than by name so a
  // renamed policy cannot silently swap which number a holder is shown.
  const daily = policies.find((policy) => policy.windowMs === DAY_MS);
  if (daily === undefined) throw new Error("no daily policy — a meter has nothing to show");
  return daily;
}

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
    async release(bucket, windowStart, amount) {
      const by = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
      if (by === 0) return;
      await database
        .update(rateLimitCounters)
        .set({ hits: sql`greatest(${rateLimitCounters.hits} - ${by}, 0)` })
        .where(
          and(
            eq(rateLimitCounters.bucket, bucket),
            // The window guard. `=` not `>=`: a refund is valid only against
            // the exact window it reserved in.
            eq(rateLimitCounters.windowStart, windowStart),
          ),
        );
    },
  };
}
