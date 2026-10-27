import { afterEach, describe, expect, it } from "vitest";
import { ApiTokenPepperMissingError, digestsMatch, keyedDigest } from "./keyedDigest";

// **Keyed is the property, and the only proof of it is a second key.** A bare
// hash would be stable too; what it could not do is change when the pepper does,
// and that is the change that stops a stolen table verifying a leaked secret.

const SECRET = "tc_dGhpcy1pcy1ub3QtYS1yZWFsLXNlY3JldA";
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

  it("refuses to digest anything without the pepper", () => {
    process.env.API_TOKEN_PEPPER = "";
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperMissingError);
    delete process.env.API_TOKEN_PEPPER;
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperMissingError);
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
