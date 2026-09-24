// **A published entry cannot be changed at runtime** — the half of
// `planVersions.ts`'s immutability claim that `noExtension.test.ts` does not
// cover (KI-2026-09-16-b).
//
// `noExtension.test.ts`'s `V1_AS_PUBLISHED` catches a pull request that edits a
// published entry in source. This catches the other way an entry changes: a
// code path writing to it after load — a stray `sort()`, a `push` onto an
// entitlement list, a price overwritten through an `any`. The module header
// promised this file for months before it existed; nothing asserted the
// `Object.freeze` loop, so removing it passed every test.
//
// Two layers, because they fail for different mistakes:
//   1. **Every object reachable from `PLAN_VERSIONS` is frozen**, found by
//      walking rather than by naming fields. A nested record added to
//      `PlanVersion` later without a matching freeze is exactly the hole the
//      `price` freeze's own comment describes, and a field-by-field list would
//      not know to look at it.
//   2. **A write actually throws and actually does not land.** `isFrozen` is
//      the mechanism; this is the behaviour the header promises. Asserted
//      against the runtime rather than assumed: this module is ESM and so
//      strict, which is what turns a write to a frozen object into a
//      `TypeError` instead of a silent no-op.
import { describe, expect, it } from "vitest";
import { PLAN_VERSIONS, planVersionRefOf, type PlanVersion } from "./planVersions";

/** Every object reachable from `root` that is not frozen, by path. */
function unfrozenPaths(root: unknown, path = "PLAN_VERSIONS"): string[] {
  if (root === null || typeof root !== "object") return [];
  const own = Object.isFrozen(root) ? [] : [path];
  return own.concat(
    Object.entries(root).flatMap(([key, value]) => unfrozenPaths(value, `${path}.${key}`)),
  );
}

/** A deliberately untyped handle, which is how a real runtime write would get in. */
function writable(value: unknown): Record<string, unknown> & unknown[] {
  return value as Record<string, unknown> & unknown[];
}

describe("published plan versions are frozen", () => {
  it("leaves nothing reachable from PLAN_VERSIONS unfrozen", () => {
    expect(unfrozenPaths(PLAN_VERSIONS)).toEqual([]);
  });

  // The walk above would pass vacuously over an empty list or one whose nested
  // records had become primitives, so the fields the header names are also
  // checked by name. This is the list the entry asked for.
  it.each(PLAN_VERSIONS.map((entry) => [planVersionRefOf(entry), entry] as const))(
    "freezes %s, its entitlements, its ceilings and its price",
    (_ref, entry: PlanVersion) => {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.entitlements)).toBe(true);
      expect(Object.isFrozen(entry.ceilings)).toBe(true);
      if (entry.price !== null) expect(Object.isFrozen(entry.price)).toBe(true);
    },
  );

  it("freezes the list itself", () => {
    expect(PLAN_VERSIONS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(PLAN_VERSIONS)).toBe(true);
  });
});

describe("a write to a published entry", () => {
  const plus = PLAN_VERSIONS.find((entry) => planVersionRefOf(entry) === "plus@v1")!;

  it("cannot change what a version costs", () => {
    const before = plus.price!.minor;
    expect(() => {
      writable(plus.price).minor = before + 100;
    }).toThrow(TypeError);
    expect(() => {
      writable(plus).price = { minor: before + 100, currency: "usd", stripePriceId: null };
    }).toThrow(TypeError);
    expect(plus.price!.minor).toBe(before);
  });

  it("cannot change what a version grants", () => {
    const before = [...plus.entitlements];
    expect(() => writable(plus.entitlements).push("trip.collaborators")).toThrow(TypeError);
    expect(() => {
      writable(plus.ceilings).perUserRequestsPerDay = 1_000_000;
    }).toThrow(TypeError);
    expect(() => {
      writable(plus).version = 2;
    }).toThrow(TypeError);
    expect(plus.entitlements).toEqual(before);
    expect(plus.ceilings.perUserRequestsPerDay).toBe(50);
    expect(plus.version).toBe(1);
  });

  // **`sort()` is the one the header singles out**: the list's order is its
  // publication history and `livePlanVersion` reads it, so an in-place sort
  // would silently change which version every new purchase pins.
  it("cannot reorder, append to or remove from the publication history", () => {
    const before = PLAN_VERSIONS.map(planVersionRefOf);
    expect(() => writable(PLAN_VERSIONS).sort(() => -1)).toThrow(TypeError);
    expect(() => writable(PLAN_VERSIONS).push(plus)).toThrow(TypeError);
    expect(() => writable(PLAN_VERSIONS).pop()).toThrow(TypeError);
    expect(PLAN_VERSIONS.map(planVersionRefOf)).toEqual(before);
  });
});
