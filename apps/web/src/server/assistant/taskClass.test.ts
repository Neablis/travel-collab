// The routing table, and the two directions in it that are easy to get
// backwards.
//
// Tiering is the one part of P5 with no natural loud failure: a `plan` routed
// to a cheap model still answers, just worse, and nothing in a log line says
// so. So the table is pinned as data and the two `min`/`max` decisions are
// pinned separately, because each reads as harmless spelled the other way
// round.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { witness } from "@/test-support/witness";
import {
  capTier,
  MODEL_TIERS,
  strongerTier,
  TASK_CLASSES,
  tierFor,
  type ModelTier,
  type TaskClass,
} from "./taskClass";

describe("a task class picks a tier", () => {
  // Spec §5's table, as the table. Written out rather than derived from the
  // implementation, which is the F-F02 mistake: a test that asserts a switch
  // against itself is a second copy of the switch.
  it.each([
    ["question", "cheap"],
    ["edit", "mid"],
    ["plan", "strong"],
    ["compose", "mid"],
  ] as [TaskClass, ModelTier][])("routes %s to the %s tier", (taskClass, tier) => {
    expect(tierFor(taskClass)).toBe(tier);
  });

  // A class with no row would resolve `undefined` and hand the agent no model
  // at all — a 500 on a turn that was fully admitted.
  it("has a row for every class there is", () => {
    for (const taskClass of TASK_CLASSES) {
      expect(MODEL_TIERS).toContain(tierFor(taskClass));
    }
  });

  // **The cheapest tier is reachable, and it is the one questions get.** The
  // whole saving §5 claims rests on this one row: questions are most turns, and
  // routing them anywhere else buys nothing. A table where every row said
  // `strong` would satisfy every other assertion in this file.
  it("sends questions, and only questions, to the cheapest tier", () => {
    const cheap = TASK_CLASSES.filter((taskClass) => tierFor(taskClass) === "cheap");
    expect(cheap).toEqual(["question"]);
  });
});

describe("uncertainty resolves upward", () => {
  // The bias `askIntent` already applies, on the tier axis: a misrouted `plan`
  // on a cheap model is a quality regression, and the cheap direction is the one
  // that hurts. `min` here would be silently wrong — every assertion about a
  // single tier would still pass.
  it("takes the stronger of two tiers, for any pair", () => {
    const w = witness("stronger tier");
    fc.assert(
      fc.property(fc.constantFrom(...MODEL_TIERS), fc.constantFrom(...MODEL_TIERS), (a, b) => {
        const picked = strongerTier(a, b);
        expect([a, b]).toContain(picked);
        expect(MODEL_TIERS.indexOf(picked)).toBeGreaterThanOrEqual(MODEL_TIERS.indexOf(a));
        expect(MODEL_TIERS.indexOf(picked)).toBeGreaterThanOrEqual(MODEL_TIERS.indexOf(b));
        w.tick();
      }),
      { numRuns: 200 },
    );
    // No guard clause, so this ticks exactly `numRuns`.
    w.atLeast(200);
  });

  it("prefers strong over cheap whichever way round it is asked", () => {
    expect(strongerTier("cheap", "strong")).toBe("strong");
    expect(strongerTier("strong", "cheap")).toBe("strong");
  });
});

describe("an entitlement caps the tier a class proposed", () => {
  // The default, and the reason behaviour is unchanged: no plan names a cap
  // today, so every turn runs on the tier its class proposed.
  it("leaves the proposal alone when no ceiling is named", () => {
    for (const tier of MODEL_TIERS) expect(capTier(tier, null)).toBe(tier);
  });

  // **A cap, never a floor.** This is the one place the arithmetic has to run
  // the other way from `strongerTier` above, and getting it backwards would
  // UPGRADE a free account to the strongest model instead of holding it down —
  // the failure that costs money rather than quality.
  it("never returns a stronger tier than the ceiling permits", () => {
    const w = witness("capped tier");
    const bound = witness("ceiling actually bound the proposal");
    fc.assert(
      fc.property(fc.constantFrom(...MODEL_TIERS), fc.constantFrom(...MODEL_TIERS), (proposed, ceiling) => {
        const picked = capTier(proposed, ceiling);
        expect(MODEL_TIERS.indexOf(picked)).toBeLessThanOrEqual(MODEL_TIERS.indexOf(ceiling));
        expect(MODEL_TIERS.indexOf(picked)).toBeLessThanOrEqual(MODEL_TIERS.indexOf(proposed));
        w.tick();
        if (MODEL_TIERS.indexOf(ceiling) < MODEL_TIERS.indexOf(proposed)) bound.tick();
      }),
      { numRuns: 200 },
    );
    // Floors measured over three runs: the unguarded assertion ticks exactly
    // `numRuns`; a ceiling that actually bit was observed 53-77, so ~half its minimum.
    w.atLeast(200);
    bound.atLeast(26);
  });
});
