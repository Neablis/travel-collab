import { afterEach, describe, expect, it, vi } from "vitest";

// The route is a wrapper: secret check first, then the full rewrite, then the
// one tag, cleared only when the ranked order moved. The rewrite's arithmetic
// and the order read are `discoverRank.int.test.ts`'s; these pin the wrapper.
const order: string[] = [];
// What `discoverRankOrder` answers before the rewrite, then after it.
let orders: string[][] = [["a", "b"], ["b", "a"]];
const discoverRankOrder = vi.fn(async () => {
  order.push("read");
  return orders.shift() ?? [];
});
const recomputeDiscoverRanks = vi.fn(async () => {
  order.push("recompute");
});
const revalidateTag = vi.fn((..._args: unknown[]) => {
  order.push("revalidate");
});
vi.mock("@/server/discoverRank", () => ({ discoverRankOrder, recomputeDiscoverRanks }));
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache: vi.fn() }));

afterEach(() => {
  order.length = 0;
  orders = [["a", "b"], ["b", "a"]];
  vi.unstubAllEnvs();
  vi.resetModules();
  recomputeDiscoverRanks.mockClear();
  discoverRankOrder.mockClear();
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
    expect(discoverRankOrder).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("with the secret, rewrites every public day's row (no day filter)", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    const response = await GET(authorised());
    expect(response.status).toBe(200);
    expect(recomputeDiscoverRanks).toHaveBeenCalledExactlyOnceWith();
  });

  it("when the order moved, revalidates only the discover-rank tag and says it cleared", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    const response = await GET(authorised());
    expect(revalidateTag.mock.calls).toEqual([["discover-rank", { expire: 0 }]]);
    expect(await response.json()).toEqual({ ok: true, cleared: true });
  });

  it("reads the order on both sides of the rewrite, and clears last, so no read re-caches the old order", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    await GET(authorised());
    expect(order).toEqual(["read", "recompute", "read", "revalidate"]);
  });

  it("when the order held, clears nothing and says so", async () => {
    orders = [["a", "b"], ["a", "b"]];
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    const response = await GET(authorised());
    expect(response.status).toBe(200);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, cleared: false });
  });

  it("counts a day joining the ranked list as a move, though the others kept their places", async () => {
    orders = [["a", "b"], ["a", "b", "c"]];
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    await GET(authorised());
    expect(revalidateTag).toHaveBeenCalledOnce();
  });

  it("does not answer ok when the tag clear fails", async () => {
    const { GET } = await routeWithEnv({ CRON_SECRET: "s3cr3t", NODE_ENV: "production" });
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("no cache");
    });
    await expect(GET(authorised())).rejects.toThrow("no cache");
  });
});
