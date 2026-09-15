// The resolver, pure over its inputs — the union, the pins and the ceilings.
//
// `resolveEntitlements` reads no clock and performs no I/O, which is what lets
// the expiry boundaries be tested without a database. `resolver.int.test.ts`
// covers the two reads that feed it.
import { describe, expect, it } from "vitest";
import { can } from "./capability";
import {
  entitlementsLostIfSubscriptionStops,
  mostGenerousCeilings,
  resolveEntitlements,
  toAiEntitlements,
} from "./resolver";
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

// **What a lapse would actually take** (CodeRabbit, PR #177).
//
// The account sheet's past-due and lapsed banners both name a loss, and the
// screen could reach the answer from neither set it already had. The effective
// entitlements include what grants supply, so reading them names losses that
// never happen; the held plan's own list is blind to grants, so it names a loss
// that does not occur for any account whose grant covers the same thing. Both
// are false in one of the two worlds, and "conservative" is not a defence when
// the sentence describes something that did not happen to a real person.
//
// The difference of two unions is the answer, and these four cases are the
// whole of it.
describe("what a lapse would take", () => {
  const PREMIUM = planVersionFromRef("premium@v1");
  const standing = (conferring: boolean) =>
    ({ row: {}, conferring, pastDueSince: null, graceEndsAt: null, lapsed: !conferring }) as never;

  it("names what the subscription bought, when nothing else confers it", () => {
    const lost = entitlementsLostIfSubscriptionStops(
      resolveEntitlements(PREMIUM, [], standing(true)),
    );
    expect(lost).toContain("trip.collaborators");
    expect(lost).toContain("ai.ask");
  });

  // **The case that made this a server value.** The grant outlives the
  // subscription, so the collaborators never go read-only and the banner must
  // not say they did.
  it("names nothing a grant still confers", () => {
    const lost = entitlementsLostIfSubscriptionStops(
      resolveEntitlements(PREMIUM, [grant({ planId: "premium", planVersion: 1 })], standing(true)),
    );
    expect(lost).not.toContain("trip.collaborators");
    expect(lost).not.toContain("ai.ask");
  });

  // A partial grant covers part of the loss and no more: `plus` has the
  // assistant and not the collaborators, so exactly one of the two survives.
  it("subtracts only what the grant actually covers", () => {
    const lost = entitlementsLostIfSubscriptionStops(
      resolveEntitlements(PREMIUM, [grant({ planId: "plus", planVersion: 1 })], standing(true)),
    );
    expect(lost).not.toContain("ai.ask");
    expect(lost).toContain("trip.collaborators");
  });

  // **The same answer after the lapse as before it**, which is what lets one
  // value serve both banners: the past-due one asks what WILL go and the lapsed
  // one asks what WENT. `held` is read rather than `conferred` for this reason.
  it("does not change once the lapse has happened", () => {
    const before = entitlementsLostIfSubscriptionStops(
      resolveEntitlements(PREMIUM, [], standing(true)),
    );
    const after = entitlementsLostIfSubscriptionStops(
      resolveEntitlements(PREMIUM, [], standing(false)),
    );
    expect([...after].sort()).toEqual([...before].sort());
  });

  // An account that bought nothing loses nothing, so neither banner can ever
  // be reached with a sentence about other people.
  it("is empty for an account that never subscribed", () => {
    expect(entitlementsLostIfSubscriptionStops(resolveEntitlements(FREE, []))).toEqual([]);
  });
});
