// The quota's claim is universally quantified — "for ANY sequence of requests
// from ANY set of actors inside one window, no actor is served more than
// `perUser` and the deployment serves no more than `global`" — so it gets a
// property test rather than a handful of counted-up examples (AGENTS.md's
// testing model). The example tests in quota.test.ts pin the specific
// behaviours; this pins the bound itself.
//
// Safety AND liveness, because a limiter that refuses everything satisfies the
// safety half perfectly and is useless: a sequence short enough that no ceiling
// could be reached must be served in full.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { consumeQuota, type QuotaCounters, type QuotaPolicy } from "./quota";
import { witness } from "@/test-support/witness";

const T0 = new Date("2026-08-28T12:00:00.000Z");

function fakeCounters(): QuotaCounters {
  const rows = new Map<string, { windowStart: number; hits: number }>();
  return {
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

const USERS = ["alice", "bob", "carol", "dave"];

const scenario = fc.record({
  perUser: fc.integer({ min: 1, max: 8 }),
  global: fc.integer({ min: 1, max: 20 }),
  requests: fc.array(fc.constantFrom(...USERS), { minLength: 1, maxLength: 40 }),
});

describe("the quota bound holds for any request sequence", () => {
  it("never serves an actor past perUser, never serves the deployment past global, and never resets mid-window", async () => {
    const w = witness("quota bound");
    // The liveness half sits behind a guard, which is the exact shape that goes
    // vacuous silently — it gets its own count.
    const live = witness("quota liveness");
    await fc.assert(
      fc.asyncProperty(scenario, async ({ perUser, global, requests }) => {
        const policy: QuotaPolicy = { name: "prop", windowMs: 60_000, perUser, global };
        const counters = fakeCounters();
        const allowedPerUser = new Map<string, number>();
        const refusedAlready = new Set<string>();
        let allowedTotal = 0;

        for (const user of requests) {
          const decision = await consumeQuota([policy], user, counters, T0);
          if (decision.allowed) {
            // A refusal is final for the rest of the window: nothing an actor
            // does may hand them a fresh allowance before the window rolls.
            expect(refusedAlready.has(user)).toBe(false);
            allowedPerUser.set(user, (allowedPerUser.get(user) ?? 0) + 1);
            allowedTotal += 1;
          } else {
            refusedAlready.add(user);
          }
          expect(allowedPerUser.get(user) ?? 0).toBeLessThanOrEqual(perUser);
          expect(allowedTotal).toBeLessThanOrEqual(global);
          w.tick();
        }

        // Liveness: a sequence shorter than both ceilings cannot have reached
        // either (one actor's count is bounded by the total), so every one of
        // its requests must have been served.
        if (requests.length <= Math.min(global, perUser)) {
          expect(allowedTotal).toBe(requests.length);
          live.tick();
        }
      }),
      { numRuns: 300 },
    );
    // Floors at ~half the observed minimum, measured over three runs rather
    // than guessed: 1,837-1,911 bound assertions and 89-105 liveness cases.
    w.atLeast(900);
    live.atLeast(45);
  });
});
