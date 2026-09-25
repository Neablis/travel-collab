import { and, asc, eq, gt, max } from "drizzle-orm";
import type { EventEnvelope, Origin } from "@tc/contracts";
import type { Queryable } from "./db/client";
import { events } from "./db/schema";
import { isUuid } from "./ids";

export type DomainEvent = { type: string; version: number; payload: unknown };

export type AppendResult =
  | { ok: true; envelopes: EventEnvelope[] }
  | { ok: false; code: "concurrency-conflict" };

type EventRow = typeof events.$inferSelect;

function toEnvelope(row: EventRow): EventEnvelope {
  return {
    streamId: row.streamId,
    seq: row.seq,
    type: row.type,
    version: row.version,
    payload: row.payload,
    actorId: row.actorId,
    occurredAt: new Date(row.occurredAt).toISOString(),
    batchId: row.batchId,
    origin: row.origin,
  };
}

function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  while (typeof cursor === "object" && cursor !== null) {
    if ((cursor as { code?: string }).code === "23505") return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

export async function appendToStream(
  tx: Queryable,
  args: {
    streamId: string;
    expectedSeq: number;
    events: DomainEvent[];
    actorId: string;
    occurredAt: string;
    batchId: string;
    origin: Origin;
  },
): Promise<AppendResult> {
  try {
    const rows = await tx
      .insert(events)
      .values(
        args.events.map((e, i) => ({
          streamId: args.streamId,
          seq: args.expectedSeq + 1 + i,
          type: e.type,
          version: e.version,
          payload: e.payload,
          actorId: args.actorId,
          occurredAt: args.occurredAt,
          batchId: args.batchId,
          origin: args.origin,
        })),
      )
      .returning();
    return { ok: true, envelopes: rows.map(toEnvelope) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: "concurrency-conflict" };
    throw err;
  }
}

export async function readStream(q: Queryable, streamId: string): Promise<EventEnvelope[]> {
  // `stream_id` is a uuid column (KI-2026-09-05-x). An empty stream is already
  // this function's answer for a trip that has no events, and it is the honest
  // one for an id that could never have been a stream — a `22P02` from the
  // driver is not. Reachable only behind the access seam today, which is why
  // the KI called it the second instance; it is guarded anyway so that the
  // next caller added in front of the seam inherits the right answer.
  if (!isUuid(streamId)) return [];
  const rows = await q
    .select()
    .from(events)
    .where(eq(events.streamId, streamId))
    .orderBy(asc(events.seq));
  return rows.map(toEnvelope);
}

export async function readAll(q: Queryable): Promise<EventEnvelope[]> {
  const rows = await q.select().from(events).orderBy(asc(events.globalSeq));
  return rows.map(toEnvelope);
}

/**
 * The stream's head `seq`, or 0 when it carries nothing.
 *
 * `max(seq)` rather than `readStream(...).length`, which is what `getTripHead`
 * does: this is the steady-state read of the broadcast poll (ADR-049), so it
 * runs once per visible multi-member trip every few seconds and must not read
 * every event of the trip to count them. It is an index-only lookup on
 * `events_stream_seq`.
 *
 * Head and count are the same number here — `appendToStream` writes
 * `expectedSeq + 1 + i` under that unique index, so a stream's seqs are `1..N`
 * contiguous with no gaps. Two readers of the same fact, one cheap.
 */
export async function readStreamHeadSeq(q: Queryable, streamId: string): Promise<number> {
  // Same guard and same reason as `readStream`: an id that could never have
  // been a stream has an honest answer, and it is not a `22P02` from the driver.
  if (!isUuid(streamId)) return 0;
  const rows = await q
    .select({ headSeq: max(events.seq) })
    .from(events)
    .where(eq(events.streamId, streamId));
  return rows[0]?.headSeq ?? 0;
}

/**
 * Envelopes on this stream after `afterSeq`, in `seq` order, at most `limit`.
 *
 * The range scan the broadcast poll is built on (ADR-049 Decision 1). It uses
 * `events_stream_seq` as it stands and needs no new index.
 */
export async function readStreamAfter(
  q: Queryable,
  streamId: string,
  afterSeq: number,
  limit: number,
): Promise<EventEnvelope[]> {
  if (!isUuid(streamId)) return [];
  const rows = await q
    .select()
    .from(events)
    .where(and(eq(events.streamId, streamId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
    .limit(limit);
  return rows.map(toEnvelope);
}
