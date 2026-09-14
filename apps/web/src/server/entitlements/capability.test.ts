// `can()` and the union — the only two readings of an entitlement set.
import { describe, expect, it } from "vitest";
import { can, entitlementSet, unionEntitlements } from "./capability";

describe("can()", () => {
  it("answers membership and nothing else", () => {
    const ent = entitlementSet(["ai.ask"]);
    expect(can(ent, "ai.ask")).toBe(true);
    expect(can(ent, "ai.command")).toBe(false);
    expect(can(ent, "trip.collaborators")).toBe(false);
  });

  it("is false for an empty set, which is what `free` holds", () => {
    const ent = entitlementSet([]);
    expect(can(ent, "ai.ask")).toBe(false);
  });
});

describe("the union of a plan and its grants", () => {
  // M20's *Effective entitlements = base plan ∪ active grants*. A union with no
  // precedence: **a `premium` referrer who later downgrades to `plus` holds
  // both** and keeps premium entitlements until the grant expires. That is the
  // resolver behaving correctly, and there is no special case anywhere.
  it("keeps a grant's capabilities after the held plan loses them", () => {
    const heldPlus = ["ai.ask", "ai.command"] as const;
    const premiumGrant = ["ai.ask", "ai.command", "trip.collaborators"] as const;
    const ent = unionEntitlements([heldPlus, premiumGrant]);
    expect(can(ent, "trip.collaborators")).toBe(true);
  });

  it("adds nothing when there are no grants", () => {
    expect([...unionEntitlements([["ai.ask"]])]).toEqual(["ai.ask"]);
    expect([...unionEntitlements([])]).toEqual([]);
  });

  it("does not double-count a capability two sources both grant", () => {
    const ent = unionEntitlements([["ai.ask"], ["ai.ask", "ai.command"]]);
    expect([...ent].sort()).toEqual(["ai.ask", "ai.command"]);
  });
});
