import { afterEach, describe, expect, it, vi } from "vitest";

// The route is a wrapper: secret check first, then the full rewrite, then the
// one tag. The rewrite's arithmetic is `discoverRank.int.test.ts`'s; these pin
// the wrapper's three promises.
const order: string[] = [];
const recomputeDiscoverRanks = vi.fn(async () => {
  order.push("recompute");
});
const revalidateTag = vi.fn((..._args: unknown[]) => {
  order.push("revalidate");
});
vi.mock("@/server/discoverRank", () => ({ recomputeDiscoverRanks }));
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache: vi.fn() }));

afterEach(() => {
  order.length = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
  recomputeDiscoverRanks.mockClear();
  revalidateTag.mockClear();
});

async function routeWithEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // Imported AFTER the stubs: `serverConfig` reads the env once at load.
  return import("./route");
}

const URL = "https://caesura.test/api/cron/discover-rank";
const authorised = () => new Request(URL, { headers: { authorization: "Bearer s3cr3t" } });

describe("GET /api/cron/discover-rank", () => {
  it("answers 401 without the secret, and rewrites nothing", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    const response = await GET(new Request(URL));
    expect(response.status).toBe(401);
    expect(recomputeDiscoverRanks).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("with the secret, rewrites every public day's row (no day filter)", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    const response = await GET(authorised());
    expect(response.status).toBe(200);
    expect(recomputeDiscoverRanks).toHaveBeenCalledExactlyOnceWith();
  });

  it("with the secret, revalidates only the discover-rank tag", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    await GET(authorised());
    expect(revalidateTag.mock.calls).toEqual([["discover-rank", { expire: 0 }]]);
  });

  it("rewrites before it clears, so no read re-caches the old order", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    await GET(authorised());
    expect(order).toEqual(["recompute", "revalidate"]);
  });

  it("does not answer ok when the tag clear fails", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("no cache");
    });
    await expect(GET(authorised())).rejects.toThrow("no cache");
  });
});
