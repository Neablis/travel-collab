// Server-only: never import from UI code. The Vercel Cron sweep that drains
// `pending_embeddings` into `day_embeddings` (Part 2 of 5). The route at
// `app/api/cron/embed-days` is its only caller in production; the backfill
// script feeds the queue it drains.
//
// The sweep is TOTAL: one bad row — an unreadable playbook, a deleted trip,
// a provider failure, a poison row — is contained to that row (retried, then
// dead-lettered, or tombstoned) and never kills the batch. A crashed run
// leaves rows at `processing`; the next run recovers them before claiming.
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { dayEmbeddings, savedDays } from "@/server/db/schema";
import { parseSavedDayColumns } from "@/server/savedDayRow";
import { getTripDetail } from "@/server/projections";
import { buildPlaybookDayChunks, buildTripDayChunks, type BuiltDayChunk } from "./chunks";
import { embedText } from "./embeddings";

/** Rows claimed per sweep run: 50 embeddings at ~1-2s each fits a cron invocation with room. */
export const SWEEP_BATCH_SIZE = 50;

/**
 * How long a run may spend before it hands the rest of its claim back: the
 * cron route's `maxDuration` is 300 s, and 50 rows at a 30 s provider timeout
 * each would run far past it, leaving the unvisited rows at `processing`
 * until tomorrow's recovery. 240 s leaves room for one more slow call.
 */
export const SWEEP_BUDGET_MS = 240_000;

/** Failures before a row is dead-lettered instead of retried. */
export const SWEEP_MAX_ATTEMPTS = 5;

/** What one sweep run did — the cron route returns this, and the logs carry it. */
export interface SweepSummary {
  /** Rows claimed from `pending` this run. */
  claimed: number;
  /** Orphaned `processing` rows from a crashed run, reset to `pending`. */
  recovered: number;
  /** Rows embedded and marked `done`. */
  embedded: number;
  /** Rows whose chunk text matched the stored one: metadata refreshed, no provider call. */
  unchanged: number;
  /** Rows whose attempt failed and went back to `pending`. */
  retried: number;
  /** Rows that exhausted their attempts and were marked `dead`. */
  dead: number;
  /** Rows whose source is gone, deleted or unreadable: embeddings removed, marked `done`. */
  tombstoned: number;
  /** Claimed rows the run had no time left for: back to `pending`, attempt unspent. */
  deferred: number;
  /**
   * Rows still `pending` after this run: the backlog the next run starts
   * with. A number that grows run over run means the daily sweep is not
   * keeping up. -1 when the count itself failed.
   */
  pending: number;
}

/** A resolved chunk, or the news that its source should not be embedded. */
type ResolvedChunk =
  | { kind: "ready"; chunk: BuiltDayChunk; visibility: string; ownerId: string | null }
  // `scope: "source"` — the whole source is gone (deleted playbook/trip):
  // remove every embedding it left. `scope: "day"` — only this day index is
  // stale (the trip shrank since the row was queued): remove just it.
  | { kind: "tombstone"; reason: string; scope: "source" | "day" };

/**
 * Drain the embed queue: claim pending rows, embed each day's chunk text,
 * and upsert the result into `day_embeddings`.
 *
 * `embed` defaults to the production `embedText` (fail-open: null on provider
 * failure); tests inject a fake, because the integration lane forbids third-
 * party calls and the provider is not what this sweep is proving. The
 * database behaviour — the claim lock, the `english` FTS dictionary, the
 * upsert — stays real either way.
 *
 * Metadata (`visibility`, `owner_id`, city, tags) is read FRESH from the
 * source on every embed, not carried on the queue row: a visibility flip
 * re-enqueues the days (see `updatePlaybookContent`'s hook), and the sweep
 * then stores the flip rather than the stale value the queue was written
 * with.
 */
export async function runEmbedSweep(
  options: {
    embed?: (text: string) => Promise<number[] | null>;
    batchSize?: number;
    maxAttempts?: number;
    budgetMs?: number;
  } = {},
): Promise<SweepSummary> {
  const embed = options.embed ?? embedText;
  const batchSize = options.batchSize ?? SWEEP_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? SWEEP_MAX_ATTEMPTS;
  const deadline = Date.now() + (options.budgetMs ?? SWEEP_BUDGET_MS);
  const summary: SweepSummary = {
    claimed: 0,
    recovered: 0,
    embedded: 0,
    unchanged: 0,
    retried: 0,
    dead: 0,
    tombstoned: 0,
    deferred: 0,
    pending: 0,
  };

  summary.recovered = await recoverOrphanedRows();
  const claimed = await claimPendingRows(batchSize);
  summary.claimed = claimed.length;

  for (const row of claimed) {
    if (Date.now() >= deadline) {
      await setRowStatus(row, "pending", row.attempts);
      summary.deferred++;
      continue;
    }
    const logContext = { sourceType: row.source_type, sourceId: row.source_id, dayIndex: row.day_index };
    try {
      const resolved = await resolveChunk(row.source_type, row.source_id, row.day_index);
      if (resolved.kind === "tombstone") {
        if (resolved.scope === "source") {
          await tombstoneSource(row.source_type, row.source_id);
        } else {
          await tombstoneDay(row.source_type, row.source_id, row.day_index);
        }
        await setRowStatus(row, "done", row.attempts);
        console.error("rag: embed sweep tombstoned a row", { ...logContext, reason: resolved.reason });
        summary.tombstoned++;
        continue;
      }
      // Most re-queues carry the same text: every trip command re-queues every
      // day, and a visibility flip changes no words. The stored vector is
      // still right for those, so only the metadata is written.
      if (await refreshIfUnchanged(row, resolved)) {
        await setRowStatus(row, "done", row.attempts);
        summary.unchanged++;
        continue;
      }
      const vector = await embed(resolved.chunk.text);
      if (vector === null) {
        await failRow(row, maxAttempts, "embedding provider returned null");
        summary[row.attempts + 1 >= maxAttempts ? "dead" : "retried"]++;
        continue;
      }
      await upsertDayEmbedding({
        sourceType: row.source_type,
        sourceId: row.source_id,
        dayIndex: row.day_index,
        chunk: resolved.chunk,
        embedding: vector,
        visibility: resolved.visibility,
        ownerId: resolved.ownerId,
      });
      await setRowStatus(row, "done", row.attempts);
      summary.embedded++;
    } catch (error) {
      // Total per row: a poison row, a dead source read, a failed upsert —
      // each is retried, then dead-lettered, and the batch walks on.
      console.error("rag: embed sweep row failed", { ...logContext, error });
      await failRow(row, maxAttempts, "row threw");
      summary[row.attempts + 1 >= maxAttempts ? "dead" : "retried"]++;
    }
  }
  summary.pending = await countPendingRows();
  return summary;
}

/** The queue's backlog. Total: a failed count reads -1 rather than failing the run. */
async function countPendingRows(): Promise<number> {
  try {
    const result = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM pending_embeddings WHERE status = 'pending'
    `);
    return Number(result.rows[0]?.count ?? 0);
  } catch (error) {
    console.error("rag: embed sweep failed to count pending rows", { error });
    return -1;
  }
}

/**
 * When the stored chunk for this day already has this exact text and a
 * vector, write the fresh metadata (visibility, owner, city, tags) and report
 * true — no provider call. False means the day needs embedding.
 *
 * Rows do not record which model made their vector, so after changing the
 * embedding model, null `day_embeddings.embedding` before the backfill or
 * every row takes this path and keeps the old model's vectors (ADR-075).
 */
async function refreshIfUnchanged(
  row: ClaimedRow,
  resolved: Extract<ResolvedChunk, { kind: "ready" }>,
): Promise<boolean> {
  const refreshed = await db
    .update(dayEmbeddings)
    .set({
      city: resolved.chunk.city,
      countryCode: resolved.chunk.countryCode,
      tags: resolved.chunk.tags,
      visibility: resolved.visibility,
      ownerId: resolved.ownerId,
    })
    .where(
      and(
        eq(dayEmbeddings.sourceType, row.source_type),
        eq(dayEmbeddings.sourceId, row.source_id),
        eq(dayEmbeddings.dayIndex, row.day_index),
        eq(dayEmbeddings.chunkText, resolved.chunk.text),
        isNotNull(dayEmbeddings.embedding),
      ),
    )
    .returning({ id: dayEmbeddings.id });
  return refreshed.length > 0;
}

/** Rows stuck at `processing` are a crashed run's, not a live one's: reset them. */
async function recoverOrphanedRows(): Promise<number> {
  try {
    const result = await db.execute<{ count: string }>(sql`
      WITH recovered AS (
        UPDATE pending_embeddings SET status = 'pending'
        WHERE status = 'processing'
        RETURNING id
      )
      SELECT count(*)::text AS count FROM recovered
    `);
    return Number(result.rows[0]?.count ?? 0);
  } catch (error) {
    // Fail-open at the sweep level too: a recovery failure must not cancel
    // the claims below it. The orphans wait for the next run.
    console.error("rag: embed sweep failed to recover orphaned rows", { error });
    return 0;
  }
}

/** Atomically move up to `batchSize` pending rows to `processing` and return them. */
async function claimPendingRows(batchSize: number): Promise<
  { source_type: string; source_id: string; day_index: number; attempts: number }[]
> {
  const result = await db.execute<{
    source_type: string;
    source_id: string;
    day_index: number;
    attempts: number;
  }>(sql`
    WITH candidates AS (
      SELECT id FROM pending_embeddings
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE pending_embeddings AS p SET status = 'processing'
    FROM candidates WHERE p.id = candidates.id
    RETURNING p.source_type, p.source_id, p.day_index, p.attempts
  `);
  return result.rows;
}

type ClaimedRow = { source_type: string; source_id: string; day_index: number; attempts: number };

/**
 * Build the one chunk a claimed row names, with the metadata its
 * `day_embeddings` row carries. Returns a tombstone when the source is gone,
 * deleted, or unreadable — embedding it would only preserve what the user
 * removed.
 */
async function resolveChunk(
  sourceType: string,
  sourceId: string,
  dayIndex: number,
): Promise<ResolvedChunk> {
  if (sourceType === "playbook") {
    const rows = await db.select().from(savedDays).where(eq(savedDays.id, sourceId));
    const row = rows[0];
    if (row === undefined) return { kind: "tombstone", reason: "playbook row missing", scope: "source" };
    if (row.deletedAt !== null) return { kind: "tombstone", reason: "playbook soft-deleted", scope: "source" };
    // The read boundary's rule, not an ad-hoc parse: `parseSavedDayColumns`
    // is what `fromRow` uses, so the sweep parses the stops, validates the
    // visibility, and repairs `dayCount` upward to the stops' floor exactly
    // as every other reader does. An unreadable row is dropped, not guessed
    // at (KI-71).
    const parsed = parseSavedDayColumns({
      savedDayId: sourceId,
      stops: row.stops,
      visibility: row.visibility,
      authorKind: row.authorKind,
      dayCount: row.dayCount,
    });
    if (parsed === null) return { kind: "tombstone", reason: "playbook columns unreadable", scope: "source" };
    const chunk = buildPlaybookDayChunks({
      name: row.name,
      summary: row.summary,
      stops: parsed.stops,
      dayCount: parsed.dayCount,
    })[dayIndex];
    if (chunk === undefined) return { kind: "tombstone", reason: "day index beyond the playbook's day count", scope: "day" };
    return { kind: "ready", chunk, visibility: parsed.visibility, ownerId: row.ownerId };
  }
  if (sourceType === "trip") {
    // `getTripDetail` is the one place the document leaves the database
    // parsed (KI-2026-09-05-r): null is "no such trip", and a malformed doc
    // THROWS — the per-row catch above turns that into retry-then-dead.
    const detail = await getTripDetail(sourceId);
    if (detail === null) return { kind: "tombstone", reason: "trip detail missing", scope: "source" };
    if (detail.status === "deleted") return { kind: "tombstone", reason: "trip deleted", scope: "source" };
    // The owner has no `trip_memberships` row, so membership alone would hide
    // their own trip from them at retrieval (spec, vendor decision): the
    // owner's id is recorded here, at write time, for every trip day.
    const ownerId = detail.members.find((member) => member.role === "owner")?.userId ?? null;
    if (ownerId === null) {
      console.error("rag: trip detail has no owner member", { tripId: sourceId });
    }
    const chunk = buildTripDayChunks(detail)[dayIndex];
    if (chunk === undefined) return { kind: "tombstone", reason: "day index beyond the trip's day count", scope: "day" };
    return { kind: "ready", chunk, visibility: "private", ownerId };
  }
  return { kind: "tombstone", reason: `unknown source type ${sourceType}`, scope: "source" };
}

/**
 * Write one embedded day. The `fts` dictionary is `english` here AND in the
 * retrieval query (`plainto_tsquery('english', …)`): same dictionary on write
 * and read, by construction — a chunk indexed under another dictionary would
 * silently never match.
 *
 * Built with the query builder rather than raw SQL: the `tags` column is
 * `text[]`, and a JS array interpolated into a `sql` template becomes an
 * `IN`-style list, not a Postgres array — the builder is what knows the
 * column types.
 */
async function upsertDayEmbedding({
  sourceType,
  sourceId,
  dayIndex,
  chunk,
  embedding,
  visibility,
  ownerId,
}: {
  sourceType: string;
  sourceId: string;
  dayIndex: number;
  chunk: BuiltDayChunk;
  embedding: number[];
  visibility: string;
  ownerId: string | null;
}): Promise<void> {
  const fts = sql`to_tsvector('english', ${chunk.text})`;
  await db
    .insert(dayEmbeddings)
    .values({
      id: randomUUID(),
      sourceType,
      sourceId,
      dayIndex,
      chunkText: chunk.text,
      embedding,
      fts,
      city: chunk.city,
      countryCode: chunk.countryCode,
      tags: chunk.tags,
      visibility,
      ownerId,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dayEmbeddings.sourceType, dayEmbeddings.sourceId, dayEmbeddings.dayIndex],
      set: {
        chunkText: chunk.text,
        embedding,
        fts,
        city: chunk.city,
        countryCode: chunk.countryCode,
        tags: chunk.tags,
        visibility,
        ownerId,
      },
    });
}

/** Remove a source's embeddings: the content is gone, so is its vector. */
async function tombstoneSource(sourceType: string, sourceId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM day_embeddings WHERE source_type = ${sourceType} AND source_id = ${sourceId}
  `);
}

/** Remove one stale day embedding: the day no longer exists on its source. */
async function tombstoneDay(sourceType: string, sourceId: string, dayIndex: number): Promise<void> {
  await db.execute(sql`
    DELETE FROM day_embeddings
    WHERE source_type = ${sourceType} AND source_id = ${sourceId} AND day_index = ${dayIndex}
  `);
}

/** Mark a claimed row; total, so a bookkeeping failure never breaks the batch either. */
async function setRowStatus(row: ClaimedRow, status: "done" | "pending" | "dead", attempts: number): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE pending_embeddings
      SET status = ${status}, attempts = ${attempts}
      WHERE source_type = ${row.source_type} AND source_id = ${row.source_id} AND day_index = ${row.day_index}
    `);
  } catch (error) {
    console.error("rag: embed sweep failed to mark a row", {
      sourceType: row.source_type,
      sourceId: row.source_id,
      dayIndex: row.day_index,
      status,
      error,
    });
  }
}

/** One failed attempt: back to `pending` with attempts+1, or `dead` when the budget is spent. */
async function failRow(row: ClaimedRow, maxAttempts: number, reason: string): Promise<void> {
  const attempts = row.attempts + 1;
  const status = attempts >= maxAttempts ? "dead" : "pending";
  console.error(`rag: embed sweep row failed (${reason})`, {
    sourceType: row.source_type,
    sourceId: row.source_id,
    dayIndex: row.day_index,
    attempts,
    status,
  });
  await setRowStatus(row, status, attempts);
}
