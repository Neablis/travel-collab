import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/client";
import { rateLimitCounters } from "./db/schema";
import { consumeQuota, pgCounters, type QuotaPolicy } from "./quota";

// What quota.test.ts cannot cover: the upsert itself. The whole design rests on
// `ON CONFLICT DO UPDATE ... RETURNING` being one atomic statement — an
// in-memory fake would count correctly no matter what the SQL did.
const POLICY: QuotaPolicy = { name: "int-test", windowMs: 60_000, perUser: 3, global: 5 };
const T0 = new Date("2026-08-28T12:00:00.000Z");

// Only this table: other int suites are seeding their own trips against the
// same database, and nothing here needs their rows gone.
beforeEach(async () => {
  await db.delete(rateLimitCounters);
});

describe("the Postgres counter", () => {
  it("counts one bucket up from one", async () => {
    const counters = pgCounters();
    expect(await counters.bump("a", T0)).toBe(1);
    expect(await counters.bump("a", T0)).toBe(2);
    expect(await counters.bump("a", T0)).toBe(3);
  });

  it("counts buckets independently", async () => {
    const counters = pgCounters();
    await counters.bump("a", T0);
    await counters.bump("a", T0);
    expect(await counters.bump("b", T0)).toBe(1);
  });

  // The reason this is a database counter and not a module-level Map: on Vercel
  // these calls land on different instances with no shared memory. Concurrent
  // bumps must each get a distinct number, or two parallel attacks each see "1".
  it("gives every concurrent bump a distinct count", async () => {
    const counters = pgCounters();
    const counts = await Promise.all(Array.from({ length: 10 }, () => counters.bump("race", T0)));
    expect([...counts].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("restarts at one when the window rolls forward, in the same row", async () => {
    const counters = pgCounters();
    await counters.bump("a", T0);
    await counters.bump("a", T0);
    expect(await counters.bump("a", new Date(T0.getTime() + 60_000))).toBe(1);
    expect(await db.select().from(rateLimitCounters)).toHaveLength(1);
  });

  // KI-67 gave `bump` an `amount`, so the upsert now has to carry a charge
  // bigger than one through both of its branches. These are the SQL half of
  // that; the policy half is in quota.test.ts.
  it("adds a multi-unit charge to an existing window", async () => {
    const counters = pgCounters();
    await counters.bump("a", T0);
    expect(await counters.bump("a", T0, 31)).toBe(32);
  });

  it("starts a NEW window at the charge, not at one", async () => {
    // The branch that discards the previous window must not also discard the
    // charge being applied — that would make a 32-step request free whenever it
    // happened to be the first of its window.
    const counters = pgCounters();
    await counters.bump("a", T0, 5);
    expect(await counters.bump("a", new Date(T0.getTime() + 60_000), 12)).toBe(12);
    expect(await db.select().from(rateLimitCounters)).toHaveLength(1);
  });

  it("refuses to let a caller decrement a counter", async () => {
    const counters = pgCounters();
    await counters.bump("a", T0, 10);
    expect(await counters.bump("a", T0, -5)).toBe(11);
  });

  // Skewed clocks across instances must not hand an attacker a free reset.
  it("never rewinds to an older window", async () => {
    const counters = pgCounters();
    await counters.bump("a", T0);
    await counters.bump("a", T0);
    expect(await counters.bump("a", new Date(T0.getTime() - 60_000))).toBe(3);
  });
});

describe("consumeQuota against a real database", () => {
  it("allows a normal single request", async () => {
    expect(await consumeQuota([POLICY], "solo", pgCounters(), T0)).toEqual({ allowed: true });
  });

  it("refuses the request after the per-user ceiling", async () => {
    const counters = pgCounters();
    for (let i = 0; i < POLICY.perUser; i += 1) {
      expect(await consumeQuota([POLICY], "alice", counters, T0)).toEqual({ allowed: true });
    }
    expect(await consumeQuota([POLICY], "alice", counters, T0)).toMatchObject({
      allowed: false,
      reason: "user",
    });
    // …and someone else is unaffected by it.
    expect(await consumeQuota([POLICY], "bob", counters, T0)).toEqual({ allowed: true });
  });
});
