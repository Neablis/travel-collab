import https from "node:https";
import { describe, expect, it, vi } from "vitest";
import { blockedRequestMessage } from "./networkGuard";

// The integration lane's half of "no test reaches a third party", asserted in
// the lane itself: `networkGuard.test.ts` runs in the UNIT lane, so it proves
// `vitest.setup.ts` and says nothing about `vitest.config.ts`'s setup file.
// This lane is the one that loads `.env.local`, which is why both checks live
// here rather than being taken on trust from the unit run.
describe("the integration lane's third-party guard", () => {
  it("rejects a fetch to a third-party host", async () => {
    const url = "https://third-party.invalid/v1/search";
    await expect(fetch(url)).rejects.toThrow(blockedRequestMessage(url));
  });

  // Beneath `fetch` (KI-2026-09-24-u): Node's `https`, which is what an SDK
  // that skips `fetch` would use, is refused at the socket in this lane too.
  it("refuses an https.request to a third-party host", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const message = await new Promise<string>((resolve) => {
      https.get("https://third-party.invalid/v1/search", () => resolve("response")).on("error", (e) => resolve(e.message));
    });
    expect(message).toBe(blockedRequestMessage("third-party.invalid:443"));
    vi.restoreAllMocks();
  });

  // Sentry's node transport posts over `https`, not `fetch`. The socket guard
  // would refuse the post, but Sentry would still attempt it and report the
  // failure in the middle of someone else's test, so an empty DSN — Sentry
  // never tries — stays the first line. Asserted through the module every
  // `Sentry.init` reads, not through `process.env`, because the module's own
  // fallback — the real DSN when the variable is unset — is the thing that
  // must not win.
  it("leaves Sentry with no DSN, whatever .env.local says", async () => {
    const { SENTRY_DSN, sentryEnabled } = await import("../../sentry.shared");
    expect(SENTRY_DSN).toBe("");
    expect(sentryEnabled).toBe(false);
  });
});
