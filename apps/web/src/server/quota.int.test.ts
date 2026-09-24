import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "./db/client";
import { rateLimitCounters } from "./db/schema";
import { consumeQuota, pgCounters, type QuotaPolicy } from "./quota";
import { referenceCounters } from "@/server/test-support/quotaCounters";
import { witness } from "@/test-support/witness";

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

// KI-2026-09-15-a. `release` is the only path that can DECREASE a counter, and
// until these tests its two guards were proven only transitively, through
// route.int.test.ts's refund assertions. The in-memory fakes agree with the SQL
// on both guards, and that agreement is what makes the unit tests meaningful —
// but nothing enforced it: widening `eq` to `gte`, or dropping
// `greatest(..., 0)`, left every quota suite green (measured 2026-09-24).
async function rowOf(bucket: string): Promise<{ windowStart: number; hits: number } | undefined> {
  const [row] = await db.select().from(rateLimitCounters).where(eq(rateLimitCounters.bucket, bucket));
  return row === undefined ? undefined : { windowStart: row.windowStart.getTime(), hits: row.hits };
}

describe("the Postgres refund", () => {
  const T1 = new Date(T0.getTime() + 60_000);

  it("subtracts from the window it reserved in", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 32);
    await counters.release(key("a"), T0, 30);
    expect(await rowOf(key("a"))).toEqual({ windowStart: T0.getTime(), hits: 2 });
  });

  // The window guard. The row is one-per-bucket forever, so after a roll it
  // holds the NEW window's count — usage this refund never charged. `>=` here
  // would let a turn that straddled the boundary refund someone else's usage.
  it("leaves a rolled window alone: a refund against the window before is a no-op", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 32);
    await counters.bump(key("a"), T1, 5);
    await counters.release(key("a"), T0, 30);
    expect(await rowOf(key("a"))).toEqual({ windowStart: T1.getTime(), hits: 5 });
  });

  // The other side of the same `=`: a refund stamped with a LATER window than
  // the row's (a skewed instance) charged nothing here and must not subtract.
  it("leaves the row alone for a refund stamped with a later window", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 10);
    await counters.release(key("a"), T1, 4);
    expect(await rowOf(key("a"))).toEqual({ windowStart: T0.getTime(), hits: 10 });
  });

  it("floors an over-large refund at zero rather than going negative", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 3);
    await counters.release(key("a"), T0, 999);
    expect(await rowOf(key("a"))).toEqual({ windowStart: T0.getTime(), hits: 0 });
  });

  // Why the floor is computed in SQL, in the same statement as the subtraction:
  // a read-then-write refund loses updates under concurrency, and a JS-side
  // floor floors a stale read. Ten concurrent refunds of one from ten must land
  // at exactly zero, and ten over-large ones must still land at zero.
  it("applies concurrent refunds atomically and never below zero", async () => {
    const counters = pgCounters();
    await counters.bump(key("race"), T0, 10);
    await Promise.all(Array.from({ length: 10 }, () => counters.release(key("race"), T0, 1)));
    expect(await rowOf(key("race"))).toEqual({ windowStart: T0.getTime(), hits: 0 });

    await counters.bump(key("race2"), T0, 5);
    await Promise.all(Array.from({ length: 10 }, () => counters.release(key("race2"), T0, 3)));
    expect(await rowOf(key("race2"))).toEqual({ windowStart: T0.getTime(), hits: 0 });
  });

  it("does not create a row for a bucket that was never charged", async () => {
    await pgCounters().release(key("never"), T0, 5);
    expect(await rowOf(key("never"))).toBeUndefined();
  });

  it("ignores a negative, zero or non-finite amount and truncates a fractional one", async () => {
    const counters = pgCounters();
    await counters.bump(key("a"), T0, 10);
    await counters.release(key("a"), T0, -5);
    await counters.release(key("a"), T0, 0);
    await counters.release(key("a"), T0, Number.NaN);
    await counters.release(key("a"), T0, Number.POSITIVE_INFINITY);
    await counters.release(key("a"), T0, 1.7);
    expect(await rowOf(key("a"))).toEqual({ windowStart: T0.getTime(), hits: 9 });
  });
});

// ---------------------------------------------------------------------------
// The SQL and the reference semantics agree, for ANY bump/release sequence
// ---------------------------------------------------------------------------

// `referenceCounters` (test-support/quotaCounters.ts) is the model the reserve/
// settle property in quota.property.test.ts runs on. This property drives it
// and `pgCounters` through one generated sequence and requires them to agree
// after every operation — which is what makes that property one about the real
// SQL, and closes the fake-vs-real divergence as a class rather than as the
// cases above: a change to either `release` guard, or to `bump`'s window
// rules, that the model does not also make fails here.

// Four adjacent windows, so a sequence can roll forward, step back (a skewed
// clock), and refund against any window — including one the row has left.
const WINDOWS = [-1, 0, 1, 2].map((i) => new Date(T0.getTime() + i * 60_000));
// Refunds range wider than charges, so a refund larger than the row's count —
// the shape the floor exists for — is common rather than rare.
const arbAmount = (max: number) =>
  fc.oneof(
    fc.integer({ min: -5, max }),
    fc.double({ min: -5, max, noNaN: true }),
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY),
  );
const arbWindow = fc.integer({ min: 0, max: WINDOWS.length - 1 });
const arbOp = fc.oneof(
  fc.record({ kind: fc.constant("bump" as const), window: arbWindow, amount: arbAmount(20) }),
  fc.record({ kind: fc.constant("release" as const), window: arbWindow, amount: arbAmount(60) }),
);

describe("pgCounters agrees with the reference semantics", () => {
  it("returns the same count and leaves the same row after every bump and release, for any sequence", async () => {
    const w = witness("pg vs reference, per operation");
    // The guards only bite on specific shapes; count those, so the property
    // cannot pass having never generated one.
    const rolledRefund = witness("a refund against a window the row is not in");
    const flooredRefund = witness("a refund larger than the count");
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 12 }), async (ops) => {
        run += 1;
        // A fresh bucket per run (fast-check also re-runs while shrinking), so
        // no run inherits another's row. All under this test's prefix, so
        // `afterEach` removes every one.
        const bucket = key(`diff-${run}`);
        const real = pgCounters();
        const model = referenceCounters();
        for (const op of ops) {
          const windowStart = WINDOWS[op.window]!;
          if (op.kind === "bump") {
            expect(await real.bump(bucket, windowStart, op.amount)).toBe(
              await model.bump(bucket, windowStart, op.amount),
            );
          } else {
            const before = model.rows.get(bucket);
            if (before !== undefined && before.hits > 0 && Number.isFinite(op.amount) && Math.trunc(op.amount) > 0) {
              if (before.windowStart !== windowStart.getTime()) rolledRefund.tick();
              else if (Math.trunc(op.amount) > before.hits) flooredRefund.tick();
            }
            await real.release(bucket, windowStart, op.amount);
            await model.release(bucket, windowStart, op.amount);
          }
          expect(await rowOf(bucket)).toEqual(model.rows.get(bucket));
          w.tick();
        }
      }),
      { numRuns: 150 },
    );
    // Floors at ~half the observed minimum over five runs (2026-09-24):
    // 840-970 operations, 51-82 refunds against another window, 16-26 refunds
    // larger than the count. ~2.5s for the whole file.
    w.atLeast(400);
    rolledRefund.atLeast(25);
    flooredRefund.atLeast(8);
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
