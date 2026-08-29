import { describe, expect, it, vi } from "vitest";
import {
  aiQuotas,
  consumeQuota,
  geocodeQuota,
  quotaRefusal,
  type QuotaCounters,
  type QuotaPolicy,
} from "./quota";

// A counter store with the same fixed-window semantics as the Postgres one,
// in memory. The SQL that makes this atomic across instances is covered by
// quota.int.test.ts; what is under test here is the policy logic on top of it.
function fakeCounters(): QuotaCounters & { rows: Map<string, { windowStart: number; hits: number }> } {
  const rows = new Map<string, { windowStart: number; hits: number }>();
  return {
    rows,
    async bump(bucket, windowStart) {
      const existing = rows.get(bucket);
      const next =
        existing === undefined || windowStart.getTime() > existing.windowStart
          ? { windowStart: windowStart.getTime(), hits: 1 }
          : { windowStart: existing.windowStart, hits: existing.hits + 1 };
      rows.set(bucket, next);
      return next.hits;
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
    const broken: QuotaCounters = { bump: vi.fn(async () => { throw new Error("db down"); }) };
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
