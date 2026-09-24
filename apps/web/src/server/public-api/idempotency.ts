import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiIdempotencyKeys } from "@/server/db/schema";

// **`Idempotency-Key` for `v1` writes that opt in** (ADR-051). `route()` calls
// this when a declaration sets `idempotent`; nothing else does.
//
// The contract, in the order a request meets it:
//
// 1. The header is optional. Present, it is 1..255 characters or the request
//    is a 400 before anything runs.
// 2. The key is RESERVED before the handler runs — an insert that only one
//    request can win — so two concurrent requests with one key cannot both run.
// 3. The same user, key, method, path and body hash as a finished request
//    replays that request's status and body without running the handler. A
//    different method, path or body under the same key is a 400; the same
//    request while the first is still running is a 409.
// 4. An answer is kept when the handler finished: every 2xx and 4xx, and a
//    5xx that came after it (a payload failing its own schema — its writes
//    landed). The row is deleted, and a retry runs, only when the handler did
//    not finish (it crashed) or refused with a `retryable` answer (an append
//    that lost the race with no caller precondition). `route()` decides which.
// 5. After 24 hours a row is treated as absent and overwritten. No sweep.

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long an unfinished reservation holds its key.
 *
 * **A lease, because a process can die holding one.** Without it a crash
 * between reserve and complete leaves the key answering 409 for a day. Five
 * minutes is well past any function's run time here, so a reservation older than
 * that is abandoned rather than slow — the same reasoning as the billing
 * webhook's claim lease (`billing/webhook.ts`, PR #177).
 */
export const IDEMPOTENCY_LEASE_MS = 5 * 60 * 1000;

/** The response header a replayed answer carries. */
export const REPLAYED_HEADER = "Idempotent-Replayed";

/**
 * JSON with every object's keys sorted, so two bodies that parse to the same
 * value hash the same whatever order their keys arrived in. `undefined`
 * properties are dropped, as `JSON.stringify` drops them.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** sha256 of the parsed body's canonical JSON, hex. */
export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/** The header's value, `null` when absent, or the reason it is refused. */
export function readIdempotencyKey(headers: Headers): { key: string | null } | { refused: string } {
  const key = headers.get("idempotency-key");
  if (key === null) return { key: null };
  if (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { refused: `Idempotency-Key must be 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.` };
  }
  return { key };
}

/** What a request is, for comparing it with the one a key was first used for. */
export interface Fingerprint {
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
}

/** A stored reservation, as far as deciding about it needs. */
export interface StoredKey extends Fingerprint {
  readonly statusCode: number | null;
  readonly response: unknown;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export type KeyDecision =
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "mismatch" }
  | { kind: "in-flight" }
  /** Expired, or an abandoned reservation: take it over and run. */
  | { kind: "reclaim" };

/**
 * What to do with a key that already has a row. Pure; `now` is passed in.
 *
 * **Expiry is checked first**, because an expired row is "absent" — even a
 * different request may reuse the key once it has. Then a different request is
 * refused whether or not the first one has finished, since telling a caller
 * "wait" about a request that will never match would be wrong twice.
 */
export function decideKey(row: StoredKey, incoming: Fingerprint, now: Date): KeyDecision {
  const age = now.getTime() - row.createdAt.getTime();
  if (age >= IDEMPOTENCY_TTL_MS) return { kind: "reclaim" };
  if (
    row.method !== incoming.method ||
    row.path !== incoming.path ||
    row.requestHash !== incoming.requestHash
  ) {
    return { kind: "mismatch" };
  }
  if (row.completedAt !== null && row.statusCode !== null) {
    return { kind: "replay", status: row.statusCode, body: row.response };
  }
  return age >= IDEMPOTENCY_LEASE_MS ? { kind: "reclaim" } : { kind: "in-flight" };
}

export type Reservation =
  | { kind: "run" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "mismatch" }
  | { kind: "in-flight" };

/**
 * Reserve `key` for this request, or say why not.
 *
 * The insert is the lock. A losing insert reads the row and decides; a
 * takeover (expired or abandoned) is an UPDATE matched on the `created_at` it
 * read, so of two requests taking over the same stale row only one matches and
 * the other is told the key is in flight.
 */
export async function reserveKey(
  userId: string,
  key: string,
  incoming: Fingerprint,
  now: Date,
): Promise<Reservation> {
  const fresh = {
    method: incoming.method,
    path: incoming.path,
    requestHash: incoming.requestHash,
    statusCode: null,
    response: null,
    createdAt: now,
    completedAt: null,
  };
  const inserted = await db
    .insert(apiIdempotencyKeys)
    .values({ userId, key, ...fresh })
    .onConflictDoNothing()
    .returning({ key: apiIdempotencyKeys.key });
  if (inserted.length > 0) return { kind: "run" };

  const [row] = await db
    .select()
    .from(apiIdempotencyKeys)
    .where(and(eq(apiIdempotencyKeys.userId, userId), eq(apiIdempotencyKeys.key, key)));
  // Released between our insert and this read: the other request is
  // retryable and so is this one, but running now would race its retry. Say so.
  if (row === undefined) return { kind: "in-flight" };

  const decision = decideKey(row, incoming, now);
  if (decision.kind !== "reclaim") return decision;
  const taken = await db
    .update(apiIdempotencyKeys)
    .set(fresh)
    .where(
      and(
        eq(apiIdempotencyKeys.userId, userId),
        eq(apiIdempotencyKeys.key, key),
        eq(apiIdempotencyKeys.createdAt, row.createdAt),
      ),
    )
    .returning({ key: apiIdempotencyKeys.key });
  return taken.length > 0 ? { kind: "run" } : { kind: "in-flight" };
}

/**
 * The row this request reserved, and only that one. Matched on `reservedAt` —
 * the `now` it was reserved with — so a request that outran its lease cannot
 * finish or release the reservation that took its key over.
 */
function ours(userId: string, key: string, reservedAt: Date) {
  return and(
    eq(apiIdempotencyKeys.userId, userId),
    eq(apiIdempotencyKeys.key, key),
    eq(apiIdempotencyKeys.createdAt, reservedAt),
    isNull(apiIdempotencyKeys.completedAt),
  );
}

/** Keep the answer, which is what makes the next request with this key a replay. */
export async function completeKey(
  userId: string,
  key: string,
  reservedAt: Date,
  status: number,
  body: unknown,
  now: Date,
): Promise<void> {
  await db
    .update(apiIdempotencyKeys)
    .set({ statusCode: status, response: body, completedAt: now })
    .where(ours(userId, key, reservedAt));
}

/** Give the key back after an unfinished or retryable answer, so a retry runs instead of replaying it. */
export async function releaseKey(userId: string, key: string, reservedAt: Date): Promise<void> {
  await db.delete(apiIdempotencyKeys).where(ours(userId, key, reservedAt));
}
