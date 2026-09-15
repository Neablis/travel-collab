import { describe, expect, it, vi } from "vitest";
import {
  aiQuotas,
  aiStepQuotas,
  AI_MAX_STEPS_PER_REQUEST,
  consumeQuota,
  dailyPolicy,
  geocodeQuota,
  quotaRefusal,
  reserveAiSteps,
  settleAiSteps,
  type QuotaCounters,
  type QuotaDecision,
  type QuotaPolicy,
  type StepReservation,
} from "./quota";

// A counter store with the same fixed-window semantics as the Postgres one,
// in memory. The SQL that makes this atomic across instances is covered by
// quota.int.test.ts; what is under test here is the policy logic on top of it.
function fakeCounters(): QuotaCounters & { rows: Map<string, { windowStart: number; hits: number }> } {
  const rows = new Map<string, { windowStart: number; hits: number }>();
  return {
    rows,
    async bump(bucket, windowStart, amount = 1) {
      // Mirrors pgCounters' own clamp, so the fake cannot accept a charge the
      // real store would reject or coerce.
      const by = Math.max(1, Math.trunc(Number.isFinite(amount) ? amount : 1));
      const existing = rows.get(bucket);
      const next =
        existing === undefined || windowStart.getTime() > existing.windowStart
          ? { windowStart: windowStart.getTime(), hits: by }
          : { windowStart: existing.windowStart, hits: existing.hits + by };
      rows.set(bucket, next);
      return next.hits;
    },
    async release(bucket, windowStart, amount) {
      const by = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
      const row = rows.get(bucket);
      if (row === undefined || row.windowStart !== windowStart.getTime()) return;
      row.hits = Math.max(0, row.hits - by);
    },
  };
}

const POLICY: QuotaPolicy = { name: "test", windowMs: 60_000, perUser: 3, global: 5 };
const T0 = new Date("2026-08-28T12:00:00.000Z");

describe("consumeQuota", () => {
  it("allows a normal single request", async () => {
    const decision = await consumeQuota([POLICY], "alice", fakeCounters(), T0);
    expect(decision).toEqual({ allowed: true });
  });

  it("allows exactly the per-user ceiling, then refuses the next one", async () => {
    const counters = fakeCounters();
    for (let i = 0; i < POLICY.perUser; i += 1) {
      expect(await consumeQuota([POLICY], "alice", counters, T0)).toEqual({ allowed: true });
    }
    const refused = await consumeQuota([POLICY], "alice", counters, T0);
    expect(refused).toMatchObject({ allowed: false, reason: "user" });
  });

  // The reason `envCeiling` stops one below int4 max, exercised on the decision
  // itself rather than on the configured number. `bump()` increments and the
  // refusal is `count > ceiling`, so refusing at a ceiling of C needs the
  // counter to reach C+1 — which at int4 max is a value the column cannot
  // hold. Here the store is asked to return exactly the highest ceiling
  // `envCeiling` will now accept, and the decision must be a refusal: if it
  // were an allow, the next request would be the one that overflows.
  it("refuses at the highest ceiling envCeiling accepts, rather than needing an unstorable +1", async () => {
    const MAX_ACCEPTED = 2_147_483_646;
    const atCeiling: QuotaCounters = {
      async bump() { return MAX_ACCEPTED + 1; },
      async release() {},
    };
    const decision = await consumeQuota(
      [{ name: "test", windowMs: 60_000, perUser: MAX_ACCEPTED, global: MAX_ACCEPTED }],
      "alice",
      atCeiling,
      T0,
    );
    expect(decision).toMatchObject({ allowed: false, reason: "user" });
  });

  it("meters each user separately", async () => {
    const counters = fakeCounters();
    for (let i = 0; i < POLICY.perUser + 1; i += 1) {
      await consumeQuota([POLICY], "alice", counters, T0);
    }
    expect(await consumeQuota([POLICY], "bob", counters, T0)).toEqual({ allowed: true });
  });

  it("refuses on the global ceiling even though no single user is over theirs", async () => {
    const counters = fakeCounters();
    // 5 global, 3 per user: two users at 2 and 3 stay under their own ceilings.
    for (const user of ["a", "b"]) {
      for (let i = 0; i < 3; i += 1) await consumeQuota([POLICY], user, counters, T0);
    }
    const decision = await consumeQuota([POLICY], "c", counters, T0);
    expect(decision).toMatchObject({ allowed: false, reason: "global" });
  });

  // The point of returning before the global bump: requests an actor never got
  // served must not eat the headroom everyone else shares.
  it("does not charge the global bucket for a request refused on the user ceiling", async () => {
    const counters = fakeCounters();
    for (let i = 0; i < POLICY.perUser + 4; i += 1) {
      await consumeQuota([POLICY], "alice", counters, T0);
    }
    expect(counters.rows.get("test:global")?.hits).toBe(POLICY.perUser);
  });

  it("resets when the window rolls over", async () => {
    const counters = fakeCounters();
    for (let i = 0; i < POLICY.perUser + 1; i += 1) {
      await consumeQuota([POLICY], "alice", counters, T0);
    }
    const nextWindow = new Date(T0.getTime() + POLICY.windowMs);
    expect(await consumeQuota([POLICY], "alice", counters, nextWindow)).toEqual({ allowed: true });
  });

  it("reports how long until the window ends", async () => {
    const counters = fakeCounters();
    for (let i = 0; i < POLICY.perUser; i += 1) await consumeQuota([POLICY], "alice", counters, T0);
    const at = new Date(T0.getTime() + 20_000);
    const refused = await consumeQuota([POLICY], "alice", counters, at);
    expect(refused).toEqual({ allowed: false, reason: "user", retryAfterSeconds: 40 });
  });

  it("refuses the first policy that is out of headroom, and does not charge the rest", async () => {
    const counters = fakeCounters();
    const tight: QuotaPolicy = { name: "tight", windowMs: 60_000, perUser: 1, global: 99 };
    const loose: QuotaPolicy = { name: "loose", windowMs: 60_000, perUser: 99, global: 99 };
    await consumeQuota([tight, loose], "alice", counters, T0);
    const refused = await consumeQuota([tight, loose], "alice", counters, T0);
    expect(refused).toMatchObject({ allowed: false, reason: "user" });
    expect(counters.rows.get("loose:user:alice")?.hits).toBe(1);
  });

  // Fail-closed, matching aiLiveFlag's defaultValue:false and
  // isDemoDataResetEnabled() — see the note on consumeQuota.
  it("refuses when the counter store fails, rather than waving the request through", async () => {
    const broken: QuotaCounters = {
      bump: vi.fn(async () => { throw new Error("db down"); }),
      release: vi.fn(async () => {}),
    };
    const decision = await consumeQuota([POLICY], "alice", broken, T0);
    expect(decision).toMatchObject({ allowed: false, reason: "unavailable" });
  });

  it("refuses when the store fails on the global bump specifically", async () => {
    let calls = 0;
    const flaky: QuotaCounters = {
      bump: async () => {
        calls += 1;
        if (calls === 1) return 1;
        throw new Error("db down");
      },
      release: async () => {},
    };
    expect(await consumeQuota([POLICY], "alice", flaky, T0)).toMatchObject({
      allowed: false,
      reason: "unavailable",
    });
  });
});

describe("quotaRefusal", () => {
  it("is a 429 with Retry-After for a ceiling", async () => {
    const res = quotaRefusal({ allowed: false, reason: "user", retryAfterSeconds: 42 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    await expect(res.json()).resolves.toMatchObject({ reason: "user", retryAfterSeconds: 42 });
  });

  it("is a 503, not a 429, when the limiter itself is the problem", () => {
    expect(quotaRefusal({ allowed: false, reason: "unavailable", retryAfterSeconds: 60 }).status).toBe(503);
  });
});

// KI-67: the policies metered REQUESTS, so a 32-round-trip answer cost the same
// allowance as a one-round-trip one. Measured against the code before the fix:
//
//   1-step  request charged ai-hourly: 1
//   32-step request charged ai-hourly: 1
//   per-user hourly ceiling (requests): 30
//   model round-trips that ceiling actually permits: 960
//
// The nominal ceiling of 30 was really a ceiling of 960, and an actor who
// wanted to maximise spend under it only had to write prompts that provoked
// long tool loops.
describe("cost metering (KI-67)", () => {
  /**
   * The handler's accounting for one AI request that used `steps` round-trips —
   * mirroring `admissionPorts.ts`'s SPLIT call (KI-94): the request layer is
   * still `consumeQuota`, but the step layer reserves the full budget and
   * settles the unused part rather than charging 1 and topping up.
   */
  async function chargeRequest(counters: QuotaCounters, userId: string, steps: number): Promise<QuotaDecision> {
    const requestDecision = await consumeQuota(aiQuotas(), userId, counters, T0);
    if (!requestDecision.allowed) return requestDecision;
    const { decision, reservation } = await reserveAiSteps(aiStepQuotas(), userId, counters, T0);
    if (decision.allowed && reservation) await settleAiSteps(reservation, steps, counters);
    return decision;
  }

  it("charges a 32-step answer 32x what a 1-step answer costs", async () => {
    const counters = fakeCounters();
    await chargeRequest(counters, "alice", 1);
    await chargeRequest(counters, "mallory", 32);

    expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(1);
    expect(counters.rows.get("ai-steps-hourly:user:mallory")?.hits).toBe(32);
  });

  it("still charges the request policies exactly once each, whatever the cost", async () => {
    // The request layer keeps its own meaning; the step layer is additive.
    const counters = fakeCounters();
    await chargeRequest(counters, "mallory", 32);
    expect(counters.rows.get("ai-hourly:user:mallory")?.hits).toBe(1);
    expect(counters.rows.get("ai-daily:user:mallory")?.hits).toBe(1);
  });

  it("bounds a loop of maximum-cost requests far below the old 960 round-trips", async () => {
    // The whole point of the entry: drive the most expensive request possible
    // in a loop and count how many round-trips the ceiling actually permits.
    const counters = fakeCounters();
    let spent = 0;
    for (let i = 0; i < 100; i += 1) {
      const decision = await chargeRequest(counters, "mallory", 32);
      if (!decision.allowed) break;
      spent += 32;
    }
    // No "+ 32 overshoot" term any more: reserving the full budget up front
    // means a request that would cross the ceiling is refused before it runs,
    // not served and charged to whichever request settles next.
    expect(spent).toBeLessThanOrEqual(240);
    expect(spent).toBeLessThan(960); // what the same loop bought before the fix
  });

  it("leaves ordinary cheap use nowhere near the step ceiling", async () => {
    const counters = fakeCounters();
    for (let i = 0; i < 30; i += 1) {
      expect((await chargeRequest(counters, "alice", 2)).allowed).toBe(true);
    }
    expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(60);
  });

  it("charges the global bucket the same real cost as the user bucket", async () => {
    const counters = fakeCounters();
    await chargeRequest(counters, "mallory", 12);
    expect(counters.rows.get("ai-steps-hourly:global")?.hits).toBe(12);
  });

  // Replaces the old "serves the request that crosses the line, then refuses
  // the next one" test: that documented the settle-after design's own
  // overshoot, which reserving the full budget at admission removes even for
  // ONE actor issuing requests in sequence — there is no line left to cross,
  // because the charge that would cross it is refused before the request runs.
  it("never lets a single actor's usage cross its own ceiling, unlike the old settle-after design", async () => {
    const counters = fakeCounters();
    const policy = aiStepQuotas()[0]!;
    let last = await chargeRequest(counters, "mallory", 32);
    let served = 0;
    while (last.allowed) {
      served += 1;
      last = await chargeRequest(counters, "mallory", 32);
    }
    expect(last).toMatchObject({ allowed: false, reason: "user" });
    // Every SERVED request landed inside the ceiling — no served request ever
    // pushed the counter over it.
    expect(served * AI_MAX_STEPS_PER_REQUEST).toBeLessThanOrEqual(policy.perUser);
  });

  describe("settleAiSteps", () => {
    it("charges exactly one step for a one-step answer, refunding the rest of the reservation", async () => {
      const counters = fakeCounters();
      const { decision, reservation } = await reserveAiSteps(aiStepQuotas(), "alice", counters, T0);
      expect(decision.allowed).toBe(true);
      await settleAiSteps(reservation!, 1, counters);
      expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(1);
    });

    // **This used to assert a minimum charge of one for BOTH values, and that
    // floor was a defect** (CodeRabbit, PR #178). It made sense when admission
    // charged a single step up front, so one round-trip had always happened by
    // settlement time. Admission now reserves the whole budget and settlement
    // refunds down from it, which makes a real zero meaningful — and charging
    // for it billed callers for requests that reached no provider.
    it("settles a genuine zero as zero", async () => {
      const counters = fakeCounters();
      const { reservation } = await reserveAiSteps(aiStepQuotas(), "alice", counters, T0);
      await settleAiSteps(reservation!, 0, counters);
      expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(0);
    });

    it("keeps the full reservation for a negative step count — garbage is not a measurement of zero", async () => {
      const counters = fakeCounters();
      const { reservation } = await reserveAiSteps(aiStepQuotas(), "alice", counters, T0);
      await settleAiSteps(reservation!, -5, counters);
      expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(AI_MAX_STEPS_PER_REQUEST);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])(
      "keeps the full reservation for a non-finite step count (%o) — unknown usage is the conservative charge",
      async (steps) => {
        const counters = fakeCounters();
        const { reservation } = await reserveAiSteps(aiStepQuotas(), "alice", counters, T0);
        await settleAiSteps(reservation!, steps, counters);
        expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(AI_MAX_STEPS_PER_REQUEST);
      },
    );

    it("clamps a step count above the reservation to the reservation itself", async () => {
      const counters = fakeCounters();
      const { reservation } = await reserveAiSteps(aiStepQuotas(), "alice", counters, T0);
      await settleAiSteps(reservation!, 10_000, counters);
      expect(counters.rows.get("ai-steps-hourly:user:alice")?.hits).toBe(AI_MAX_STEPS_PER_REQUEST);
    });

    it("never throws when the counter store fails, because the work is already done", async () => {
      const broken: QuotaCounters = {
        async bump() {
          throw new Error("counter store down");
        },
        async release() {
          throw new Error("counter store down");
        },
      };
      const policies = aiStepQuotas();
      const reservation: StepReservation = {
        policies,
        userId: "alice",
        reserved: AI_MAX_STEPS_PER_REQUEST,
        windowStarts: new Map(policies.map((p) => [p.name, T0])),
      };
      await expect(settleAiSteps(reservation, 1, broken)).resolves.toBeUndefined();
    });
  });
});

describe("policy configuration", () => {
  it("reads ceilings from the environment at call time", () => {
    vi.stubEnv("AI_RATE_LIMIT_PER_USER_HOURLY", "7");
    try {
      expect(aiQuotas()[0]?.perUser).toBe(7);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // A typo in a Vercel env var must not be the thing that removes the ceiling.
  //
  // The last three are the ones `Number.isInteger` waved through: it is true
  // for 1e21, so a value that reads as a number and is comfortably `> 0` used
  // to be accepted as a ceiling — while being both effectively unlimited and
  // past `rate_limit_counters.hits`'s Postgres `integer` maximum, so the
  // counter would overflow before ever reaching it. A ceiling no counter can
  // represent is not a ceiling.
  it.each(["abc", "0", "-5", "12.5", "", "1e21", "2147483648", "9007199254740993"])(
    "falls back to the default for %o",
    (raw) => {
      vi.stubEnv("GEOCODE_RATE_LIMIT_GLOBAL_DAILY", raw);
      try {
        expect(geocodeQuota()[0]?.global).toBe(4000);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  // The boundary is one BELOW the column's maximum, and that asymmetry is the
  // point: refusing needs the counter to reach `ceiling + 1`, so a ceiling at
  // int4 max can only ever overflow into a fail-closed 503 instead of a 429.
  it("accepts the highest ceiling whose refusal can actually fire", () => {
    vi.stubEnv("GEOCODE_RATE_LIMIT_GLOBAL_DAILY", "2147483646");
    try {
      expect(geocodeQuota()[0]?.global).toBe(2_147_483_646);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects a ceiling at int4 max, whose +1 refusal check would overflow", () => {
    vi.stubEnv("GEOCODE_RATE_LIMIT_GLOBAL_DAILY", "2147483647");
    try {
      expect(geocodeQuota()[0]?.global).toBe(4000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the AI policies ordered burst-then-bill, both bounded per user and globally", () => {
    const policies = aiQuotas();
    expect(policies.map((p) => p.name)).toEqual(["ai-hourly", "ai-daily"]);
    for (const p of policies) {
      expect(p.perUser).toBeLessThan(p.global);
      expect(p.windowMs).toBeGreaterThan(0);
    }
  });
});

// Migrated from `consumeQuota` to `reserveAiSteps` (KI-94's fix). Isolated to
// the DAILY policy alone rather than the full `aiStepQuotas()` pair: reserving
// the real 32-step budget per admission (instead of the old default-1 bump)
// means the HOURLY policy's own, much tighter global ceiling would refuse
// first if both ran together, which would make this test about the hourly
// window instead of the property it exists to prove.
it("refuses the request that would take the global step ceiling past its limit, even in flight", async () => {
  const daily = dailyPolicy(aiStepQuotas());
  const counters = fakeCounters();
  const now = new Date("2026-09-15T12:00:00.000Z");

  // One more request than the global ceiling can fund at the full budget.
  const admissions = Math.floor(daily.global / AI_MAX_STEPS_PER_REQUEST) + 1;

  const results = await Promise.all(
    Array.from({ length: admissions }, (_unused, i) => reserveAiSteps([daily], `user-${i}`, counters, now)),
  );
  const decisions = results.map((r) => r.decision);

  // Distinct users, so the per-user ceiling is untouched: the global one is the
  // only thing that can refuse here.
  expect(decisions.filter((d) => d.allowed).length).toBe(admissions - 1);
  const refused = decisions.find((d) => !d.allowed);
  expect(refused).toEqual(expect.objectContaining({ allowed: false, reason: "global" }));
});

it("refunds the unused budget, so a one-step answer costs one step", async () => {
  const policies = aiStepQuotas();
  const daily = dailyPolicy(policies);
  const counters = fakeCounters();
  const now = new Date("2026-09-15T12:00:00.000Z");

  const { decision, reservation } = await reserveAiSteps(policies, "user-a", counters, now);
  expect(decision.allowed).toBe(true);
  expect(counters.rows.get(`${daily.name}:global`)?.hits).toBe(AI_MAX_STEPS_PER_REQUEST);

  await settleAiSteps(reservation!, 1, counters);
  expect(counters.rows.get(`${daily.name}:global`)?.hits).toBe(1);
  expect(counters.rows.get(`${daily.name}:user:user-a`)?.hits).toBe(1);
});

describe("reserveAiSteps — final-review findings", () => {
  // CRITICAL 1. `consumeQuota` returns before charging the global bucket for
  // exactly this reason (its own comment): an actor already over their own
  // ceiling is served nothing, so counting them globally would let one
  // abuser exhaust everyone else's headroom with requests that never
  // happened. At a 32-unit reservation instead of a 1-unit charge, bumping
  // global before checking the user ceiling is a 32x amplification of that
  // same DoS.
  it("does not touch the global bucket when the user ceiling alone refuses", async () => {
    const counters = fakeCounters();
    const policy: QuotaPolicy = { name: "steptest", windowMs: 60_000, perUser: 10, global: 1000 };
    // Already over the user ceiling before this call — the reservation's own
    // bump would push it further over regardless.
    await counters.bump(`${policy.name}:user:alice`, T0, 11);

    const { decision } = await reserveAiSteps([policy], "alice", counters, T0);
    expect(decision).toMatchObject({ allowed: false, reason: "user" });
    expect(counters.rows.get(`${policy.name}:global`)).toBeUndefined();
  });

  // IMPORTANT 3. `aiStepQuotas()` is [hourly, daily]. If hourly admits and
  // daily refuses, hourly's charge must not be stranded — unlike
  // `consumeQuota` (a 1-unit charge with no refund primitive), a refund
  // primitive now exists, so there is no excuse to leave a 32-unit hole with
  // no `StepReservation` left to settle it against.
  it("releases an earlier policy's charge when a later policy in the same reservation refuses", async () => {
    const counters = fakeCounters();
    const loose: QuotaPolicy = { name: "loose", windowMs: 60_000, perUser: 1000, global: 1000 };
    const tight: QuotaPolicy = { name: "tight", windowMs: 60_000, perUser: 1, global: 1000 };

    const { decision, reservation } = await reserveAiSteps([loose, tight], "alice", counters, T0);
    expect(decision).toMatchObject({ allowed: false, reason: "user" });
    expect(reservation).toBeNull();
    expect(counters.rows.get("loose:user:alice")?.hits ?? 0).toBe(0);
    expect(counters.rows.get("loose:global")?.hits ?? 0).toBe(0);
  });

  // Same shape, refused on the GLOBAL check of the SAME policy rather than a
  // later one — the just-bumped user AND global charges for that policy must
  // also come back, not just a previously committed policy's.
  it("releases the current policy's own charge when its global ceiling refuses", async () => {
    const counters = fakeCounters();
    const policy: QuotaPolicy = { name: "tight-global", windowMs: 60_000, perUser: 1000, global: 10 };

    const { decision, reservation } = await reserveAiSteps([policy], "alice", counters, T0);
    expect(decision).toMatchObject({ allowed: false, reason: "global" });
    expect(reservation).toBeNull();
    expect(counters.rows.get("tight-global:user:alice")?.hits ?? 0).toBe(0);
    expect(counters.rows.get("tight-global:global")?.hits ?? 0).toBe(0);
  });

  // IMPORTANT 4 (ruling). `AI_MAX_STEPS_PER_REQUEST` is a DEFENSIVE bound on a
  // bad caller, not a mirror of any real budget — reserving it against a
  // caller whose real per-request budget is much smaller (`/ask`'s
  // `MAX_ASK_STEPS = 8`) makes in-flight exposure 4x larger than any turn can
  // ever use. A caller that knows its real budget passes it explicitly.
  it("reserves the caller's own budget when given one, not the defensive default", async () => {
    const counters = fakeCounters();
    const policy: QuotaPolicy = { name: "budgettest", windowMs: 60_000, perUser: 1000, global: 1000 };

    const { decision, reservation } = await reserveAiSteps([policy], "alice", counters, T0, 8);
    expect(decision.allowed).toBe(true);
    expect(reservation!.reserved).toBe(8);
    expect(counters.rows.get("budgettest:user:alice")?.hits).toBe(8);
  });

  it("still defaults to AI_MAX_STEPS_PER_REQUEST for a caller that does not know its own budget", async () => {
    const counters = fakeCounters();
    const policy: QuotaPolicy = { name: "budgetdefault", windowMs: 60_000, perUser: 1000, global: 1000 };

    const { reservation } = await reserveAiSteps([policy], "alice", counters, T0);
    expect(reservation!.reserved).toBe(AI_MAX_STEPS_PER_REQUEST);
  });
});

describe("release", () => {
  it("release subtracts within the reserved window", async () => {
    const counters = fakeCounters();
    const w = new Date("2026-09-15T12:00:00.000Z");
    await counters.bump("b", w, 32);
    await counters.release("b", w, 30);
    expect(counters.rows.get("b")?.hits).toBe(2);
  });

  it("release does nothing once the window has rolled", async () => {
    const counters = fakeCounters();
    const w1 = new Date("2026-09-15T12:00:00.000Z");
    const w2 = new Date("2026-09-15T13:00:00.000Z");
    await counters.bump("b", w1, 32);
    await counters.bump("b", w2, 5); // window rolls; count restarts at 5
    await counters.release("b", w1, 30); // refund against the OLD window
    expect(counters.rows.get("b")?.hits).toBe(5);
  });

  it("release never drives a counter below zero", async () => {
    const counters = fakeCounters();
    const w = new Date("2026-09-15T12:00:00.000Z");
    await counters.bump("b", w, 3);
    await counters.release("b", w, 999);
    expect(counters.rows.get("b")?.hits).toBe(0);
  });

  it("release ignores a negative or fractional amount", async () => {
    const counters = fakeCounters();
    const w = new Date("2026-09-15T12:00:00.000Z");
    await counters.bump("b", w, 10);
    await counters.release("b", w, -5);
    await counters.release("b", w, 1.7);
    expect(counters.rows.get("b")?.hits).toBe(9); // -5 ignored, 1.7 truncated to 1
  });
});

// Three findings from CodeRabbit's review of PR #178, each pinned here.
describe("what a reservation settles and refuses (PR #178)", () => {
  it("settles a trusted zero as zero, so a request that reached no provider costs nothing", async () => {
    const policies = aiStepQuotas();
    const daily = dailyPolicy(policies);
    const counters = fakeCounters();
    const now = new Date("2026-09-15T12:00:00.000Z");

    const { decision, reservation } = await reserveAiSteps(policies, "alice", counters, now, 9);
    expect(decision.allowed).toBe(true);
    expect(counters.rows.get(`${daily.name}:global`)?.hits).toBe(9);

    // A page-scoped turn whose thread failed validation: no classifier, no
    // agent loop, zero round-trips. The old floor of 1 charged an allowance
    // for it, and the path is caller-controlled and repeatable.
    await settleAiSteps(reservation!, 0, counters);
    expect(counters.rows.get(`${daily.name}:global`)?.hits).toBe(0);
    expect(counters.rows.get(`${daily.name}:user:alice`)?.hits).toBe(0);
  });

  it("still settles the whole reservation when the step count is not a number", async () => {
    const policies = aiStepQuotas();
    const daily = dailyPolicy(policies);
    const counters = fakeCounters();
    const now = new Date("2026-09-15T12:00:00.000Z");

    const { reservation } = await reserveAiSteps(policies, "bob", counters, now, 9);
    // Unknown usage keeps the conservative charge — the opposite of a trusted
    // zero, and the reason the two cases are distinguished rather than merged.
    await settleAiSteps(reservation!, Number.NaN, counters);
    expect(counters.rows.get(`${daily.name}:global`)?.hits).toBe(9);
  });

  it("asks for a retry in a minute when the counter store fails, not at the end of the window", async () => {
    const broken: QuotaCounters = {
      async bump() {
        throw new Error("counter store down");
      },
      async release() {},
    };
    const { decision, reservation } = await reserveAiSteps(aiStepQuotas(), "carol", broken, new Date("2026-09-15T12:00:00.000Z"));
    expect(decision.allowed).toBe(false);
    expect(reservation).toBeNull();
    // A broken store is a transient fault, not a ceiling. The window remainder
    // would tell a client to wait out the rest of a day for a blip, and
    // `quotaRefusal` puts this straight into `Retry-After` on a 503.
    expect(decision).toEqual(expect.objectContaining({ reason: "unavailable", retryAfterSeconds: 60 }));
  });
});
