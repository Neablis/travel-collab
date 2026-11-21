import { afterEach, describe, expect, it } from "vitest";
import { MfaSecretKeyMissingError, seal, unseal } from "./sealed";

const KEY = "mfa-key-padded-out-to-thirty-two-bytes!";
const OTHER_KEY = "another-mfa-key-padded-to-thirty-two-bytes";
const ORIGINAL = process.env.MFA_SECRET_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MFA_SECRET_KEY;
  else process.env.MFA_SECRET_KEY = ORIGINAL;
});

describe("sealed secrets", () => {
  it("returns what was sealed, and never the plaintext in the stored form", () => {
    process.env.MFA_SECRET_KEY = KEY;
    const sealed = seal("JBSWY3DPEHPK3PXP");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(unseal(sealed)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("seals the same secret to a different string each time", () => {
    process.env.MFA_SECRET_KEY = KEY;
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("fails closed when the key is unset, blank or short", () => {
    for (const value of [undefined, "", "too-short"]) {
      if (value === undefined) delete process.env.MFA_SECRET_KEY;
      else process.env.MFA_SECRET_KEY = value;
      expect(() => seal("x"), String(value)).toThrow(MfaSecretKeyMissingError);
    }
  });

  it("refuses to unseal under another key or after a byte changed", () => {
    process.env.MFA_SECRET_KEY = KEY;
    const sealed = seal("secret");
    process.env.MFA_SECRET_KEY = OTHER_KEY;
    expect(() => unseal(sealed)).toThrow();
    process.env.MFA_SECRET_KEY = KEY;
    const [v, nonce, tag, body] = sealed.split(".");
    const flipped = Buffer.from(body!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => unseal([v, nonce, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  it("refuses a tag cut short, even a genuine prefix", () => {
    process.env.MFA_SECRET_KEY = KEY;
    const [v, nonce, tag, body] = seal("secret").split(".");
    const cut = Buffer.from(tag!, "base64url").subarray(0, 4).toString("base64url");
    expect(() => unseal([v, nonce, cut, body].join("."))).toThrow();
  });
});
