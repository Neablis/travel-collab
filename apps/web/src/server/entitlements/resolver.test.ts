// The resolver, pure over its inputs — the union, the pins and the ceilings.
//
// `resolveEntitlements` reads no clock and performs no I/O, which is what lets
// the expiry boundaries be tested without a database. `resolver.int.test.ts`
// covers the two reads that feed it.
import { describe, expect, it } from "vitest";
import { can } from "./capability";
import { mostGenerousCeilings, resolveEntitlements, toAiEntitlements } from "./resolver";
import { planVersionFromRef } from "./planVersions";
import type { GrantRow } from "./grants";

function grant(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "u1",
    planId: "premium",
    planVersion: 1,
    source: "admin",
    grantedBy: "operator",
    reason: null,
    createdAt: new Date("2026-09-13T00:00:00Z"),
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

const FREE = planVersionFromRef("free@v1");
const PLUS = planVersionFromRef("plus@v1");

describe("effective entitlements = base plan ∪ active grants", () => {
  it("gives a bare free account nothing", () => {
    const resolved = resolveEntitlements(FREE, []);
    expect(can(resolved.entitlements, "ai.ask")).toBe(false);
    expect(can(resolved.entitlements, "trip.collaborators")).toBe(false);
  });

  it("adds a grant's capabilities to the held plan's", () => {
    const resolved = resolveEntitlements(FREE, [grant()]);
    expect(can(resolved.entitlements, "ai.ask")).toBe(true);
    expect(can(resolved.entitlements, "trip.collaborators")).toBe(true);
  });

  // The gate box, and there is no special case anywhere that produces it —
  // it falls out of the union being a union.
  it("keeps a premium grant after the held plan downgrades to plus", () => {
    const resolved = resolveEntitlements(PLUS, [grant({ planId: "premium", planVersion: 1 })]);
    expect(can(resolved.entitlements, "trip.collaborators")).toBe(true);
    // And the HELD version is still `plus` — the account bought plus, and that
    // is what the ledger and the account sheet must say.
    expect(resolved.held.planId).toBe("plus");
  });

  // **A grant pins the version it was granted at.** A founder grant issued
  // against v1 still confers v1 after v3 is published — so the pin is read out
  // of the row, never out of `livePlanVersion`.
  it("resolves a grant at the version it names, not the newest", () => {
    const resolved = resolveEntitlements(FREE, [grant({ planId: "premium", planVersion: 1 })]);
    expect(resolved.grants[0]!.planVersion).toBe(1);
    expect(can(resolved.entitlements, "trip.collaborators")).toBe(true);
  });

  // ADR-045 rule 3: a reference that does not resolve fails loudly, never
  // silently to the newest and never to an empty set.
  it("throws rather than guessing when a grant pins a version this deploy lacks", () => {
    expect(() => resolveEntitlements(FREE, [grant({ planVersion: 9 })])).toThrow(
      /not published in this deploy/,
    );
  });
});

describe("ceilings follow the union", () => {
  // A free account holding a plus trial is entitled to `ai.ask`. Capping it at
  // free's zero requests a day would entitle it to something it could never do.
  it("lifts a free account's zero to the trial's ceiling", () => {
    const resolved = resolveEntitlements(FREE, [grant({ planId: "plus", planVersion: 1 })]);
    expect(resolved.ceilings.perUserRequestsPerDay).toBe(50);
    expect(resolved.ceilings.perUserStepsPerDay).toBe(400);
  });

  it("takes the widest of several sources", () => {
    expect(
      mostGenerousCeilings([
        { perUserRequestsPerDay: 50, perUserStepsPerDay: 400, maxTier: "mid" },
        { perUserRequestsPerDay: 200, perUserStepsPerDay: 1600, maxTier: "cheap" },
      ]),
    ).toEqual({ perUserRequestsPerDay: 200, perUserStepsPerDay: 1600, maxTier: "mid" });
  });

  // `null` is *this version names no ceiling*, so the environment's default
  // stands — the most generous answer a version can give. Treating it as zero
  // would silently zero an account the day a version stopped naming one.
  it("lets a version that names no ceiling win over one that does", () => {
    expect(
      mostGenerousCeilings([
        { perUserRequestsPerDay: 50, perUserStepsPerDay: 400, maxTier: "mid" },
        { perUserRequestsPerDay: null, perUserStepsPerDay: null, maxTier: null },
      ]),
    ).toEqual({ perUserRequestsPerDay: null, perUserStepsPerDay: null, maxTier: null });
  });

  it("names nothing when there is nothing to name", () => {
    expect(mostGenerousCeilings([])).toEqual({
      perUserRequestsPerDay: null,
      perUserStepsPerDay: null,
      maxTier: null,
    });
  });
});

describe("the assistant kernel's narrowed view", () => {
  it("answers has() from the union and pins the HELD version", () => {
    const ai = toAiEntitlements(resolveEntitlements(PLUS, [grant()]));
    expect(ai.has("ai.ask")).toBe(true);
    expect(ai.has("ai.command")).toBe(true);
    // What the account bought, which is the term its per-user ceiling was sold
    // under and what the cost ledger records — not what it was granted.
    expect(ai.planVersionRef).toBe("plus@v1");
  });

  it("refuses a free account", () => {
    const ai = toAiEntitlements(resolveEntitlements(FREE, []));
    expect(ai.has("ai.ask")).toBe(false);
    expect(ai.ceilings.perUserRequestsPerDay).toBe(0);
  });
});
