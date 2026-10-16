// One-shot backfill for the plan-retrieval RAG stack (Part 2 of 5): queue
// every playbook day and every trip day for embedding.
//
// Usage:
//   pnpm --filter web db:backfill-embeddings
//
// Run once per environment, after migration 0054 is applied and the
// `CRON_SECRET` cron is running. Safe to run again — the queue upsert is
// idempotent, so a re-run after a partial failure only queues what is not
// already queued, finished, or dead-lettered.
//
// What it queues:
// - every non-deleted `saved_days` row, days 0..day_count-1 (empty days
//   included — a gap in `dayIndex` is a rest day, ADR-048 decision 2, and its
//   chunk says so);
// - every `trip_details` row whose doc status is `active`, days
//   0..jsonb_array_length(doc->'days')-1.
//
// Conflict semantics (deliberately different from the write hooks'): a row
// already `pending`, `processing` or `done` is left alone — re-running the
// backfill must not re-embed the corpus. A row at `dead` IS reset to
// `pending`: a dead letter is a known failure, and running the backfill is
// the operator saying "try those again". (The write hooks in
// `server/ai/queue.ts` reset `done` too, because there the content changed.)
//
// Forcing a FULL re-embed (e.g. the embedding model changed) is a separate,
// deliberate act: `TRUNCATE day_embeddings, pending_embeddings;` then re-run
// this. The model id and the column width are paired in
// `server/config.ts` — changing one without the other corrupts the corpus,
// so the truncate is the honest version of that decision.
//
// --- Why the SQL is inline ---
// Like its sibling `backfill-saved-day-cities.mjs`, this script runs under
// plain Node, which resolves neither the `@/` alias nor `@tc/contracts`
// (measured on PR #100). The queue upsert is three lines of SQL; importing
// `server/ai/queue.ts` by path would drag `@/server/db/client` in behind it
// and fail. The statement is duplicated here on purpose, and this comment is
// the pointer keeping the two copies honest.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pathToFileURL } from "node:url";

/**
 * Queue every playbook day and every active trip day for embedding.
 *
 * @param {ReturnType<typeof drizzle>} db
 * @returns {Promise<{ playbooks: number; trips: number; queued: number; deadReset: number }>}
 */
export async function backfillDayEmbeddings(db) {
  let playbooks = 0;
  let trips = 0;
  let queued = 0;
  let deadReset = 0;

  // Non-deleted playbooks. `day_count` is the sequence's span (ADR-048
  // decision 2); the sweep builds one chunk per index in 0..day_count-1.
  const playbookRows = await db.execute(
    sql`SELECT id, day_count FROM saved_days WHERE deleted_at IS NULL`,
  );
  for (const row of playbookRows.rows) {
    playbooks++;
    for (let dayIndex = 0; dayIndex < Number(row.day_count); dayIndex++) {
      deadReset += await queueDay(db, "playbook", row.id, dayIndex);
      queued++;
    }
  }

  // Active trips only: a deleted trip's days tombstone on sight in the sweep,
  // so queueing them here would only create work that deletes itself.
  const tripRows = await db.execute(
    sql`SELECT trip_id, jsonb_array_length(doc->'days') AS day_count
        FROM trip_details WHERE doc->>'status' = 'active'`,
  );
  for (const row of tripRows.rows) {
    trips++;
    for (let dayIndex = 0; dayIndex < Number(row.day_count); dayIndex++) {
      deadReset += await queueDay(db, "trip", row.trip_id, dayIndex);
      queued++;
    }
  }

  return { playbooks, trips, queued, deadReset };
}

/**
 * One idempotent queue upsert. Returns 1 when it resurrected a dead row.
 *
 * @param {ReturnType<typeof drizzle>} db
 */
async function queueDay(db, sourceType, sourceId, dayIndex) {
  const result = await db.execute(sql`
    INSERT INTO pending_embeddings (id, source_type, source_id, day_index, status, attempts, created_at)
    VALUES (gen_random_uuid(), ${sourceType}, ${sourceId}, ${dayIndex}, 'pending', 0, now())
    ON CONFLICT (source_type, source_id, day_index)
    DO UPDATE SET status = 'pending', attempts = 0
    WHERE pending_embeddings.status = 'dead'
    RETURNING (xmax = 0) AS inserted
  `);
  // `xmax = 0` distinguishes a fresh insert from an update of an existing
  // row; only a resurrected dead row counts.
  const resurrected = result.rows.filter((r) => r.inserted === false);
  return resurrected.length > 0 ? 1 : 0;
}

// Only when run as a script. The export above is what the integration suite
// drives, so the backfill is covered by a test rather than by having been run
// once on one laptop.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (local: apps/web/.env.local).");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  const result = await backfillDayEmbeddings(drizzle(pool));
  await pool.end();
  console.log(
    `day embeddings backfill: ${result.playbooks} playbooks, ${result.trips} trips, ` +
      `${result.queued} day rows queued, ${result.deadReset} dead rows reset to pending`,
  );
}
