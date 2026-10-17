import { afterEach, describe, expect, it, vi } from "vitest";

// The route is a thin wrapper: secret check first, rollup second. These tests
// pin the first half — a missing or wrong secret answers 401 and the rollup
// never runs, so nothing is written. The rollup itself is
// `tierRollup.int.test.ts`'s.

const rollupTiers = vi.fn(async () => ({ weekStart: "2031-03-10", accounts: {} }));
vi.mock("@/server/entitlements/tierRollup", () => ({ rollupTiers }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rollupTiers.mockClear();
});

async function routeWithEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // Imported AFTER the stubs: `serverConfig` reads the env once at load.
  return import("./route");
}

const URL = "https://caesura.test/api/cron/tier-rollup";

describe("GET /api/cron/tier-rollup", () => {
  it("answers 401 and writes nothing on a missing secret", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t" });
    const response = await GET(new Request(URL));
    expect(response.status).toBe(401);
    expect(rollupTiers).not.toHaveBeenCalled();
  });

  it("answers 401 and writes nothing on a wrong secret", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t" });
    const response = await GET(new Request(URL, { headers: { authorization: "Bearer wrong" } }));
    expect(response.status).toBe(401);
    expect(rollupTiers).not.toHaveBeenCalled();
  });

  it("runs the rollup on the right secret", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t" });
    const response = await GET(new Request(URL, { headers: { authorization: "Bearer s3cr3t" } }));
    expect(response.status).toBe(200);
    expect(rollupTiers).toHaveBeenCalledTimes(1);
  });
});
