import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ getCsrfToken: async () => "csrf" }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));

import { checkWithCode, checkWithPasskey, confirmAuthenticator } from "./mfaClient";

function answers(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

// The verify route answers 401 for a session it does not know and for a passkey
// that did not verify; only the first is a dead end for the screen.
describe("checkWithPasskey", () => {
  it("tells a 401 for no session from every other refusal", async () => {
    answers(401, { error: "unauthenticated" });
    expect(await checkWithPasskey()).toBe("signed-out");
    answers(401, { error: "passkey-not-verified" });
    expect(await checkWithPasskey()).toBe("refused");
  });

  it("tells an account with two-step sign-in turned off from one with no passkey", async () => {
    answers(409, { error: "mfa-not-enabled" });
    expect(await checkWithPasskey()).toBe("not-required");
    answers(409, { error: "no-passkey" });
    expect(await checkWithPasskey()).toBe("unavailable");
  });
});

describe("checkWithCode", () => {
  it("tells a 401 for no session, and a turned-off second step, from a wrong code", async () => {
    answers(401, { error: "unauthenticated" });
    expect(await checkWithCode("otp", "123456")).toBe("signed-out");
    answers(409, { error: "mfa-not-enabled" });
    expect(await checkWithCode("otp", "123456")).toBe("not-required");
    answers(401, { error: "code-not-verified" });
    expect(await checkWithCode("otp", "123456")).toBe("refused");
  });
});

describe("confirmAuthenticator", () => {
  it("reads the 403 that a lapsed check gets as a way back to the check, not a failure", async () => {
    answers(403, { error: "fresh-check-required" });
    expect(await confirmAuthenticator("t", "123456")).toEqual({ status: "fresh-check-required" });
  });

  it("says when the session could not be told, after one more try", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "/api/account/mfa/totp") {
          return new Response(JSON.stringify({ recoveryCodes: ["a-b"], proof: { method: "otp" } }), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      }),
    );
    expect(await confirmAuthenticator("t", "123456")).toEqual({ status: "added", recoveryCodes: ["a-b"], signedIn: false });
    expect(calls.filter((url) => url === "/api/auth/session")).toHaveLength(2);
  });
});
