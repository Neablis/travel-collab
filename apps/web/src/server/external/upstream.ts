// What any outside source's port answers, whatever the capability (ADR-052
// decision 1): weather today, and the next external widget's port tomorrow,
// which reuses the cache in `cache.ts` through exactly these types.

/** What an earlier answer lets us ask conditionally. */
export interface CacheValidators {
  lastModified: string;
}

/**
 * One call's outcome that is not a failure. Failures THROW (`UpstreamError`),
 * because the cache's answer to every failure is the same — serve the stale
 * row — and a union member for each would be one more thing to forget.
 */
export type Fetched<T> =
  | {
      kind: "fresh";
      value: T;
      expiresAt: Date;
      lastModified: string | null;
      /** The source's own as-of, when it states one. */
      sourceUpdatedAt: Date | null;
    }
  | { kind: "not-modified"; expiresAt: Date; lastModified: string | null };

/**
 * A call that did not answer usefully. `status` is the HTTP status when there
 * was one; `retryAfter` is when a 429 said to come back.
 */
export class UpstreamError extends Error {
  readonly status: number | null;
  readonly retryAfter: Date | null;
  constructor(message: string, status: number | null = null, retryAfter: Date | null = null) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
