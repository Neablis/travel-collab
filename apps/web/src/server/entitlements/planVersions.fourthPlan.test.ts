// **The proof that the split architecture is real rather than asserted**
// (M20's gate box).
//
// > *"A fourth plan that is not a subset of any other can be added by editing
// > one file, granting `trip.collaborators` without `ai.command`. It ships
// > disabled — the point is that adding it costs one definition and no change
// > to any gate."*
//
// `studio` is that plan. It is **above `premium` on one axis and below `plus`
// on another**, so no ordering over plans can express it: a rank would have to
// put it somewhere, and every position is wrong. The three launch plans happen
// to nest, which is why this one has to exist — without it, every cheap move
// works and the ladder is invisible until the first real non-nested plan
// arrives and every reader has to be unpicked.
//
// **What "not a subset of any other" can actually mean here, stated honestly.**
// `premium` holds the entire three-word vocabulary, so every plan is a subset
// of it — that is a fact about the vocabulary having three members, not about
// the architecture. The property that matters, and the one a rank cannot
// survive, is **incomparability**: `studio` ⊄ `plus` and `plus` ⊄ `studio`, so
// there is no position in an ordering where `studio` can go. That is what is
// asserted below, and the weaker claim was written first and caught by running
// it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";
import { PLAN_IDS } from "@tc/contracts";
import { can, entitlementSet } from "./capability";
import { PLAN_VERSIONS, livePlanVersion, planVersionFromRef } from "./planVersions";
import { resolveEntitlements } from "./resolver";

const STUDIO = planVersionFromRef("studio@v1");
const HERE = path.dirname(fileURLToPath(import.meta.url));

const setOf = (planId: string) =>
  new Set(PLAN_VERSIONS.find((entry) => entry.planId === planId)!.entitlements);

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return [...a].every((member) => b.has(member));
}

describe("the fourth plan is not a subset of any other", () => {
  it("grants trip.collaborators without ai.command", () => {
    expect(STUDIO.entitlements).toEqual(["ai.ask", "trip.collaborators"]);
    const ent = entitlementSet(STUDIO.entitlements);
    expect(can(ent, "trip.collaborators")).toBe(true);
    expect(can(ent, "ai.command")).toBe(false);
  });

  // **No ordering can place it, and this is the assertion that says so.**
  // `studio` and `plus` are incomparable: `studio` lacks `ai.command`, `plus`
  // lacks `trip.collaborators`. A `RANK` table has to give each plan a number,
  // and there is no number for `studio` that is both above and below `plus` —
  // which is what any total order would have to claim.
  it("is incomparable with plus, so no rank can place it", () => {
    const studio = setOf("studio");
    const plus = setOf("plus");
    expect(isSubset(studio, plus), "studio ⊆ plus").toBe(false);
    expect(isSubset(plus, studio), "plus ⊆ studio").toBe(false);
  });

  // The honest limit of the claim, written down rather than left for someone to
  // discover as a contradiction. `premium` holds the whole vocabulary, so
  // everything is a subset of it — a fact about there being three capability
  // strings, not about the plans. It stops being true the moment a fourth
  // capability exists that `premium` does not grant, and the incomparability
  // above never depended on it.
  it("is a subset of premium only because premium holds the whole vocabulary", () => {
    expect(isSubset(setOf("studio"), setOf("premium"))).toBe(true);
    expect(setOf("premium").size).toBe(3);
  });

  // `free` grants nothing, so it is trivially a subset of everything. That is
  // the empty set, not an ordering over plans.
  it("has nothing to compare against free, which grants nothing", () => {
    expect(setOf("free").size).toBe(0);
  });

  // Shipped disabled: nothing sells it and nobody holds it. `livePlanVersion`
  // still resolves it, because a disabled plan is a published plan — what
  // `enabled` bounds is what an operator may hand out, never what a holder may
  // do, and the gates never read it.
  it("ships disabled while staying fully resolvable", () => {
    expect(STUDIO.enabled).toBe(false);
    expect(livePlanVersion("studio")).toBe(STUDIO);
    expect(PLAN_IDS).toContain("studio");
  });

  // **And it works.** An account holding it gets exactly its two capabilities
  // out of the resolver, through no special case: the union does not know this
  // plan is unusual, because nothing about a set is unusual.
  it("resolves through the ordinary union with no special case", () => {
    const resolved = resolveEntitlements(STUDIO, []);
    expect(can(resolved.entitlements, "trip.collaborators")).toBe(true);
    expect(can(resolved.entitlements, "ai.ask")).toBe(true);
    expect(can(resolved.entitlements, "ai.command")).toBe(false);
    expect(resolved.ceilings.perUserRequestsPerDay).toBe(50);
  });
});

describe("adding it cost one definition and no change to any gate", () => {
  // **The claim the box actually makes**, and the first version of this test
  // measured the wrong thing: it swept for a plan id appearing as a string
  // literal anywhere, and flagged four sites that are all legitimately naming a
  // plan as DATA — a column default of `"free"`, the trial granting `"plus"`,
  // a row-less session resolving to `"free"`, and a new account being created
  // on `"free"`. None of them is a gate, because none of them COMPARES.
  //
  // A rank or a gate needs a comparison: `=== "premium"`, `!== "free"`,
  // `>= "plus"`, `includes("premium")`, or a `case "premium":`. That is what
  // this sweeps for, and it is the shape that would have had to change to add
  // `studio`.
  const COMPARISONS = [
    // `x === "premium"` and its three siblings, either operand order.
    /[!=]==?\s*["'](free|plus|premium|studio)["']/,
    /["'](free|plus|premium|studio)["']\s*[!=]==?/,
    // An ordering — the defect `can()` exists to prevent.
    /["'](free|plus|premium|studio)["']\s*[<>]=?/,
    /[<>]=?\s*["'](free|plus|premium|studio)["']/,
    // Membership in a hard-coded list of plans, which is a rank with extra
    // steps.
    /\.\s*(includes|indexOf)\s*\(\s*["'](free|plus|premium|studio)["']/,
    // A switch over plans.
    /case\s+["'](free|plus|premium|studio)["']/,
  ];

  // Tests compare plan ids constantly — that is what an assertion is — and the
  // console displays them by name because displaying them is what it is for.
  const MAY_COMPARE = [/\.test\.tsx?$/, /^src\/server\/test-support\//];

  it("compares a plan id in no gate anywhere in the app", () => {
    const web = path.resolve(HERE, "../../..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const rel = path.relative(web, full).split(path.sep).join("/");
        if (MAY_COMPARE.some((allowed) => allowed.test(rel))) continue;
        const code = stripComments(readFileSync(full, "utf8"));
        if (COMPARISONS.some((pattern) => pattern.test(code))) offenders.push(rel);
      }
    };
    walk(path.join(web, "src"));
    expect(offenders).toEqual([]);
  });

  // The positive half: every gate asks `can()`, and `can()` takes a capability
  // rather than a plan. A gate that wanted to know which PLAN an account holds
  // would have to widen this signature, which is a typecheck failure in the
  // diff that does it.
  it("gives every gate a capability to ask about, never a plan", () => {
    const capability = readFileSync(path.join(HERE, "capability.ts"), "utf8");
    expect(capability).toMatch(/export function can\(ent: EntitlementSet, capability: Entitlement\)/);
    expect(capability).not.toMatch(/PlanId/);
  });
});
