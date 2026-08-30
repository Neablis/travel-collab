import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { db } from "./db/client";
import { rateLimitCounters } from "./db/schema";
import { consumeQuota, pgCounters, type QuotaPolicy } from "./quota";

// What quota.test.ts cannot cover: the upsert itself. The whole design rests on
// `ON CONFLICT DO UPDATE ... RETURNING` being one atomic statement — an
// in-memory fake would count correctly no matter what the SQL did.
const T0 = new Date("2026-08-28T12:00:00.000Z");

// KI-69. This file had no ids to scope to: every bucket key was a literal
// ("a", "b", "race", and the `int-test:user:*` / `int-test:global` keys the
// policy name composes), and `rate_limit_counters.bucket` is the primary key
// with one row per bucket *forever* — not one per window. So every count
// assertion here required those exact rows to be absent, and the only way to
// guarantee that was `db.delete(rateLimitCounters)` with no `where`: every
// rate-limit row in the database, including a developer's own. That is the
// sharpest row in the schema to drop by accident, because a stale counter
// throttles someone with no visible cause.
//
// The fix is to invent the ids the file was missing. Each test gets a fresh
// key prefix, so its buckets cannot collide with another test's, another
// suite's, a previous run's, or a real deployment's — and cleanup becomes a
// `LIKE` on that prefix, which touches only rows this test created.
//
// The prefix must reach the policy name too, not just the raw bucket strings:
// `consumeQuota` composes `<name>:user:<id>` and a shared `<name>:global`, and
// the global ceiling of 5 is tight enough that two tests sharing it would push
// the last assertion from `reason: "user"` to `reason: "global"`.
let keyPrefix = "";
const policy = (): QuotaPolicy => ({
  name: `${keyPrefix}int-test`,
  windowMs: 60_000,
  perUser: 3,
  global: 5,
});
// A bucket key for a raw `counters.bump` call, scoped to this test.
const key = (name: string) => `${keyPrefix}${name}`;

beforeEach(() => {
  // No `%` or `_` in a UUID, so this is a safe LIKE prefix.
  keyPrefix = `int-test-${randomUUID()}:`;
});

afterEach(async () => {
  await db.delete(rateLimitCounters).where(like(rateLimitCounters.bucket, `${keyPrefix}%`));
});

describe("the Postgres counter", () => {
  it("counts one bucket up from one", async () => {
    const counters = pgCounters();
    expect(await counters.bump(key("a"), T0)).toBe(1);
    expect(await counters.bump(key("a"), T0)).toBe(2);
    expect(await counters.bump(key("a"), T0)).toBe(3);
  });

  it("counts buckets independently", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0);
    await counters.bump(key("a"), T0);
    expect(await counters.bump(key("b"), T0)).toBe(1);
  });

  // The reason this is a database counter and not a module-level Map: on Vercel
  // these calls land on different instances with no shared memory. Concurrent
  // bumps must each get a distinct number, or two parallel attacks each see "1".
  it("gives every concurrent bump a distinct count", async () => {
    const counters = pgCounters();
    const counts = await Promise.all(Array.from({ length: 10 }, () => counters.bump(key("race"), T0)));
    expect([...counts].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("restarts at one when the window rolls forward, in the same row", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0);
    await counters.bump(key("a"), T0);
    expect(await counters.bump(key("a"), new Date(T0.getTime() + 60_000))).toBe(1);
    // "in the same row" is the claim, so the row count is the assertion — but
    // counted over this test's own buckets, not the whole table. Unscoped, this
    // read asserted that the entire database held exactly one rate-limit
    // counter, which any real deployment's `ai-hourly:global` row would break.
    const rows = await db
      .select()
      .from(rateLimitCounters)
      .where(like(rateLimitCounters.bucket, `${keyPrefix}%`));
    expect(rows).toHaveLength(1);
  });

  // KI-67 gave `bump` an `amount`, so the upsert now has to carry a charge
  // bigger than one through both of its branches. These are the SQL half of
  // that; the policy half is in quota.test.ts.
  it("adds a multi-unit charge to an existing window", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0);
    expect(await counters.bump(key("a"), T0, 31)).toBe(32);
  });

  it("starts a NEW window at the charge, not at one", async () => {
    // The branch that discards the previous window must not also discard the
    // charge being applied — that would make a 32-step request free whenever it
    // happened to be the first of its window.
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 5);
    expect(await counters.bump(key("a"), new Date(T0.getTime() + 60_000), 12)).toBe(12);
    // Scoped to this test's own buckets, for the reason the sibling test above
    // spells out: unscoped, this asserted the whole database held exactly one
    // rate-limit counter.
    const rows = await db
      .select()
      .from(rateLimitCounters)
      .where(like(rateLimitCounters.bucket, `${keyPrefix}%`));
    expect(rows).toHaveLength(1);
  });

  it("refuses to let a caller decrement a counter", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 10);
    expect(await counters.bump(key("a"), T0, -5)).toBe(11);
  });

  // Skewed clocks across instances must not hand an attacker a free reset.
  it("never rewinds to an older window", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0);
    await counters.bump(key("a"), T0);
    expect(await counters.bump(key("a"), new Date(T0.getTime() - 60_000))).toBe(3);
  });
});

describe("consumeQuota against a real database", () => {
  it("allows a normal single request", async () => {
    expect(await consumeQuota([policy()], "solo", pgCounters(), T0)).toEqual({ allowed: true });
  });

  it("refuses the request after the per-user ceiling", async () => {
    const counters = pgCounters();
    for (let i = 0; i < policy().perUser; i += 1) {
      expect(await consumeQuota([policy()], "alice", counters, T0)).toEqual({ allowed: true });
    }
    expect(await consumeQuota([policy()], "alice", counters, T0)).toMatchObject({
      allowed: false,
      reason: "user",
    });
    // …and someone else is unaffected by it.
    expect(await consumeQuota([policy()], "bob", counters, T0)).toEqual({ allowed: true });
  });
});
