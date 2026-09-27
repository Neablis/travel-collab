import type { RedisClient } from "./redis";

// The in-process driver (ADR-059, `CACHE_DRIVER=memory`): what a dev server
// uses when no Upstash credentials are set, so a cache hit, an expiry and a
// revoke's delete all happen locally instead of never happening at all.
//
// **It stores what Upstash stores, and reads it back the way Upstash's client
// does.** Upstash keeps a string as-is and anything else as its
// `JSON.stringify`, and `@upstash/redis` (automatic deserialization on) runs
// `JSON.parse` over whatever it reads, keeping a number only when it prints back
// to the same text. So a bare `"123"` goes in as a string and comes out as the
// number 123. That is the bug class `og/referral.ts` avoids by wrapping the name
// in an object, and copying the behaviour here is what makes it show up on a
// laptop rather than first in production. A plain `JSON.stringify` on write
// would round-trip `"123"` faithfully and hide it.
//
// Per instance, and so capped: `maxEntries` bounds a long-running dev server,
// evicting the oldest write first. Expiry is lazy, checked on read.

type Entry = { raw: string; expiresAt: number };

function serialize(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}

// `@upstash/redis`'s `parseResponse`, for a single value.
function deserialize(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "number" && parsed.toString() !== raw ? raw : parsed;
  } catch {
    return raw;
  }
}

/**
 * A `RedisClient` held in a `Map`: per-key TTL, lazy expiry, at most
 * `maxEntries` keys (oldest write evicted first), Upstash's serialization.
 * `now` is injected so a test can move time.
 */
export function createMemoryClient(maxEntries = 1000, now: () => number = Date.now): RedisClient {
  const entries = new Map<string, Entry>();
  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      return deserialize(entry.raw) as T;
    },
    async set(key, value, { ex }) {
      // Delete first so a rewrite moves the key to the back of the eviction order.
      entries.delete(key);
      entries.set(key, { raw: serialize(value), expiresAt: now() + ex * 1000 });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return "OK";
    },
    async del(key) {
      return entries.delete(key) ? 1 : 0;
    },
  };
}
