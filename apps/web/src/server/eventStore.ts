import { asc, eq } from "drizzle-orm";
import type { EventEnvelope, Origin } from "@tc/contracts";
import type { Db } from "./db/client";
import { events } from "./db/schema";
import { isUuid } from "./ids";

export type DomainEvent = { type: string; version: number; payload: unknown };

export type AppendResult =
  | { ok: true; envelopes: EventEnvelope[] }
  | { ok: false; code: "concurrency-conflict" };

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

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
