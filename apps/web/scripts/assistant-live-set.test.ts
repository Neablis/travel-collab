// The live set spends real model calls, so its one guard is that it refuses
// any deployment that does not itself report preview or local development.
// The first version decided from the hostname, and a production deployment's
// own hashed URL passed it (Copilot on #301).
import { describe, expect, it } from "vitest";
import { argValue, isFatalStatus, targetVerdict, transportVerdict } from "./assistant-live-set.mjs";

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

// CodeRabbit on #301: the health request is the first to carry the cookie, so
// the transport is checked before it, not left to `targetVerdict` after it.
describe("the live set's transport guard", () => {
  it("allows HTTPS anywhere, and plain HTTP only to this machine", () => {
    expect(transportVerdict(new URL("https://x-git-y.vercel.app")).ok).toBe(true);
    expect(transportVerdict(new URL("http://localhost:3000")).ok).toBe(true);
    expect(transportVerdict(new URL("http://127.0.0.1:3000")).ok).toBe(true);
  });

  it("refuses plain HTTP to a remote host", () => {
    expect(transportVerdict(new URL("http://x-git-y.vercel.app")).ok).toBe(false);
  });
});

describe("the live set's arguments", () => {
  it("reads a flag's operand", () => {
    expect(argValue("--trip", ["node", "s", "u", "--trip", "t1"])).toBe("t1");
  });

  it("treats a flag followed by another flag, or by nothing, as missing", () => {
    expect(argValue("--trip", ["node", "s", "u", "--trip", "--confirm"])).toBeNull();
    expect(argValue("--trip", ["node", "s", "u", "--trip"])).toBeNull();
    expect(argValue("--trip", ["node", "s", "u"])).toBeNull();
  });
});

describe("the live set's stop condition", () => {
  it("stops on an auth or trip-access failure, and not on other statuses", () => {
    expect(isFatalStatus(401)).toBe(true);
    expect(isFatalStatus(403)).toBe(true);
    expect(isFatalStatus(200)).toBe(false);
    expect(isFatalStatus(500)).toBe(false);
  });
});
