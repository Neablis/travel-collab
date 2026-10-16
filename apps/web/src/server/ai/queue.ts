// Server-only: never import from UI code. The embed-on-write side of the
// plan-retrieval RAG stack (Part 2 of 5): playbook and trip writes queue day
// indexes into `pending_embeddings`, and the cron sweep (`sweep.ts`) drains
// the queue. The queue is the ONLY writer of `pending_embeddings` besides the
// backfill script; the sweep is its only reader.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, type Queryable } from "@/server/db/client";

/** Which corpus a queued day belongs to: a playbook (`saved_days`) or a trip (the planning log). */
export type EmbedSourceType = "playbook" | "trip";

/** One queue upsert: insert, or reset to `pending` a row the sweep already finished or dead-lettered. */
function queueUpsert(sourceType: EmbedSourceType, sourceId: string, dayIndex: number) {
  return sql`
    INSERT INTO pending_embeddings (id, source_type, source_id, day_index, status, attempts, created_at)
    VALUES (${randomUUID()}, ${sourceType}, ${sourceId}, ${dayIndex}, 'pending', 0, now())
    ON CONFLICT (source_type, source_id, day_index)
    DO UPDATE SET status = 'pending', attempts = 0
    WHERE pending_embeddings.status IN ('done', 'dead')
  `;
}

/**
 * Queue day indexes for (re-)embedding. Idempotent: the unique key
 * `(source_type, source_id, day_index)` makes a double-enqueue a no-op.
 *
 * A content change must re-embed even a day the sweep already finished, so a
 * row sitting at `done` or `dead` is reset to `pending` with a fresh attempt
 * budget. A row already `pending` — or `processing`, which the sweep recovers
 * on its next run — is left alone.
 *
 * **Fail-open, like everything on this path.** A queue write must never break
 * the playbook or trip write that triggered it, so this function catches
 * everything, logs, and returns. The worst case is a day the next backfill
 * picks up.
 */
export async function enqueueDayChunksForEmbedding(
  sourceType: EmbedSourceType,
  sourceId: string,
  dayIndexes: readonly number[],
): Promise<void> {
  const indexes = [...new Set(dayIndexes)];
  if (indexes.length === 0) return;
  try {
    for (const dayIndex of indexes) {
      await db.execute(queueUpsert(sourceType, sourceId, dayIndex));
    }
  } catch (error) {
    // The playbook/trip write already committed; losing its enqueue only
    // delays its embedding until the next backfill, it never loses the write.
    console.error("rag: failed to enqueue day chunks for embedding", {
      sourceType,
      sourceId,
      dayCount: indexes.length,
      error,
    });
  }
}

/**
 * The trip write path's enqueue: same rows as `enqueueDayChunksForEmbedding`,
 * but inside the command's transaction.
 *
 * Two properties the trip path needs and the playbook path does not:
 *
 * 1. **No phantom rows.** The queue write commits or rolls back with the
 *    command. A concurrency-conflict rollback must not leave the queue
 *    believing days changed that never did.
 * 2. **Fail-open under a poisoned transaction.** A failed statement aborts
 *    the whole Postgres transaction, so a bare enqueue insert that errored
 *    would take the trip write down with it — the opposite of fail-open.
 *    The savepoint contains the failure: on error the queue write rolls back
 *    to the savepoint, the trip write proceeds, and the missed days wait for
 *    the next backfill.
 *
 * Called from `appendAndProject` (commands.ts), the single funnel every trip
 * write passes through — single commands, batches, creation, undo/redo/
 * revert. `rebuildProjections` needs no hook: a rebuild replays the log into
 * byte-identical content, so there is nothing new to embed; the backfill
 * covers a cold corpus.
 */
export async function enqueueDayChunksInTransaction(
  tx: Queryable,
  sourceType: EmbedSourceType,
  sourceId: string,
  dayIndexes: readonly number[],
): Promise<void> {
  const indexes = [...new Set(dayIndexes)];
  if (indexes.length === 0) return;
  await tx.execute(sql`SAVEPOINT rag_enqueue`);
  try {
    for (const dayIndex of indexes) {
      await tx.execute(queueUpsert(sourceType, sourceId, dayIndex));
    }
    await tx.execute(sql`RELEASE SAVEPOINT rag_enqueue`);
  } catch (error) {
    // Contain it: roll the queue write back to the savepoint so the planning
    // transaction survives. If even the rollback fails the connection is gone
    // and the command fails with it — correctly, since nothing can commit.
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rag_enqueue`).catch(() => {});
    console.error("rag: failed to enqueue day chunks in transaction", {
      sourceType,
      sourceId,
      dayCount: indexes.length,
      error,
    });
  }
}
