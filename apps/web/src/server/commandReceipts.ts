import { and, eq, inArray, sql } from "drizzle-orm";
import type { Queryable } from "./db/client";
import { commandReceipts } from "./db/schema";
import { isUniqueViolation } from "./eventStore";

// Whether `command_receipts` exists yet. Migration 0041 runs on production
// only when `migrate-production` is dispatched, after the merge has already
// deployed this code. Every board edit carries a key, so a query against a
// missing table would fail every edit in that window. Until the table is
// there, receipts are skipped and a key does nothing, which is how commands
// behaved before ADR-066. Only a sighting is cached: once the migration lands,
// the next request sees the table and keeps it.
let tableSeen = false;

async function receiptsTableExists(q: Queryable): Promise<boolean> {
  if (tableSeen) return true;
  const { rows } = await q.execute<{ present: boolean }>(
    sql`select to_regclass('public.command_receipts') is not null as present`,
  );
  tableSeen = rows[0]?.present === true;
  if (!tableSeen) console.warn("command_receipts is missing; keys are ignored until migration 0041 runs (ADR-066).");
  return tableSeen;
}

/**
 * The keys among `keys` whose units are already applied to `tripId` (ADR-066).
 *
 * Read after the stream in the same transaction (`loadAndAuthorize` reads the
 * stream first). A unit whose receipt committed before that read is seen here.
 * One committing after it is caught by the primary key in `recordReceipts`.
 */
export async function appliedKeys(q: Queryable, tripId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0 || !(await receiptsTableExists(q))) return new Set();
  const rows = await q
    .select({ key: commandReceipts.key })
    .from(commandReceipts)
    .where(and(eq(commandReceipts.tripId, tripId), inArray(commandReceipts.key, [...keys])));
  return new Set(rows.map((r) => r.key));
}

/**
 * Record that the units with these keys were applied, in the transaction that
 * appended their events. True without writing anything while the table does
 * not exist yet (see `receiptsTableExists`). False when another transaction recorded one of them
 * first. Postgres has then aborted this transaction, so the caller must roll it
 * back. It may not commit.
 */
export async function recordReceipts(q: Queryable, tripId: string, keys: readonly string[]): Promise<boolean> {
  if (keys.length === 0 || !(await receiptsTableExists(q))) return true;
  const createdAt = new Date().toISOString();
  try {
    await q.insert(commandReceipts).values(keys.map((key) => ({ tripId, key, createdAt })));
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}
