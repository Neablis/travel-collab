import { and, eq, inArray } from "drizzle-orm";
import type { Queryable } from "./db/client";
import { commandReceipts } from "./db/schema";
import { isUniqueViolation } from "./eventStore";

/**
 * The keys among `keys` whose units are already applied to `tripId` (ADR-066).
 *
 * Read after the stream in the same transaction (`loadAndAuthorize` reads the
 * stream first). A unit whose receipt committed before that read is seen here.
 * One committing after it is caught by the primary key in `recordReceipts`.
 */
export async function appliedKeys(q: Queryable, tripId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await q
    .select({ key: commandReceipts.key })
    .from(commandReceipts)
    .where(and(eq(commandReceipts.tripId, tripId), inArray(commandReceipts.key, [...keys])));
  return new Set(rows.map((r) => r.key));
}

/**
 * Record that the units with these keys were applied, in the transaction that
 * appended their events. False when another transaction recorded one of them
 * first. Postgres has then aborted this transaction, so the caller must roll it
 * back. It may not commit.
 */
export async function recordReceipts(q: Queryable, tripId: string, keys: readonly string[]): Promise<boolean> {
  if (keys.length === 0) return true;
  const createdAt = new Date().toISOString();
  try {
    await q.insert(commandReceipts).values(keys.map((key) => ({ tripId, key, createdAt })));
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}
