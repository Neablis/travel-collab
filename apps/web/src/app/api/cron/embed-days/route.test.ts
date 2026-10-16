import { afterEach, describe, expect, it, vi } from "vitest";

// The route is a thin wrapper: secret check first, sweep second. These tests
// pin the first half — wrong or missing secret answers 401 before any
// database work. The second half (the sweep itself) is `sweep.int.test.ts`'s.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function routeWithEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // Imported AFTER the stubs: `serverConfig` reads the env once at load.
  return import("./route");
}

describe("GET /api/cron/embed-days", () => {
  it("answers 401 on a missing secret", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t" });
    const response = await GET(new Request("https://caesura.test/api/cron/embed-days"));
    expect(response.status).toBe(401);
  });

  it("answers 401 on a wrong secret", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t" });
    const response = await GET(
      new Request("https://caesura.test/api/cron/embed-days", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("answers 401 for everything when no secret is configured", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "" });
    const response = await GET(
      new Request("https://caesura.test/api/cron/embed-days", {
        headers: { authorization: "Bearer s3cr3t" },
      }),
    );
    expect(response.status).toBe(401);
  });
});
