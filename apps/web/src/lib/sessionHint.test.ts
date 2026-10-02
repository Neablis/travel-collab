import { describe, expect, it } from "vitest";
import { hasSessionCookie } from "./sessionHint";

// The cookie that decides the app shell's first paint (`(app)/layout.tsx`).
// Only its absence is trusted, so the cost of a wrong "no" is a signed-in
// reader drawn signed out — what these pin is every name Auth.js writes.
describe("hasSessionCookie", () => {
  it.each([
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "authjs.session-token.0",
    "__Secure-authjs.session-token.1",
  ])("recognises %s", (name) => {
    expect(hasSessionCookie(["theme", name])).toBe(true);
  });

  it.each([
    [[]],
    [["authjs.csrf-token", "authjs.callback-url", "pending_admission"]],
    [["next-auth.session-token"]],
    [["authjs.session-token-extra", "xauthjs.session-token"]],
  ])("finds none in %j", (names) => {
    expect(hasSessionCookie(names)).toBe(false);
  });
});
