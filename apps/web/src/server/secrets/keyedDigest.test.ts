import { afterEach, describe, expect, it } from "vitest";
import { legacyScryptDigest } from "@/server/api-tokens/legacyScrypt";
import {
  ApiTokenPepperMissingError,
  ApiTokenPepperTooShortError,
  digestsMatch,
  keyedDigest,
  keyedDigestCandidates,
} from "./keyedDigest";

// **Keyed is the property, and the only proof of it is a second key.** A bare
// hash would be stable too; what it could not do is change when the pepper does,
// and that is the change that stops a stolen table verifying a leaked secret.

const SECRET = "tc_dGhpcy1pcy1ub3QtYS1yZWFsLXNlY3JldA";
const KNOWN_PEPPER = "known-answer-pepper-of-at-least-32-bytes";
const ONE_KEY = "one-key-padded-out-to-thirty-two-bytes";
const ANOTHER_KEY = "another-key-padded-out-to-thirty-two-bytes";
const ORIGINAL = process.env.API_TOKEN_PEPPER;
const ORIGINAL_PREVIOUS = process.env.API_TOKEN_PEPPER_PREVIOUS;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("API_TOKEN_PEPPER", ORIGINAL);
  restore("API_TOKEN_PEPPER_PREVIOUS", ORIGINAL_PREVIOUS);
});

describe("keyedDigest", () => {
  it("is stable under one key, as 64 hex characters", () => {
    process.env.API_TOKEN_PEPPER = ONE_KEY;
    const { digest } = keyedDigest(SECRET);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedDigest(SECRET).digest).toBe(digest);
    expect(keyedDigest(`${SECRET}x`).digest).not.toBe(digest);
  });

  it("differs under a different key, and names that key by a different version", () => {
    process.env.API_TOKEN_PEPPER = ONE_KEY;
    const before = keyedDigest(SECRET);
    process.env.API_TOKEN_PEPPER = ANOTHER_KEY;
    const after = keyedDigest(SECRET);
    expect(after.digest).not.toBe(before.digest);
    expect(after.keyVersion).not.toBe(before.keyVersion);
  });

  // **Every stored digest depends on this exact value.** The other tests write
  // and read through the same function, so a new label or a dropped HKDF step
  // passes them all while every token in production stops verifying. The digest
  // was computed by the code before key versions existed (2fa8a8f), so the
  // construction is unchanged; only the pepper is longer, to pass the 32-byte floor.
  it("produces the known answer for a fixed pepper and secret", () => {
    process.env.API_TOKEN_PEPPER = KNOWN_PEPPER;
    expect(keyedDigest(SECRET)).toEqual({
      keyVersion: "558028f2",
      digest: "37ab86345cd4631fff9da200267aabaab8933c2097cd914868561dd551252c75",
    });
  });

  it("refuses to digest anything without the pepper", () => {
    process.env.API_TOKEN_PEPPER = "";
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperMissingError);
    delete process.env.API_TOKEN_PEPPER;
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperMissingError);
  });

  // A short pepper is a guessable key, and a guessed key turns a stolen table
  // back into a way to confirm leaked secrets.
  it("refuses a pepper shorter than 32 bytes, current or previous", () => {
    process.env.API_TOKEN_PEPPER = "x".repeat(31);
    expect(() => keyedDigest(SECRET)).toThrow(ApiTokenPepperTooShortError);
    process.env.API_TOKEN_PEPPER = "x".repeat(32);
    expect(keyedDigest(SECRET).digest).toMatch(/^[0-9a-f]{64}$/);
    process.env.API_TOKEN_PEPPER_PREVIOUS = "y".repeat(31);
    expect(() => keyedDigestCandidates(SECRET)).toThrow(ApiTokenPepperTooShortError);
  });
});

describe("keyedDigestCandidates", () => {
  // **Rotation without a mass logout.** A token minted under the old pepper is
  // still found while that pepper is configured as the previous one.
  it("gives the current key's digest first, then the previous key's", () => {
    process.env.API_TOKEN_PEPPER = ONE_KEY;
    const underOld = keyedDigest(SECRET);
    process.env.API_TOKEN_PEPPER = ANOTHER_KEY;
    const underNew = keyedDigest(SECRET);
    process.env.API_TOKEN_PEPPER_PREVIOUS = ONE_KEY;
    expect(keyedDigestCandidates(SECRET)).toEqual([underNew, underOld]);
  });

  it("is the current key alone when no previous key is set, or it repeats the current one", () => {
    process.env.API_TOKEN_PEPPER = ONE_KEY;
    delete process.env.API_TOKEN_PEPPER_PREVIOUS;
    expect(keyedDigestCandidates(SECRET)).toEqual([keyedDigest(SECRET)]);
    process.env.API_TOKEN_PEPPER_PREVIOUS = "";
    expect(keyedDigestCandidates(SECRET)).toEqual([keyedDigest(SECRET)]);
    process.env.API_TOKEN_PEPPER_PREVIOUS = ONE_KEY;
    expect(keyedDigestCandidates(SECRET)).toEqual([keyedDigest(SECRET)]);
  });
});

describe("legacyScryptDigest", () => {
  // Computed with `main`'s `hashOf` before 0069 (same scrypt parameters, pepper
  // as salt), so it is what a pre-0069 row holds. Drift here and every
  // `storage-changed` token falls back to "not valid". Its pepper is the old
  // short one on purpose: 0069's rows were written before the 32-byte floor.
  it("reproduces the digest pre-0069 rows were written with", async () => {
    expect(await legacyScryptDigest(SECRET, "known-answer-pepper")).toBe(
      "2104163039c58f4c65add3bfc556496c2ea85f620f6b51c3dde60a4d3a94a1b9",
    );
  });

  it("refuses a blank pepper rather than hashing with an empty salt", async () => {
    await expect(legacyScryptDigest(SECRET, "")).rejects.toBeInstanceOf(ApiTokenPepperMissingError);
  });

  // **~37ms of scrypt must not stall every other request.** The prefix it
  // narrows by is shown in the UI, so anyone can make the server pay it.
  it("runs off the event loop, so a timer queued before it fires before it finishes", async () => {
    const order: string[] = [];
    const tick = new Promise<void>((resolve) =>
      setImmediate(() => {
        order.push("event loop");
        resolve();
      }),
    );
    const digest = Promise.resolve(legacyScryptDigest(SECRET, KNOWN_PEPPER)).then(() => order.push("scrypt"));
    await Promise.all([tick, digest]);
    expect(order).toEqual(["event loop", "scrypt"]);
  });
});

describe("digestsMatch", () => {
  it("matches only the same digest, and a length mismatch is a miss rather than a throw", () => {
    const { digest } = keyedDigest(SECRET);
    expect(digestsMatch(digest, keyedDigest(SECRET).digest)).toBe(true);
    expect(digestsMatch(digest, keyedDigest(`${SECRET}x`).digest)).toBe(false);
    expect(digestsMatch(digest, digest.slice(1))).toBe(false);
  });
});
