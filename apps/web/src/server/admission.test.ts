import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AdmissionRefusal } from "@tc/contracts";
import { matchesSuperCode, normalizeCredential, refusalRedirect } from "./admission";
import { witness } from "../test-support/witness";

describe("normalizeCredential", () => {
  it("treats nothing, blank and whitespace as nothing presented", () => {
    expect(normalizeCredential(null)).toBeNull();
    expect(normalizeCredential(undefined)).toBeNull();
    expect(normalizeCredential("")).toBeNull();
    expect(normalizeCredential("   \t\n ")).toBeNull();
  });

  it("strips the whitespace a copy-paste drags along", () => {
    expect(normalizeCredential("  ABC-123  ")).toBe("ABC-123");
  });

  // Load-bearing: the same field carries a trip-invite token, which is
  // base64url and case-sensitive. Folding case here would break link 2 while
  // leaving links 3 and 4 working, which is the kind of bug that ships.
  it("does not fold case, because a trip-invite token is case-sensitive", () => {
    expect(normalizeCredential("aBcD_-9")).toBe("aBcD_-9");
    expect(normalizeCredential("ABCD")).not.toBe(normalizeCredential("abcd"));
  });
});

describe("matchesSuperCode", () => {
  it("matches the configured code", () => {
    expect(matchesSuperCode("s3cret-code", "s3cret-code")).toBe(true);
  });

  it("refuses a near miss, including one that only differs in case or length", () => {
    expect(matchesSuperCode("s3cret-code", "s3cret-cod")).toBe(false);
    expect(matchesSuperCode("s3cret-code", "s3cret-codE")).toBe(false);
    expect(matchesSuperCode("s3cret-code", "S3CRET-CODE")).toBe(false);
    expect(matchesSuperCode("s3cret-code", "s3cret-code ")).toBe(false);
  });

  it("ignores whitespace around the CONFIGURED value, which a .env file adds", () => {
    expect(matchesSuperCode("  s3cret-code  ", "s3cret-code")).toBe(true);
  });

  // The whole point of link 3's "absent means closed": a deployment that
  // forgot the variable must refuse everyone, never admit everyone. Stated as
  // a property because it is a claim about ALL presented strings.
  it("admits nobody when the variable is unset, blank or whitespace — for any input", () => {
    const w = witness("matchesSuperCode absent-means-closed");
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom(undefined, "", " ", "\t\n  "),
        (presented, configured) => {
          w.tick();
          expect(matchesSuperCode(configured, presented)).toBe(false);
        },
      ),
    );
    // No guard clause in the property, so it ticks exactly `numRuns` (100).
    // Measured over 5 runs: 100 every time. Floor at half, per witness.ts.
    w.atLeast(50);
  });

  // Constant time is about *how* it compares, not *what* it decides: the
  // verdict must still be exactly equality, or the timing defence has been
  // bought with a correctness bug.
  it("decides exactly what trimmed equality decides — for any pair of strings", () => {
    const w = witness("matchesSuperCode equals trimmed equality");
    fc.assert(
      fc.property(fc.string(), fc.string(), (configured, presented) => {
        const expected = configured.trim();
        w.tick();
        expect(matchesSuperCode(configured, presented)).toBe(
          expected !== "" && presented !== "" && expected === presented,
        );
      }),
    );
    w.atLeast(50);
  });

  // Same-length inputs are the only ones `timingSafeEqual` actually sees, and
  // an unequal-length pair must be refused rather than throw.
  it("never throws on a length mismatch", () => {
    const w = witness("matchesSuperCode length mismatch");
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (a, b) => {
        // Ticked only on an actual mismatch. Ticking every case would witness
        // that the property RAN, not that it ever reached the path the test is
        // named for — a property that never generated an unequal pair would
        // still report a full count. Caught in review on PR #99.
        if (a.length !== b.length) w.tick();
        expect(() => matchesSuperCode(a, b)).not.toThrow();
      }),
    );
    w.atLeast(50);
  });
});

describe("refusalRedirect", () => {
  // The three exact strings `recordSignIn` returns. Spelled through the enum,
  // never as literals — a literal here is a second copy of the contract.
  it("sends each refusal to the designed screen with its own code", () => {
    expect(refusalRedirect(AdmissionRefusal.enum.MISSING_INVITE_CODE)).toBe(
      "/signup?error=MISSING_INVITE_CODE",
    );
    expect(refusalRedirect(AdmissionRefusal.enum.INVALID_INVITE_CODE)).toBe(
      "/signup?error=INVALID_INVITE_CODE",
    );
    expect(refusalRedirect(AdmissionRefusal.enum.SPENT_INVITE_CODE)).toBe(
      "/signup?error=SPENT_INVITE_CODE",
    );
  });

  // Auth.js's default `redirect` honours a returned path only if it starts
  // with "/" (`@auth/core` init.js:13-19); anything else is replaced by the
  // base URL and the error code is lost.
  it("returns a path Auth.js will honour, for every member of the closed set", () => {
    for (const reason of AdmissionRefusal.options) {
      expect(refusalRedirect(reason).startsWith("/")).toBe(true);
      expect(new URL(refusalRedirect(reason), "https://x.test").searchParams.get("error")).toBe(
        reason,
      );
    }
  });

  // If a fourth refusal is ever added to the contract it gets a redirect for
  // free — but it must also get copy, so this asserts the set is still three.
  it("covers exactly three refusals", () => {
    expect(AdmissionRefusal.options).toHaveLength(3);
  });
});

// The cookie's name and TTL were pinned here too, against a second local copy
// of both constants. That copy is gone — `lib/pendingAdmission.ts` is the only
// declaration now, and `pendingAdmission.test.ts` pins it there. Asserting the
// same constant in two files is the duplication this module just stopped
// having, one level up.
