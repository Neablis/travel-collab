import { describe, expect, it } from "vitest";
import { normalizeSignupRef, signupRefCookieOptions } from "./signupRef";

// The ref arrives from any link anyone writes and ends up in a response header
// and a users column (ADR-079), so what is kept is exactly the channel label.
describe("normalizeSignupRef", () => {
  it("keeps a channel label, lowercased", () => {
    expect(normalizeSignupRef("ShowHN")).toBe("showhn");
    expect(normalizeSignupRef("side-project-2")).toBe("side-project-2");
  });

  it.each([
    ["nothing", null],
    ["empty", ""],
    ["a space", "show hn"],
    ["punctuation", "showhn;"],
    ["an underscore", "show_hn"],
    ["33 characters", "a".repeat(33)],
  ])("drops %s", (_label, raw) => {
    expect(normalizeSignupRef(raw)).toBeNull();
  });

  it("keeps 32 characters", () => {
    expect(normalizeSignupRef("a".repeat(32))).toBe("a".repeat(32));
  });
});

describe("signupRefCookieOptions", () => {
  it("is HttpOnly, Lax, a month long, and Secure off localhost", () => {
    expect(signupRefCookieOptions("caesura.app")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2_592_000,
      secure: true,
    });
    expect(signupRefCookieOptions("localhost:3001").secure).toBe(false);
  });
});
