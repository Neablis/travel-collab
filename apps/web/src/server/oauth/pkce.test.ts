import { describe, expect, it } from "vitest";
import { isS256Challenge, verifyS256 } from "./pkce";

// RFC 7636 appendix B's own example: if this drifts, no real client can redeem a code.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("verifyS256", () => {
  it("accepts RFC 7636 appendix B's verifier for its challenge", () => {
    expect(isS256Challenge(CHALLENGE)).toBe(true);
    expect(verifyS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("refuses another verifier, and the challenge presented as its own verifier (plain)", () => {
    expect(verifyS256(`${VERIFIER.slice(0, -1)}A`, CHALLENGE)).toBe(false);
    expect(verifyS256(CHALLENGE, CHALLENGE)).toBe(false);
  });

  it("refuses a verifier too short to be one", () => {
    expect(verifyS256("short", CHALLENGE)).toBe(false);
  });
});
