import { describe, expect, it } from "vitest";
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

  // Sentry's node transport posts over `https`, not `fetch`, so the guard above
  // cannot see it; the DSN is the only lever. Asserted through the module every
  // `Sentry.init` reads, not through `process.env`, because the module's own
  // fallback — the real DSN when the variable is unset — is the thing that
  // must not win.
  it("leaves Sentry with no DSN, whatever .env.local says", async () => {
    const { SENTRY_DSN, sentryEnabled } = await import("../../sentry.shared");
    expect(SENTRY_DSN).toBe("");
    expect(sentryEnabled).toBe(false);
  });
});
