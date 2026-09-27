import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisCache, type RedisClient } from "./redis";

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
