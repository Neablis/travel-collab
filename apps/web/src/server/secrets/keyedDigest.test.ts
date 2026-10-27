import { afterEach, describe, expect, it } from "vitest";
import { legacyScryptDigest } from "@/server/api-tokens/legacyScrypt";
import { ApiTokenPepperMissingError, digestsMatch, keyedDigest } from "./keyedDigest";

// **Keyed is the property, and the only proof of it is a second key.** A bare
// hash would be stable too; what it could not do is change when the pepper does,
// and that is the change that stops a stolen table verifying a leaked secret.

const SECRET = "tc_dGhpcy1pcy1ub3QtYS1yZWFsLXNlY3JldA";
const KNOWN_PEPPER = "known-answer-pepper";
const ORIGINAL = process.env.API_TOKEN_PEPPER;

afterEach(() => {
  process.env.API_TOKEN_PEPPER = ORIGINAL;
});

describe("keyedDigest", () => {
  it("is stable under one key, as 64 hex characters", () => {
    process.env.API_TOKEN_PEPPER = "one-key";
    const digest = keyedDigest(SECRET);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedDigest(SECRET)).toBe(digest);
    expect(keyedDigest(`${SECRET}x`)).not.toBe(digest);
  });

  it("differs under a different key, so rotating the pepper retires every digest", () => {
    process.env.API_TOKEN_PEPPER = "one-key";
    const before = keyedDigest(SECRET);
    process.env.API_TOKEN_PEPPER = "another-key";
    expect(keyedDigest(SECRET)).not.toBe(before);
  });

  // **Every stored digest depends on this exact value.** The other tests write
  // and read through the same function, so a new label or a dropped HKDF step
  // passes them all while every token in production stops verifying.
  it("produces the known answer for a fixed pepper and secret", () => {
    process.env.API_TOKEN_PEPPER = KNOWN_PEPPER;
    expect(keyedDigest(SECRET)).toBe(
      "264d12aee8c81cb6ce54b76389b649e1171e2a030d02a3b02ef5789b12f5923e",
    );
  });

  it("refuses to digest anything without the pepper", () => {
    process.env.API_TOKEN_PEPPER = "";
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperMissingError);
    delete process.env.API_TOKEN_PEPPER;
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperMissingError);
  });
});

describe("legacyScryptDigest", () => {
  // Computed with `main`'s `hashOf` before 0069 (same scrypt parameters, pepper
  // as salt), so it is what a pre-0069 row holds. Drift here and every
  // `storage-changed` token falls back to "not valid".
  it("reproduces the digest pre-0069 rows were written with", () => {
    process.env.API_TOKEN_PEPPER = KNOWN_PEPPER;
    expect(legacyScryptDigest(SECRET)).toBe(
      "2104163039c58f4c65add3bfc556496c2ea85f620f6b51c3dde60a4d3a94a1b9",
    );
  });
});

describe("digestsMatch", () => {
  it("matches only the same digest, and a length mismatch is a miss rather than a throw", () => {
    const digest = keyedDigest(SECRET);
    expect(digestsMatch(digest, keyedDigest(SECRET))).toBe(true);
    expect(digestsMatch(digest, keyedDigest(`${SECRET}x`))).toBe(false);
    expect(digestsMatch(digest, digest.slice(1))).toBe(false);
  });
});
