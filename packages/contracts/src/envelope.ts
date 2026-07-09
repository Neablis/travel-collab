import { z } from "zod";
import { Origin } from "./history";

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
