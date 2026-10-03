// The live set spends real model calls, so its one guard is that it refuses
// any deployment that does not itself report preview or local development.
// The first version decided from the hostname, and a production deployment's
// own hashed URL passed it (Copilot on #301).
import { describe, expect, it } from "vitest";
import { targetVerdict } from "./assistant-live-set.mjs";

describe("the live set's target guard", () => {
  it("allows a deployment that reports preview or development", () => {
    expect(targetVerdict("preview", "x-git-y.vercel.app").ok).toBe(true);
    expect(targetVerdict("development", "localhost").ok).toBe(true);
  });

  it("refuses production, and anything it could not read", () => {
    expect(targetVerdict("production", "x.vercel.app").ok).toBe(false);
    expect(targetVerdict(undefined, "x.vercel.app").ok).toBe(false);
    expect(targetVerdict("staging", "x.vercel.app").ok).toBe(false);
  });

  // A deployment that hides VERCEL_ENV reports null; that is only safe when
  // the target is this machine (review of #301).
  it("allows an unknown environment only on localhost", () => {
    expect(targetVerdict(null, "localhost").ok).toBe(true);
    expect(targetVerdict(null, "travel-collab-abc123xyz-team.vercel.app").ok).toBe(false);
  });
});
