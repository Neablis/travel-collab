import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ getCsrfToken: async () => "csrf" }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));

import { checkWithPasskey } from "./mfaClient";

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
