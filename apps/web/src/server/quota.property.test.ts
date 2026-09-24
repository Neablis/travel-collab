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
import {
  aiQuotas,
  aiStepQuotas,
  consumeQuota,
  reserveAiSteps,
  settleAiSteps,
  type QuotaPolicy,
  type StepReservation,
} from "./quota";
import { referenceCounters } from "@/server/test-support/quotaCounters";
import { witness } from "@/test-support/witness";
import type { EntitlementCeilings } from "./assistant/entitlements";

const T0 = new Date("2026-08-28T12:00:00.000Z");

// The counter model is shared with quota.int.test.ts, which proves it agrees
// with `pgCounters` on every bump and release (KI-2026-09-15-a). This file used
// to carry its own fake whose `release` was a no-op, which is why the refund
// path had no property coverage at all.
const fakeCounters = referenceCounters;

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

// ---------------------------------------------------------------------------
// Reserve → settle: every counter holds exactly the net charge of its window
// ---------------------------------------------------------------------------

/**
 * KI-2026-09-15-a. `release` is the only path that decreases a counter, and it
 * is reached two ways: `reserveAiSteps` rolling back a refused attempt, and
 * `settleAiSteps` refunding what a turn did not use. The claim is universally
 * quantified — for ANY interleaving of reservations and settlements, across
 * actors, while the clock crosses window boundaries of two policies with
 * different lengths — so it is a property:
 *
 * 1. **Exact accounting.** Every counter row holds exactly the sum, over the
 *    ADMITTED reservations stamped with that row's current window, of the full
 *    budget if still in flight or the steps used if settled. A refused attempt
 *    contributes nothing (its rollback is complete, including a policy earlier
 *    in the array that had already admitted). A settlement whose window has
 *    rolled contributes nothing to the new window — the `=` guard, observed
 *    through the whole reserve/settle path rather than one call.
 * 2. **Never negative, never over a ceiling.**
 * 3. **Admission is exact**, in both directions: a reservation is admitted iff
 *    its budget fits under every ceiling in its window. The safety half alone
 *    is satisfied by refusing everything.
 *
 * The counter model is the one quota.int.test.ts proves agrees with the SQL.
 */
const SHORT_MS = 60_000;
const LONG_MS = 180_000;
const STEP_USERS = ["alice", "bob", "carol"];

const arbStepPolicy = (name: string, windowMs: number) =>
  fc
    .integer({ min: 8, max: 60 })
    .chain((perUser) =>
      fc.integer({ min: perUser, max: perUser * 3 }).map((global): QuotaPolicy => ({ name, windowMs, perUser, global })),
    );

const arbStepOp = fc.oneof(
  fc.record({
    kind: fc.constant("reserve" as const),
    user: fc.constantFrom(...STEP_USERS),
    advanceMs: fc.integer({ min: 0, max: 70_000 }),
  }),
  fc.record({
    kind: fc.constant("settle" as const),
    pick: fc.nat(),
    // Past the budget on purpose: an over-report must clamp to the budget.
    steps: fc.integer({ min: 0, max: 15 }),
    advanceMs: fc.integer({ min: 0, max: 70_000 }),
  }),
);

const stepScenario = fc.record({
  short: arbStepPolicy("steps-short", SHORT_MS),
  long: arbStepPolicy("steps-long", LONG_MS),
  budget: fc.integer({ min: 1, max: 12 }),
  ops: fc.array(arbStepOp, { minLength: 1, maxLength: 40 }),
});

const windowOf = (policy: QuotaPolicy, at: number) => Math.floor(at / policy.windowMs) * policy.windowMs;

describe("reserve and settle keep every counter at its exact net charge", () => {
  it("for any interleaving of reservations and settlements across window boundaries", async () => {
    const w = witness("reserve/settle accounting");
    const admitted = witness("an admitted reservation");
    const refused = witness("a refused reservation (the rollback path)");
    const refunded = witness("a settlement refunding into its own window");
    const rolled = witness("a settlement whose window had rolled");

    await fc.assert(
      fc.asyncProperty(stepScenario, async ({ short, long, budget, ops }) => {
        const policies = [short, long];
        const counters = fakeCounters();
        const ledger: { user: string; reservation: StepReservation; used: number | null }[] = [];
        let now = T0.getTime();

        const expectedFor = (policy: QuotaPolicy, user: string | null, windowStart: number): number =>
          ledger
            .filter((entry) => user === null || entry.user === user)
            .filter((entry) => entry.reservation.windowStarts.get(policy.name)?.getTime() === windowStart)
            .reduce((sum, entry) => sum + (entry.used ?? budget), 0);

        const currentCount = (bucket: string, at: number, policy: QuotaPolicy): number => {
          const row = counters.rows.get(bucket);
          return row !== undefined && row.windowStart === windowOf(policy, at) ? row.hits : 0;
        };

        for (const op of ops) {
          now += op.advanceMs;
          if (op.kind === "reserve") {
            const fits = policies.every(
              (policy) =>
                currentCount(`${policy.name}:user:${op.user}`, now, policy) + budget <= policy.perUser &&
                currentCount(`${policy.name}:global`, now, policy) + budget <= policy.global,
            );
            const { decision, reservation } = await reserveAiSteps(
              policies,
              op.user,
              counters,
              new Date(now),
              budget,
            );
            expect(decision.allowed).toBe(fits);
            if (decision.allowed) {
              expect(reservation).not.toBeNull();
              ledger.push({ user: op.user, reservation: reservation!, used: null });
              admitted.tick();
            } else {
              expect(reservation).toBeNull();
              refused.tick();
            }
          } else {
            const pending = ledger.filter((entry) => entry.used === null);
            if (pending.length === 0) continue;
            const entry = pending[op.pick % pending.length]!;
            const used = Math.min(op.steps, budget);
            if (used < budget) {
              const inWindow = policies.some(
                (policy) =>
                  counters.rows.get(`${policy.name}:user:${entry.user}`)?.windowStart ===
                  entry.reservation.windowStarts.get(policy.name)?.getTime(),
              );
              const anyRolled = policies.some(
                (policy) =>
                  counters.rows.get(`${policy.name}:user:${entry.user}`)?.windowStart !==
                  entry.reservation.windowStarts.get(policy.name)?.getTime(),
              );
              if (inWindow) refunded.tick();
              if (anyRolled) rolled.tick();
            }
            await settleAiSteps(entry.reservation, op.steps, counters);
            entry.used = used;
          }

          for (const [bucket, row] of counters.rows) {
            const [name, scope, user] = bucket.split(":");
            const policy = policies.find((candidate) => candidate.name === name)!;
            expect(policy).toBeDefined();
            expect(row.hits).toBeGreaterThanOrEqual(0);
            if (scope === "global") {
              expect(row.hits).toBe(expectedFor(policy, null, row.windowStart));
              expect(row.hits).toBeLessThanOrEqual(policy.global);
            } else {
              expect(row.hits).toBe(expectedFor(policy, user!, row.windowStart));
              expect(row.hits).toBeLessThanOrEqual(policy.perUser);
            }
          }
          w.tick();
        }
      }),
      { numRuns: 300 },
    );
    // Floors at ~half the observed minimum over five runs (2026-09-24): 1,365-
    // 1,436 checked steps, 809-864 admitted, 90-147 refused, 133-183 in-window
    // refunds, 16-28 settlements after a roll.
    w.atLeast(650);
    admitted.atLeast(400);
    refused.atLeast(45);
    refunded.atLeast(65);
    rolled.atLeast(8);
  });
});

// ---------------------------------------------------------------------------
// The bucket name is not a function of the tier
// ---------------------------------------------------------------------------

/**
 * **The hole this closes, stated as the attack.** `QuotaPolicy.name` is
 * documented *"Bucket namespace. Must be stable — changing it resets everyone's
 * count"*, and `consumeQuota` keys its counters `${name}:user:${userId}`. So a
 * bucket name that varied with the plan would hand every account a fresh
 * allowance on every upgrade AND every downgrade: switch plan, get a new
 * bucket, start at zero, switch back, start at zero again. Anyone who could
 * toggle a plan could farm unlimited free calls, and nothing in the counter
 * table would look wrong.
 *
 * M20 link 5 therefore says *"the bucket `name` must not vary by tier… only the
 * numbers move"*, and this is the universally-quantified form of that: for ANY
 * ceilings a plan version could name, the four bucket names are the same four
 * literals.
 */
const arbCeilings: fc.Arbitrary<EntitlementCeilings> = fc.record({
  perUserRequestsPerDay: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
  perUserStepsPerDay: fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: null }),
  maxTier: fc.option(fc.constantFrom("cheap" as const, "mid" as const, "strong" as const), { nil: null }),
});

const BUCKET_NAMES = ["ai-hourly", "ai-daily", "ai-steps-hourly", "ai-steps-daily"];

describe("tiered ceilings move numbers and never bucket names", () => {
  it("names the same four buckets for any ceilings a plan version could name", () => {
    const w = witness("bucket names pinned");
    // The guard that could go vacuous: if every generated ceiling were `null`,
    // this would only ever compare the default policies with themselves and
    // would pass having exercised nothing the parameter added.
    const moved = witness("a per-user ceiling actually moved");

    fc.assert(
      fc.property(arbCeilings, (ceilings) => {
        const policies = [...aiQuotas(ceilings), ...aiStepQuotas(ceilings)];
        const baseline = [...aiQuotas(), ...aiStepQuotas()];

        expect(policies.map((policy) => policy.name)).toEqual(BUCKET_NAMES);
        // Stronger than equality against the baseline, and deliberately so: a
        // name is only safe if it is a literal, so nothing derived from the
        // ceilings may appear in it at all.
        for (const policy of policies) {
          expect(policy.name).toMatch(/^ai(-steps)?-(hourly|daily)$/);
        }
        // The GLOBAL ceiling is the operator's abuse bound and was never sold
        // to anyone, so no plan may move it either.
        expect(policies.map((policy) => policy.global)).toEqual(baseline.map((policy) => policy.global));

        // **WHICH bucket each sold ceiling binds, pinned by name.** This
        // describe's title promises two halves and only the name half was
        // asserted: "some `perUser` differs from baseline" is satisfied by an
        // implementation that swapped the two daily ceilings, or that applied
        // the request entitlement to the HOURLY bucket, which is a different
        // product than the one being sold.
        //
        // It is also the readable answer to an open question. A sold ceiling
        // binds a DAY here — the numbers come from M20's plan table, whose
        // columns are per-day — and neither M20 nor the kernel spec states it
        // in prose (spec, "Open questions"). Pinning the mapping in a test is
        // what makes that reading explicit and reviewable rather than implicit
        // in two `??`s.
        const perUser = Object.fromEntries(policies.map((policy) => [policy.name, policy.perUser]));
        const base = Object.fromEntries(baseline.map((policy) => [policy.name, policy.perUser]));
        expect(perUser["ai-daily"]).toBe(ceilings.perUserRequestsPerDay ?? base["ai-daily"]);
        expect(perUser["ai-steps-daily"]).toBe(ceilings.perUserStepsPerDay ?? base["ai-steps-daily"]);
        // The hourly windows are the OPERATOR's burst control, configured by
        // environment and sold to nobody, so no plan may move either one.
        expect(perUser["ai-hourly"]).toBe(base["ai-hourly"]);
        expect(perUser["ai-steps-hourly"]).toBe(base["ai-steps-hourly"]);
        w.tick();

        if (policies.some((policy, i) => policy.perUser !== baseline[i]!.perUser)) moved.tick();
      }),
      { numRuns: 300 },
    );

    // Floors measured over three runs rather than guessed: the pinned-name
    // assertion has no guard and ticks exactly `numRuns`; a ceiling that
    // actually moved a number was observed 287-293, so its floor is ~half.
    w.atLeast(300);
    moved.atLeast(140);
  });
});
