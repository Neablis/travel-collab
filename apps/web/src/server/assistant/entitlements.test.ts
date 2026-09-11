// The port M20 fills, and the one shape it must never take.
//
// **A plan is a set, not a rank** — M20's single most load-bearing rule, and
// the one the milestone says is easiest to lose: *"`premium` lists its own
// entitlements in full; it is never `[...PLUS, 'trip.collaborators']`."* The
// obvious move here is to copy `accessPolicy.ts`'s `RANK`, because this repo
// already has a working rank comparison for trip roles and this looks like the
// same problem. It is not: roles really are ordered, and plans are not. The
// first non-nested plan cannot be expressed once a rank is baked in, and every
// reader has to be unpicked to fix it.
//
// A test cannot easily assert "nobody will add `atLeast` later", so this
// asserts the two things it can: the surface has exactly one predicate on it,
// and the module's own source contains no ordering.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NO_CEILINGS,
  PERMITS_EVERYTHING,
  permitEverything,
  type ResolvedEntitlements,
} from "./entitlements";

const SOURCE = readFileSync(fileURLToPath(new URL("./entitlements.ts", import.meta.url)), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the entitlement port is a set, not a rank", () => {
  // Exactly one member is callable, and it is `has`. A second predicate is
  // where an ordering would arrive.
  it("exposes has() and nothing else that answers a question", () => {
    const callable = Object.entries(PERMITS_EVERYTHING)
      .filter(([, value]) => typeof value === "function")
      .map(([key]) => key);
    expect(callable).toEqual(["has"]);
  });

  // The names a rank would have to arrive under, and the mechanism it would
  // have to be built from. `RANK` is named explicitly because the file it lives
  // in is one import away and the copy is the obvious move.
  it("names no comparison operator and no rank table", () => {
    expect(CODE).not.toMatch(/\b(atLeast|RANK|rank|compare|ordering|tierOf|planRank|isAtLeast)\b/);
    // An ordering over plans would need an index into one.
    expect(CODE).not.toMatch(/\bindexOf\b/);
  });

  // **A type-level check on the same rule.** `has` takes one capability and
  // returns a boolean; a reader that wanted "at least premium" would have to
  // widen this signature, which is a typecheck failure in their own diff.
  it("gives has() one capability and one boolean answer", () => {
    const resolved: ResolvedEntitlements = PERMITS_EVERYTHING;
    expect(resolved.has.length).toBe(0); // `() => true` takes no declared parameter
    expect(resolved.has("ai.ask")).toBe(true);
    expect(resolved.has("ai.command")).toBe(true);
    // @ts-expect-error `trip.collaborators` is M20's, not the assistant's — the
    // kernel asks only about the capabilities it gates on.
    expect(resolved.has("trip.collaborators")).toBe(true);
  });
});

describe("the default resolver changes nothing", () => {
  // The whole of P5's "no behaviour change" claim on this port: everything
  // permitted, no ceiling named, no version pinned. Inventing a tier, a ceiling
  // or a price here is the one thing ADR-043 says this work must not do.
  it("permits every capability and names no ceiling", async () => {
    const resolved = await permitEverything({ userId: "alice" });
    expect(resolved.has("ai.ask")).toBe(true);
    expect(resolved.has("ai.command")).toBe(true);
    expect(resolved.ceilings).toEqual(NO_CEILINGS);
    expect(resolved.planVersionRef).toBeNull();
  });

  // Every ceiling is `null`, which `quota.ts` reads as "the plan named none"
  // and answers with today's environment default. A number here would be an
  // invented tier wearing a default's clothes.
  it("names no number at all", () => {
    expect(Object.values(NO_CEILINGS).every((value) => value === null)).toBe(true);
  });

  // M20 requires this resolve per request from the database — *"a downgrade
  // must bite before a token refreshes"* — so the port is a Promise even
  // though today's answer is a constant. A synchronous port would have to be
  // widened by whoever wires link 3, at every call site.
  it("is asynchronous, so a real resolver can reach the database", () => {
    expect(permitEverything({ userId: "alice" })).toBeInstanceOf(Promise);
  });
});
