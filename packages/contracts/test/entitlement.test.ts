// The vocabulary, and the two things it must never grow.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ENTITLEMENTS,
  Entitlement,
  GrantSource,
  PLAN_IDS,
  PlanId,
  PlanVersionRef,
} from "../src/entitlement.ts";

const SOURCE = readFileSync(fileURLToPath(new URL("../src/entitlement.ts", import.meta.url)), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Entitlement", () => {
  it("names the three capabilities M20 gates on", () => {
    expect(ENTITLEMENTS).toEqual(["ai.ask", "ai.command", "trip.collaborators"]);
  });

  it("refuses a capability outside the vocabulary", () => {
    expect(Entitlement.safeParse("ai.everything").success).toBe(false);
    // A typo must not parse. It would silently grant nothing and the account
    // would look downgraded for reasons nobody can see.
    expect(Entitlement.safeParse("ai.Ask").success).toBe(false);
  });

  // **Trip planning is free and has no entitlement string** (M20 link 1). There
  // is no `trip.plan`, `trip.create` or `trip.publish` here, and there must not
  // be: a capability that exists is one somebody will eventually check, and the
  // milestone's most important negative is that planning stays ungated.
  it("names no capability for trip planning itself", () => {
    for (const entitlement of ENTITLEMENTS) {
      expect(entitlement).not.toMatch(/^trip\.(plan|create|publish|day|stop|cost|saved)/);
    }
  });
});

describe("PlanId", () => {
  it("names the three launch plans and nothing more", () => {
    expect(PLAN_IDS).toEqual(["free", "plus", "premium"]);
  });

  // **A plan is a set, not a rank** (ADR-045 rule 4). This file may not export
  // an ordering, and it may not contain one either — `accessPolicy.ts`'s `RANK`
  // is one import away and copying it is the obvious move and the wrong one.
  it("exports no rank and defines none", () => {
    // Substring, not `\b`-delimited: `PLAN_RANK` has no word boundary before
    // `RANK`, so a `\bRANK\b` alternation slid straight past the exact constant
    // this test exists to refuse. Caught by breaking the code on purpose.
    expect(CODE).not.toMatch(/rank|atleast|tierof|plan_order|displayorder|ordinal/i);
    expect(CODE).not.toMatch(/\bindexOf\b/);
  });

  // The vocabulary owns the words; the plan file owns the offers (ADR-045 rule
  // 6). A `PLANS` constant here would be the offers leaking into contracts, and
  // it is where a price would arrive first.
  it("says what a plan IS nowhere in this package", () => {
    expect(CODE).not.toMatch(/\b(PLANS|PLAN_VERSIONS|entitlementsFor|ceilings)\b/);
    expect(CODE).not.toMatch(/\b(price|priceMinor|currency|stripe|amountMinor)\b/i);
  });
});

describe("PlanVersionRef", () => {
  it("accepts a published-looking reference", () => {
    for (const ref of ["free@v1", "plus@v2", "premium@v10"]) {
      expect(PlanVersionRef.safeParse(ref).success).toBe(true);
    }
  });

  // A malformed reference must not reach a column: ADR-045 rule 3 makes an
  // unresolvable reference a loud failure, and the cheapest way to keep that
  // rare is to refuse the shapes that can never resolve.
  it("refuses a shape that could never resolve", () => {
    for (const ref of ["premium", "premium@1", "premium@v0", "premium@v01", "studio@v1", "PREMIUM@v1", ""]) {
      expect(PlanVersionRef.safeParse(ref).success).toBe(false);
    }
  });

  // Built from `PlanId.options`, so a fourth plan is one edit rather than two
  // — and this test is what proves the derivation is real rather than a
  // coincidence of the two lists agreeing today.
  it("accepts exactly the plan ids PlanId names", () => {
    for (const planId of PLAN_IDS) {
      expect(PlanVersionRef.safeParse(`${planId}@v1`).success).toBe(true);
    }
    expect(PlanId.options.every((planId) => PlanVersionRef.safeParse(`${planId}@v1`).success)).toBe(true);
  });
});

describe("GrantSource", () => {
  it("names the four ways an account holds something it did not buy", () => {
    expect(GrantSource.options).toEqual(["trial", "referral", "admin", "founder"]);
  });
});
