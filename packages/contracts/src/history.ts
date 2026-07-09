import { z } from "zod";

// Provenance of a batch of events: how the change came to be. Lives on the
// EVENT ENVELOPE, beside actor_id/occurred_at — never in the domain event
// vocabulary (ADR-005).
export const Origin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("undo"), undoesBatchId: z.string().uuid() }),
  z.object({ kind: z.literal("redo"), redoesBatchId: z.string().uuid() }),
  z.object({ kind: z.literal("revert"), toSeq: z.number().int().positive() }),
]);
export type Origin = z.infer<typeof Origin>;

// ---- History commands (ADR-005: they emit ORDINARY domain events) ----

export const UndoLastChange = z.object({
  type: z.literal("UndoLastChange"),
  tripId: z.string().uuid(),
});
export type UndoLastChange = z.infer<typeof UndoLastChange>;

export const RedoChange = z.object({
  type: z.literal("RedoChange"),
  tripId: z.string().uuid(),
});
export type RedoChange = z.infer<typeof RedoChange>;

export const RevertToState = z.object({
  type: z.literal("RevertToState"),
  tripId: z.string().uuid(),
  toSeq: z.number().int().positive(),
});
export type RevertToState = z.infer<typeof RevertToState>;

// ---- Conflict dismissal (persistent — retires M1's client-local stopgap) ----

export const DismissConflict = z.object({
  type: z.literal("DismissConflict"),
  tripId: z.string().uuid(),
  conflictId: z.string().min(1),
});
export type DismissConflict = z.infer<typeof DismissConflict>;

export const ConflictDismissedV1 = z.object({
  type: z.literal("ConflictDismissed"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), conflictId: z.string().min(1) }),
});
export type ConflictDismissedV1 = z.infer<typeof ConflictDismissedV1>;

// No user-facing "undismiss" command exists; this event exists so dismissals
// are expressible in a state diff — i.e. undoable/revertible (ADR-005).
export const ConflictUndismissedV1 = z.object({
  type: z.literal("ConflictUndismissed"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), conflictId: z.string().min(1) }),
});
export type ConflictUndismissedV1 = z.infer<typeof ConflictUndismissedV1>;

// ---- History read DTOs ----

export const HistoryEntry = z.object({
  batchId: z.string().uuid(),
  fromSeq: z.number().int().positive(),
  toSeq: z.number().int().positive(),
  actorId: z.string().min(1),
  occurredAt: z.string(), // ISO 8601
  origin: Origin,
  description: z.string(),
  undone: z.boolean(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const TripHistory = z.object({
  tripId: z.string().uuid(),
  entries: z.array(HistoryEntry), // newest first as served by the API
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});
export type TripHistory = z.infer<typeof TripHistory>;
