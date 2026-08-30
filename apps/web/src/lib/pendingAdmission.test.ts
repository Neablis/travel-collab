import { describe, expect, it } from "vitest";
import {
  PENDING_ADMISSION_COOKIE,
  PENDING_ADMISSION_MAX_LENGTH,
  normalizePendingAdmission,
  pendingAdmissionCookieOptions,
} from "./pendingAdmission";

describe("pendingAdmissionCookieOptions", () => {
  // M11a's exit gate asserts these four attributes by name. The module's
  // comment claims them; this is the test that keeps the claim honest.
  it("pins the cookie contract the milestone's exit gate states", () => {
    expect(PENDING_ADMISSION_COOKIE).toBe("pending_admission");
    const options = pendingAdmissionCookieOptions("caesura.example");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(600);
  });

  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3001", "[::1]", "[::1]:3000"])(
    "leaves Secure off for %s, so the http ci-like e2e lane can keep the cookie",
    (host) => {
      expect(pendingAdmissionCookieOptions(host).secure).toBe(false);
    },
  );

  it.each(["caesura.example", "caesura.example:443", "preview-abc.vercel.app"])(
    "sets Secure for the deployed host %s",
    (host) => {
      expect(pendingAdmissionCookieOptions(host).secure).toBe(true);
    },
  );

  // Not knowing the host must fail towards the stricter cookie, not the
  // looser one.
  it.each([null, ""])("sets Secure when the Host header is %j", (host) => {
    expect(pendingAdmissionCookieOptions(host).secure).toBe(true);
  });

  // "localhost.evil.example" is not localhost. Substring matching here would
  // hand an attacker-controlled host a non-Secure admission cookie.
  it.each(["localhost.evil.example", "notlocalhost", "127.0.0.1.evil.example"])(
    "does not mistake %s for localhost",
    (host) => {
      expect(pendingAdmissionCookieOptions(host).secure).toBe(true);
    },
  );
});

describe("normalizePendingAdmission", () => {
  it("trims, because a pasted code usually arrives with whitespace attached", () => {
    expect(normalizePendingAdmission("  SPRING-2026\n")).toBe("SPRING-2026");
  });

  it.each([null, undefined, "", "   "])(
    "returns null for %j, so an empty submit never clobbers a stored invite token",
    (value) => {
      expect(normalizePendingAdmission(value)).toBeNull();
    },
  );

  it("accepts a value exactly at the length bound", () => {
    const atBound = "c".repeat(PENDING_ADMISSION_MAX_LENGTH);
    expect(normalizePendingAdmission(atBound)).toBe(atBound);
  });

  it("refuses an oversized value rather than writing it into a response header", () => {
    expect(normalizePendingAdmission("c".repeat(PENDING_ADMISSION_MAX_LENGTH + 1))).toBeNull();
  });
});
