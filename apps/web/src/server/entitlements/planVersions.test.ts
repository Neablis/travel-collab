// Resolving a pinned version, and the one failure mode the committed-file move
// introduced (ADR-045 rule 3).
import { describe, expect, it } from "vitest";
import { PlanVersionRef } from "@tc/contracts";
import {
  PLAN_VERSIONS,
  UnknownPlanVersionError,
  isPublishedRef,
  livePlanVersion,
  planVersionFromRef,
  planVersionRefOf,
  priceLookupKey,
  versionsOf,
} from "./planVersions";

describe("plan versions", () => {
  it("publishes the launch plans, premium's second version, and the disabled fourth", () => {
    // **Order is publication history and this list is in file order**, which is
    // what `livePlanVersion` reads — so `premium@v2` sits after `premium@v1`
    // rather than beside it. Appending is the only edit this array ever takes.
    expect(PLAN_VERSIONS.map(planVersionRefOf)).toEqual([
      "free@v1",
      "plus@v1",
      "premium@v1",
      // **M22 Phase 1.** `premium@v2` adds `api.tokens` by being PUBLISHED, not
      // by `v1` being edited — `v1`'s entry above is byte-identical to the day
      // it shipped, which is the property `noExtension.test.ts` pins field by
      // field and a ticked M20 gate box asserts.
      "premium@v2",
      // The fourth-plan proof. Published, resolvable and typed — and disabled,
      // so nothing sells it and nobody holds it (M20's gate box).
      "studio@v1",
    ]);
    // `premium` appears twice because both its versions are enabled: `v1` is
    // still resolvable for anything pinned to it, it is simply never selected
    // again.
    expect(PLAN_VERSIONS.filter((entry) => entry.enabled).map((e) => e.planId)).toEqual([
      "free",
      "plus",
      "premium",
      "premium",
    ]);
  });

  it("mints a reference the contracts schema accepts", () => {
    for (const entry of PLAN_VERSIONS) {
      expect(PlanVersionRef.safeParse(planVersionRefOf(entry)).success).toBe(true);
    }
  });

  it("round-trips a reference back to the entry it pins", () => {
    for (const entry of PLAN_VERSIONS) {
      expect(planVersionFromRef(planVersionRefOf(entry))).toBe(entry);
    }
  });

  // **Loudly, and never a fall back to the newest.** Silently resolving to the
  // newest entry hands an account terms it never bought; silently resolving to
  // nothing looks like a downgrade nobody ordered. Both read as billing bugs.
  it("throws on a reference this deploy does not publish", () => {
    expect(() => planVersionFromRef("premium@v9")).toThrow(UnknownPlanVersionError);
    expect(() => planVersionFromRef("premium@v9")).toThrow(/not published in this deploy/);
    expect(() => planVersionFromRef("atelier@v1")).toThrow(UnknownPlanVersionError);
    expect(isPublishedRef("premium@v9")).toBe(false);
  });

  it("hands a new holding the newest published version of its plan", () => {
    // **The point of the append, and the reason publishing `v2` needed no other
    // edit anywhere**: `livePlanVersion` takes the last entry for the plan and
    // consults no `enabled` flag and no "current" marker. Adding `premium@v2`
    // made it what every new purchase and every new admin grant pins,
    // automatically.
    expect(planVersionRefOf(livePlanVersion("premium"))).toBe("premium@v2");
    expect(versionsOf("premium")).toHaveLength(2);
    // And `v1` did not go anywhere — it is still resolvable for anything
    // pinned to it, which is the whole of *what you bought is what you get*.
    expect(planVersionRefOf(versionsOf("premium")[0]!)).toBe("premium@v1");
  });

  // **The M22 entitlement, and the two properties that make it a publish rather
  // than an edit.** Written here rather than left to the diff because "v1 is
  // untouched" is the claim a later session is most likely to undo by accident.
  it("grants api.tokens on premium@v2 and on nothing else", () => {
    expect(planVersionFromRef("premium@v2").entitlements).toEqual([
      "ai.ask",
      "ai.command",
      "trip.collaborators",
      "api.tokens",
    ]);
    // `v1` never learned the word.
    expect(planVersionFromRef("premium@v1").entitlements).toEqual([
      "ai.ask",
      "ai.command",
      "trip.collaborators",
    ]);
    // And no other plan grants it — a membership fact about one plan, which is
    // the only shape a module with no ordering can express.
    for (const entry of PLAN_VERSIONS) {
      if (planVersionRefOf(entry) === "premium@v2") continue;
      expect(entry.entitlements, planVersionRefOf(entry)).not.toContain("api.tokens");
    }
  });

  // The price is the same $19, but the lookup key is derived from the ref, so
  // `v2` resolves to its own Stripe Price. Two versions sharing a Price is how
  // the catalogue and the card statement start to disagree.
  it("gives premium@v2 its own price identity at the same amount", () => {
    const v1 = planVersionFromRef("premium@v1");
    const v2 = planVersionFromRef("premium@v2");
    expect(v2.price).toEqual(v1.price);
    expect(priceLookupKey(v2)).not.toBe(priceLookupKey(v1));
  });

  // The launch table, stated once as behaviour rather than as shape. `free`
  // entitles trip planning in full — which is why its list is EMPTY: nothing
  // gates planning, so nothing needs to name it.
  it("grants what the milestone's launch table says", () => {
    expect(planVersionFromRef("free@v1").entitlements).toEqual([]);
    expect(planVersionFromRef("plus@v1").entitlements).toEqual(["ai.ask", "ai.command"]);
    expect(planVersionFromRef("premium@v1").entitlements).toEqual([
      "ai.ask",
      "ai.command",
      "trip.collaborators",
    ]);
  });

  // Per-user ceilings only. A global ceiling was never sold to anyone and stays
  // in the environment, so republishing a plan cannot move one.
  it("sells per-user daily ceilings and names no global one", () => {
    expect(planVersionFromRef("free@v1").ceilings).toEqual({
      perUserRequestsPerDay: 0,
      perUserStepsPerDay: 0,
      maxTier: null,
    });
    expect(planVersionFromRef("plus@v1").ceilings.perUserRequestsPerDay).toBe(50);
    expect(planVersionFromRef("premium@v1").ceilings.perUserStepsPerDay).toBe(1600);
    for (const entry of PLAN_VERSIONS) {
      expect(Object.keys(entry.ceilings).some((key) => /global|hour/i.test(key))).toBe(false);
    }
  });
});
