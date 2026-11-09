import { afterEach, describe, expect, it, vi } from "vitest";

// The flag is an env var now (M59): no adapter, no Flags service. `true` is the
// only value that turns it on, so a typo cannot spend money.
describe("flags read their own environment variable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("aiLiveFlag is on for FLAG_AI_LIVE=true and off for anything else", async () => {
    const { aiLiveFlag } = await import("@/server/flags");
    vi.stubEnv("FLAG_AI_LIVE", "true");
    expect(await aiLiveFlag()).toBe(true);
    for (const other of ["", "TRUE", "1", "yes"]) {
      vi.stubEnv("FLAG_AI_LIVE", other);
      expect(await aiLiveFlag(), `FLAG_AI_LIVE=${JSON.stringify(other)}`).toBe(false);
    }
    vi.stubEnv("FLAG_AI_LIVE", undefined);
    expect(await aiLiveFlag()).toBe(false);
  });
});
