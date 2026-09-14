// The vocabulary, and the two things it must never grow.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AdminGrantInput,
  ENTITLEMENTS,
  Entitlement,
  GrantSource,
  PLAN_IDS,
  PlanId,
  PlanVersionRef,
} from "../src/entitlement.ts";

const SOURCE = readFileSync(fileURLToPath(new URL("../src/entitlement.ts", import.meta.url)), "utf8");
// **A real parse, because a comment is a lexical construct.** Three earlier
// versions of this were wrong: a regex that stripped block comments before line
// comments (a `//` naming `@/server/*` opened a block comment that ate 2,800
// characters elsewhere in this repo), the same regex with the order fixed (a
// `/*` inside a string, template or regex literal still opened one), and
// `ts.createScanner` alone — which cannot tokenise a template literal with a
// substitution without parser feedback, and on THIS file returned one
// 734-character template token starting at the backtick in `new RegExp(\`…\`)`
// that swallowed the JSDoc after it. The last two were found by CodeRabbit on
// PR #174 and by the fix for the second failing a test that had been passing.
//
// `apps/web/src/test-support/stripComments.ts` is the shared version and has
// its own tests; this package depends on nothing, so it is spelled out here.
// `getChildren`, not `forEachChild`: trivia hangs off TOKENS, which the latter
// never yields.
const CODE = (() => {
  const parsed = ts.createSourceFile("entitlement.ts", SOURCE, ts.ScriptTarget.Latest, true);
  const out = SOURCE.split("");
  const blank = (node: ts.Node): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(SOURCE, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(SOURCE, node.getEnd()) ?? []),
    ]) {
      for (let i = range.pos; i < range.end && i < out.length; i += 1) {
        if (out[i] !== "\n") out[i] = " ";
      }
    }
    for (const child of node.getChildren(parsed)) blank(child);
  };
  blank(parsed);
  return out.join("");
})();

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
  it("names the three launch plans, and the fourth-plan proof", () => {
    // `studio` is M20's gate-box proof that the split architecture is real:
    // a plan granting `trip.collaborators` WITHOUT `ai.command`, which no rank
    // can place. Its version entry ships **disabled**, so nothing sells it —
    // what it costs to exist is this one member and one entry in the plan file,
    // and no change to any gate.
    expect(PLAN_IDS).toEqual(["free", "plus", "premium", "studio"]);
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
    for (const ref of ["premium", "premium@1", "premium@v0", "premium@v01", "atelier@v1", "PREMIUM@v1", ""]) {
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

describe("AdminGrantInput", () => {
  const grant = { userId: "dev-ana", planId: "premium", expiresAt: null, reason: "Comped." };

  it("accepts a grant with an account, a plan, an expiry and a reason", () => {
    expect(AdminGrantInput.safeParse(grant).success).toBe(true);
    // `null` is PERMANENT, and it is nullable rather than optional so that
    // "forever" is a decision an operator makes rather than one an omitted
    // field makes for them.
    expect(AdminGrantInput.safeParse({ ...grant, expiresAt: "2026-10-01T00:00:00Z" }).success).toBe(true);
    expect(AdminGrantInput.safeParse({ userId: "dev-ana", planId: "premium", reason: "x" }).success).toBe(false);
  });

  // **A reason nobody can read is not an audit trail.** `.min(1)` accepted
  // `"   "` — a comp with no evidence behind it, six months before the billing
  // dispute that asks what it was for.
  it("refuses a blank or whitespace-only reason", () => {
    for (const reason of ["", " ", "   ", "\t\n"]) {
      expect(AdminGrantInput.safeParse({ ...grant, reason }).success, JSON.stringify(reason)).toBe(false);
    }
  });

  // Validated trimmed, STORED as typed: this package validates and never
  // transforms, so an operator's own spacing survives.
  it("keeps the operator's own wording, spacing included", () => {
    const parsed = AdminGrantInput.parse({ ...grant, reason: "  Comped for a support case.  " });
    expect(parsed.reason).toBe("  Comped for a support case.  ");
  });

  // **No version field**, deliberately: a grant pins the version live when it
  // is issued, resolved server-side. And no price — M20 never learns what a
  // plan costs.
  it("carries no version and no price", () => {
    const keys = Object.keys(AdminGrantInput.shape);
    expect(keys.sort()).toEqual(["expiresAt", "planId", "reason", "userId"]);
  });
});
