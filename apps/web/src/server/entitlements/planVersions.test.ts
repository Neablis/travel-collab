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
  versionsOf,
} from "./planVersions";

describe("plan versions", () => {
  it("publishes v1 of the three launch plans, and the disabled fourth", () => {
    expect(PLAN_VERSIONS.map(planVersionRefOf)).toEqual([
      "free@v1",
      "plus@v1",
      "premium@v1",
      // The fourth-plan proof. Published, resolvable and typed — and disabled,
      // so nothing sells it and nobody holds it (M20's gate box).
      "studio@v1",
    ]);
    expect(PLAN_VERSIONS.filter((entry) => entry.enabled).map((e) => e.planId)).toEqual([
      "free",
      "plus",
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
    expect(planVersionRefOf(livePlanVersion("premium"))).toBe("premium@v1");
    expect(versionsOf("premium")).toHaveLength(1);
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
