import { Redis } from "@upstash/redis";
import { serverConfig } from "../config";
import { createMemoryClient } from "./memory";

// **The shared Redis, as an expendable cache and nothing more** (ADR-059).
//
// One Upstash database on the FREE tier serves Preview and Production alike, so
// three rules hold for everything that goes through here:
//
//   * It is never a source of truth. A miss, an error and a timeout all read
//     as "not cached", and the caller does the real work. Nothing may be
//     written here that the database cannot answer again.
//   * It fails open, fast. Every call is bounded at 300 ms and swallowed on
//     error, so a slow or broken Redis costs a request its speed-up and
//     nothing else — never a 500, never a stall. One warning per instance.
//   * It is a port, the ADR-007 shape: callers get `getCache()` and never the
//     client. `CACHE_DRIVER` picks the store — Upstash, an in-process Map
//     (`memory.ts`, local dev only) or nothing — so nothing needs Redis to
//     run.
//
// Keys are built in `keys.ts`, which prefixes the environment: that file is
// the whole key space on the shared instance, in one place.

/** The three operations a cache use gets. None of them ever rejects. */
export interface CachePort {
  /** The stored value, or `null` for a miss, an error or a timeout. */
  get<T>(key: string): Promise<T | null>;
  /** Store `value` for `ttlSeconds`. Best-effort: a failure is ignored. */
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Forget `key`. Best-effort: a failure is ignored. */
  del(key: string): Promise<void>;
}

/** The subset of the Upstash client this module calls, so a test can hand in a fake. */
export interface RedisClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** How long any one call may take before it is treated as a miss. */
export const CACHE_TIMEOUT_MS = 300;

/** The cache when there is none: every read misses, every write is dropped. */
export const noopCache: CachePort = {
  get: async () => null,
  set: async () => {},
  del: async () => {},
};

let warned = false;

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`[cache] redis unavailable, serving uncached: ${error instanceof Error ? error.message : String(error)}`);
}

async function bounded<T>(run: () => Promise<T>, onFailure: T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (error) {
    warnOnce(error);
    return onFailure;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A `CachePort` over `client` that never rejects and never waits longer than
 * `timeoutMs`. Exported for the tests that prove both.
 */
export function createRedisCache(client: RedisClient, timeoutMs: number = CACHE_TIMEOUT_MS): CachePort {
  return {
    get: <T>(key: string) => bounded(() => client.get<T>(key), null, timeoutMs),
    set: (key, value, ttlSeconds) =>
      bounded(async () => void (await client.set(key, value, { ex: ttlSeconds })), undefined, timeoutMs),
    del: (key) => bounded(async () => void (await client.del(key)), undefined, timeoutMs),
  };
}

/** Which store backs the cache. `off` is the no-op. */
export type CacheDriver = "upstash" | "memory" | "off";

const DRIVERS: readonly string[] = ["upstash", "memory", "off"];

// **`memory` is for one process only** (CodeRabbit, PR #259). A deployment runs
// many instances, each with its own Map: instance A caches a pending invite's
// card, instance B handles the revoke and deletes from ITS Map, and A goes on
// naming the sender for up to the hour's TTL. A revoke must reach every copy,
// and only a shared store can do that, so on Vercel (`VERCEL_ENV` set) the
// choices are Upstash or nothing. Local dev is one `next dev` process, which is
// where `memory` is right.
/**
 * `CACHE_DRIVER`, resolved (ADR-059). Blank means auto: `upstash` when both
 * credentials are set; otherwise `memory` locally and `off` on Vercel. An
 * explicit valid value wins, except `upstash` without both credentials (falls
 * back as auto would) and `memory` on Vercel (`off`). An unknown value is auto.
 * `warning` is set whenever the request was not honoured as written. Pure, for
 * the resolution table's test.
 */
export function resolveCacheDriver(input: {
  requested: string;
  url: string;
  token: string;
  onVercel: boolean;
}): { driver: CacheDriver; warning: string | null } {
  const hasCredentials = input.url !== "" && input.token !== "";
  const withoutShared: CacheDriver = input.onVercel ? "off" : "memory";
  const auto: CacheDriver = hasCredentials ? "upstash" : withoutShared;
  const requested = input.requested.trim();
  if (requested === "") return { driver: auto, warning: null };
  if (!DRIVERS.includes(requested)) {
    return { driver: auto, warning: `CACHE_DRIVER="${requested}" is not upstash|memory|off; using ${auto}` };
  }
  if (requested === "upstash" && !hasCredentials) {
    return {
      driver: withoutShared,
      warning: `CACHE_DRIVER=upstash but KV_REST_API_URL/KV_REST_API_TOKEN are not both set; using ${withoutShared}`,
    };
  }
  if (requested === "memory" && input.onVercel) {
    return {
      driver: "off",
      warning: "CACHE_DRIVER=memory is per-instance, so a revoke on one instance would not clear another; using off",
    };
  }
  return { driver: requested as CacheDriver, warning: null };
}

// **A singleton, resolved once per process.** It has to be: the memory driver
// IS its Map, so resolving per call would hand every request an empty cache.
// Tests are kept out of it without a reset hook, in two ways. Both Vitest
// configs set `CACHE_DRIVER=off` (unless a run sets it deliberately), so no
// test reaches a real or in-memory store by default. And Vitest isolates
// modules per file, so even a file that opts in cannot leak state into
// another. A test that wants a cache injects a port: every lookup that uses
// one takes it as a parameter.
let cache: CachePort | null = null;

/** The process's cache, per `CACHE_DRIVER` (see `resolveCacheDriver`). */
export function getCache(): CachePort {
  if (cache !== null) return cache;
  const { cacheDriver, kvRestApiUrl: url, kvRestApiToken: token } = serverConfig;
  const onVercel = (process.env.VERCEL_ENV ?? "") !== "";
  const { driver, warning } = resolveCacheDriver({ requested: cacheDriver, url, token, onVercel });
  // Once, because the singleton means this branch runs once per instance.
  if (warning !== null) console.warn(`[cache] ${warning}`);
  cache =
    driver === "upstash"
      ? createRedisCache(
          // No retries: a retry is a second command against a free-tier budget,
          // spent on a request that will already have given up at 300 ms.
          new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(CACHE_TIMEOUT_MS) }),
        )
      : driver === "memory"
        ? createRedisCache(createMemoryClient())
        : noopCache;
  return cache;
}
