// The live set spends real model calls, so its one guard is that it refuses
// any deployment that does not itself report preview or local development.
// The first version decided from the hostname, and a production deployment's
// own hashed URL passed it (Copilot on #301).
import { describe, expect, it } from "vitest";
import { targetVerdict } from "./assistant-live-set.mjs";

describe("the live set's target guard", () => {
  it("allows a deployment that reports preview or development", () => {
    expect(targetVerdict("preview").ok).toBe(true);
    expect(targetVerdict("development").ok).toBe(true);
  });

  it("refuses production, and anything it could not read", () => {
    expect(targetVerdict("production").ok).toBe(false);
    expect(targetVerdict(null).ok).toBe(false);
    expect(targetVerdict(undefined).ok).toBe(false);
    expect(targetVerdict("staging").ok).toBe(false);
  });
});
