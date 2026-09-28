import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisCache, resolveCacheDriver, type RedisClient } from "./redis";

// ADR-059's fail-open rule, on the wrapper every Redis call goes through: an
// error or a slow answer is a miss, never a rejection and never a wait.

const failing = (make: () => Promise<never>): RedisClient => ({
  get: make,
  set: make,
  del: make,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveCacheDriver", () => {
  // `local` is one `next dev` process; `vercel` is many instances, where a
  // per-process Map cannot see another instance's revoke.
  const local = { onVercel: false };
  const vercel = { onVercel: true };
  const creds = { url: "https://example.upstash.io", token: "t" };
  const none = { url: "", token: "" };

  it.each([
    ["local, auto, with credentials", "upstash", false, { requested: "", ...creds, ...local }],
    ["local, auto, without credentials", "memory", false, { requested: "", ...none, ...local }],
    ["local, auto, with only the URL", "memory", false, { requested: "", url: creds.url, token: "", ...local }],
    ["local, explicit memory, with credentials", "memory", false, { requested: "memory", ...creds, ...local }],
    ["local, explicit off, with credentials", "off", false, { requested: "off", ...creds, ...local }],
    ["local, explicit upstash, with credentials", "upstash", false, { requested: "upstash", ...creds, ...local }],
    ["local, explicit upstash, missing credentials", "memory", true, { requested: "upstash", ...none, ...local }],
    ["local, invalid, with credentials", "upstash", true, { requested: "redis", ...creds, ...local }],
    ["local, invalid, without credentials", "memory", true, { requested: "Memory", ...none, ...local }],
    ["vercel, auto, with credentials", "upstash", false, { requested: "", ...creds, ...vercel }],
    ["vercel, auto, without credentials", "off", false, { requested: "", ...none, ...vercel }],
    ["vercel, explicit memory", "off", true, { requested: "memory", ...creds, ...vercel }],
    ["vercel, explicit off", "off", false, { requested: "off", ...creds, ...vercel }],
    ["vercel, explicit upstash, missing credentials", "off", true, { requested: "upstash", ...none, ...vercel }],
    ["vercel, invalid, without credentials", "off", true, { requested: "redis", ...none, ...vercel }],
  ] as const)("%s → %s", (_case, driver, warns, input) => {
    const resolved = resolveCacheDriver(input);

    expect(resolved.driver).toBe(driver);
    expect(resolved.warning !== null).toBe(warns);
  });
});

describe("createRedisCache", () => {
  it("turns a thrown error into a miss, and a failed write into nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createRedisCache(failing(() => Promise.reject(new Error("ECONNRESET"))));

    await expect(cache.get("k")).resolves.toBeNull();
    await expect(cache.set("k", 1, 60)).resolves.toBeUndefined();
    await expect(cache.del("k")).resolves.toBeUndefined();
  });

  it("gives up on a call that does not answer within the timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createRedisCache(failing(() => new Promise<never>(() => {})), 20);

    const started = Date.now();
    await expect(cache.get("k")).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("passes the TTL through as seconds", async () => {
    const set = vi.fn(async () => "OK");
    const cache = createRedisCache({ get: async () => null, set, del: async () => 1 });

    await cache.set("k", { a: 1 }, 3600);

    expect(set).toHaveBeenCalledWith("k", { a: 1 }, { ex: 3600 });
  });
});
