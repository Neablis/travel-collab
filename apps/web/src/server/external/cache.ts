import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db as defaultDb, type Db } from "../db/client";
import { externalDataCache } from "../db/schema";
import { UpstreamError, type CacheValidators, type Fetched } from "./upstream";

// The read-through cache in front of every outside source (ADR-052 decision 2),
// and **the only module that writes `external_data_cache`**
// (`external.soleWriter.test.ts`).
//
// Postgres rather than memory because serverless has no shared memory — the
// argument `rate_limit_counters`' header already makes — and rather than Next's
// data cache because that cannot send `If-Modified-Since`, cannot take its
// lifetime from a per-response `Expires`, and has no serve-stale-on-error we
// control. The read path, in order:
//
// 1. a fresh row (`now < expires_at`) is served, and nothing is called;
// 2. a key in back-off (a 429 said to wait) calls nothing, and serves what it has;
// 3. a call is CHARGED to our own quota first — only here, on a miss — and a
//    refusal serves what it has;
// 4. an expired row is revalidated with `If-Modified-Since`; a 304 moves
//    `expires_at` and keeps the payload;
// 5. a failed call — an error, a timeout, a 429 — serves the expired row if
//    there is one, with its own older as-of, and answers `null` only when
//    there is no row at all.
//
// Two instances missing the same key at once both fetch; at this scale that is
// cheaper than a lease (decision 2).

/** A row as the read path sees it. */
export interface CacheRow {
  key: string;
  payload: unknown;
  fetchedAt: Date;
  expiresAt: Date;
  lastModified: string | null;
  sourceUpdatedAt: Date | null;
  backoffUntil: Date | null;
}

/** The table's I/O, injected so the read path is testable without Postgres. */
export interface CacheStore {
  read(key: string): Promise<CacheRow | null>;
  write(row: CacheRow): Promise<void>;
}

/** The `external_data_cache` table as a `CacheStore`: read a row by key, upsert a row whole. */
export function pgCacheStore(database: Db = defaultDb): CacheStore {
  return {
    async read(key) {
      const [row] = await database.select().from(externalDataCache).where(eq(externalDataCache.key, key));
      return row ?? null;
    },
    async write(row) {
      await database
        .insert(externalDataCache)
        .values(row)
        .onConflictDoUpdate({
          target: externalDataCache.key,
          set: {
            payload: row.payload, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt, lastModified: row.lastModified,
            sourceUpdatedAt: row.sourceUpdatedAt, backoffUntil: row.backoffUntil,
          },
        });
    },
  };
}

/** What the cache answered: the value, and whether it is past its `Expires`. */
export interface Cached<T> {
  value: T;
  stale: boolean;
}

export interface ReadThrough<T> {
  key: string;
  /** Reads a stored payload back; one written by an older build that no longer fits is treated as absent. */
  schema: z.ZodType<T>;
  /** The port call. Throws on failure (`UpstreamError` for a 429's back-off). */
  call: (prior?: CacheValidators) => Promise<Fetched<T>>;
  /** Charges one call to our own quota; `false` is a refusal (decision 8). */
  charge: () => Promise<boolean>;
  store: CacheStore;
  now: Date;
  /** Decision 8: each upstream call gets this long, and then the row is served as if it had failed. */
  timeoutMs: number;
}

class TimedOut extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One key through the read path in this file's header. Returns the value and
 * whether it is past its `Expires`, or `null` when there is nothing to serve.
 * Never throws for the source; a store error propagates.
 */
export async function readThrough<T>(options: ReadThrough<T>): Promise<Cached<T> | null> {
  const { key, schema, store, now } = options;
  const row = await store.read(key);
  const parsed = row?.payload == null ? null : schema.safeParse(row.payload);
  const held = parsed?.success ? parsed.data : null;
  const serveHeld = (): Cached<T> | null => (held === null ? null : { value: held, stale: true });

  if (row && held !== null && now < row.expiresAt) return { value: held, stale: false };
  if (row?.backoffUntil && now < row.backoffUntil) return serveHeld();
  if (!(await options.charge())) return serveHeld();

  // Conditional only when there is a payload to keep: a 304 to a request for
  // a row that holds nothing would leave nothing to serve.
  const prior = held !== null && row?.lastModified ? { lastModified: row.lastModified } : undefined;
  let fetched: Fetched<T>;
  try {
    fetched = await withTimeout(options.call(prior), options.timeoutMs);
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 429 && error.retryAfter) {
      // A row that never held anything is still written, so the back-off
      // outlives this request; it expires at once and serves nothing.
      await store.write({
        key,
        payload: row?.payload ?? null,
        fetchedAt: row?.fetchedAt ?? now,
        expiresAt: row?.expiresAt ?? now,
        lastModified: row?.lastModified ?? null,
        sourceUpdatedAt: row?.sourceUpdatedAt ?? null,
        backoffUntil: error.retryAfter,
      });
    }
    // 403 and 203 are logged where they are understood, in the adapter.
    console.warn(`[external] ${key}: ${error instanceof Error ? error.message : String(error)}`);
    return serveHeld();
  }

  if (fetched.kind === "not-modified") {
    if (held === null || !row) return null;
    await store.write({
      ...row,
      expiresAt: fetched.expiresAt,
      lastModified: fetched.lastModified ?? row.lastModified,
      backoffUntil: null,
    });
    return { value: held, stale: false };
  }
  await store.write({
    key,
    payload: fetched.value,
    fetchedAt: now,
    expiresAt: fetched.expiresAt,
    lastModified: fetched.lastModified,
    sourceUpdatedAt: fetched.sourceUpdatedAt,
    backoffUntil: null,
  });
  return { value: fetched.value, stale: false };
}
