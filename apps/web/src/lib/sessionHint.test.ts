import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  LEAVE_LANDING_IF_SIGNED_IN,
  SIGNED_IN_HINT_COOKIE,
  clearSignedInHint,
  hasSessionCookie,
  hasSignedInHint,
  setSignedInHint,
} from "./sessionHint";

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

// The shipped string itself is run, not a re-implementation of it: what this
// pins is the decision the landing makes before it paints (ADR-078).
describe("LEAVE_LANDING_IF_SIGNED_IN", () => {
  function run(pathname: string, cookie: string) {
    const replace = vi.fn();
    runInNewContext(LEAVE_LANDING_IF_SIGNED_IN, { location: { pathname, replace }, document: { cookie } });
    return replace;
  }

  it.each([`${SIGNED_IN_HINT_COOKIE}=1`, `theme=dark; ${SIGNED_IN_HINT_COOKIE}=1; other=2`])(
    "sends a hinted visitor on / to Home (%s)",
    (cookie) => {
      expect(run("/", cookie)).toHaveBeenCalledWith("/home");
    },
  );

  it.each([
    ["/", ""],
    ["/", "theme=dark"],
    ["/", `x${SIGNED_IN_HINT_COOKIE}=1`],
    ["/signin", `${SIGNED_IN_HINT_COOKIE}=1`],
    ["/home", `${SIGNED_IN_HINT_COOKIE}=1`],
  ])("stays on %s with cookies %j", (pathname, cookie) => {
    expect(run(pathname, cookie)).not.toHaveBeenCalled();
  });
});

describe("hasSignedInHint", () => {
  it.each([
    [`${SIGNED_IN_HINT_COOKIE}=1`, true],
    [`theme=dark; ${SIGNED_IN_HINT_COOKIE}=1`, true],
    [`x${SIGNED_IN_HINT_COOKIE}=1`, false],
    ["", false],
  ])("reads %j as %s", (cookie, expected) => {
    expect(hasSignedInHint(cookie)).toBe(expected);
  });
});

// Before `clearSignedInHint`'s block on purpose: clearing locks the setter for
// the rest of the module's life, as it does for a document signing out.
describe("setSignedInHint", () => {
  it("sets the hint readable by script, site-wide, for the session's 30 days", () => {
    const doc = { cookie: "" };
    setSignedInHint(doc, false);
    expect(doc.cookie).toBe(`${SIGNED_IN_HINT_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`);
  });

  it("marks it Secure on https", () => {
    const doc = { cookie: "" };
    setSignedInHint(doc, true);
    expect(doc.cookie).toMatch(/; Secure$/);
  });
});

describe("clearSignedInHint", () => {
  it("expires the hint at the path it was set on", () => {
    const doc = { cookie: "" };
    clearSignedInHint(doc);
    expect(doc.cookie).toMatch(new RegExp(`^${SIGNED_IN_HINT_COOKIE}=;`));
    expect(doc.cookie).toContain("Path=/");
    expect(doc.cookie).toContain("Max-Age=0");
  });

  it("stops the setter putting the hint back for the rest of the document", () => {
    clearSignedInHint({ cookie: "" });
    const doc = { cookie: "" };
    setSignedInHint(doc, false);
    expect(doc.cookie).toBe("");
  });
});
