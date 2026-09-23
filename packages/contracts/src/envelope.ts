import { z } from "zod";
import { Origin } from "./history.ts";

export const EventEnvelope = z.object({
  streamId: z.string().uuid(),
  seq: z.number().int().positive(),
  type: z.string().min(1),
  version: z.number().int().positive(),
  payload: z.unknown(),
  actorId: z.string().min(1),
  occurredAt: z.string(), // ISO 8601
  batchId: z.string().uuid(), // one per command execution (M2)
  origin: Origin, // provenance: user | undo | redo | revert (M2, ADR-005)
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/**
 * One poll of a trip's log: what happened after the cursor the caller held,
 * and where the head is now (ADR-049, M13 link 2).
 *
 * `headSeq` is the stream's head — 0 for a trip whose stream carries nothing —
 * and it is the cursor the caller sends back next time. It is per-stream `seq`,
 * NOT `events.global_seq`: a `bigserial` takes its value at `INSERT` and
 * becomes visible at `COMMIT`, so a reader polling `global_seq > cursor` can
 * advance past an event that commits late and never be served it again.
 * Per-stream `seq` cannot do that, because writing `seq` N+1 requires having
 * read N committed rows in that stream. ADR-049 Decision 1 has the argument.
 *
 * `resync: true` means the caller is further behind than one poll will carry
 * and should refetch the trip instead of collecting the gap event by event.
 * `events` is empty when it is set — the two are alternatives, not a partial
 * answer plus a warning.
 */
export const TripEventsPage = z.object({
  headSeq: z.number().int().nonnegative(),
  events: z.array(EventEnvelope),
  resync: z.boolean(),
});
export type TripEventsPage = z.infer<typeof TripEventsPage>;
