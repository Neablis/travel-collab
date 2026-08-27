import { z } from "zod";
import {
  ActivityAddedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
  ActivityUpdatedV1,
  AddActivity,
  MoveActivity,
  RemoveActivity,
  UpdateActivity,
} from "./activity";
import {
  ConflictDismissedV1,
  ConflictUndismissedV1,
  DismissConflict,
  RedoChange,
  RevertToState,
  UndoLastChange,
} from "./history";
import { Money } from "./money";

// Where a trip came from, when it came from somewhere (M11 link 5, ADR-028).
//
// Captured at GENESIS and never mutated: it is a fact about how this stream
// began, so it lives in `TripCreated`'s payload rather than in a CRUD table —
// the foundation design has always listed it as part of a Trip ("lineage
// pointer (`forkedFrom: {tripId, atSeq}`)"), and ADR-001 names fork-with-
// lineage as one of the things that falls out of the event log for free.
//
// `name` is the ancestor's name AT THE MOMENT OF THE FORK, deliberately
// copied into the payload rather than looked up. A projection must be
// rebuildable from the log alone (AGENTS.md invariant 2), and a cross-stream
// read at projection time would break that; it also means the credit survives
// the ancestor being renamed, or deleted, or becoming unreadable to the person
// holding the copy — which is the normal case when the copy came from a share
// link handed to a stranger.
export const TripLineage = z.object({
  tripId: z.string().uuid(),
  // The ancestor's history point this was copied from. 1-based, matching
  // `events.seq`.
  atSeq: z.number().int().min(1),
  name: z.string().min(1).max(200),
});
export type TripLineage = z.infer<typeof TripLineage>;

export const CreateTrip = z.object({
  type: z.literal("CreateTrip"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
  // Only ever set by the server's clone path (`server/cloneTrip.ts`). No
  // client can forge it: `POST /api/trips` accepts a name and nothing else,
  // and `POST /api/trips/:id/commands` refuses `CreateTrip` outright.
  forkedFrom: TripLineage.nullable().default(null),
});
export type CreateTrip = z.infer<typeof CreateTrip>;

export const TripCreatedV1 = z.object({
  type: z.literal("TripCreated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    name: z.string().min(1).max(200),
    createdBy: z.string().min(1),
    // `.default(null)` rather than `.optional()`: every TripCreated row
    // written before M11 link 5 has no such key, and a default makes those
    // rows parse to an explicit `null` instead of `undefined` — so replay,
    // rebuild and the golden test all see one shape, not two. Additive and
    // backwards compatible; no migration, no event version bump.
    forkedFrom: TripLineage.nullable().default(null),
  }),
});
export type TripCreatedV1 = z.infer<typeof TripCreatedV1>;

export const AddDay = z.object({
  type: z.literal("AddDay"),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type AddDay = z.infer<typeof AddDay>;

export const RemoveDay = z.object({
  type: z.literal("RemoveDay"),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type RemoveDay = z.infer<typeof RemoveDay>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Display-only until M3: the domain and conflict engine never read this.
export const SetTripStartDate = z.object({
  type: z.literal("SetTripStartDate"),
  tripId: z.string().uuid(),
  startDate: z.string().regex(ISO_DATE).nullable(), // null clears
});
export type SetTripStartDate = z.infer<typeof SetTripStartDate>;

export const SetTripName = z.object({
  type: z.literal("SetTripName"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type SetTripName = z.infer<typeof SetTripName>;

export const TripNameSetV1 = z.object({
  type: z.literal("TripNameSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), name: z.string().min(1).max(200) }),
});
export type TripNameSetV1 = z.infer<typeof TripNameSetV1>;

// Sets the date range and reconciles day COUNT to match it (decide emits the
// DayAdded/DayRemoved events). `newDayIds` supplies ids for any days the
// reconcile has to append — the domain is pure and cannot mint UUIDs
// (Invariant 4), the same reason AddDay carries its own dayId.
export const SetTripDates = z.object({
  type: z.literal("SetTripDates"),
  tripId: z.string().uuid(),
  startDate: z.string().regex(ISO_DATE).nullable(),
  endDate: z.string().regex(ISO_DATE).nullable(),
  newDayIds: z.array(z.string().uuid()).default([]),
});
export type SetTripDates = z.infer<typeof SetTripDates>;

// Soft delete. The stream survives; `status` gates further commands and the
// summaries read model filters it out. RestoreTrip is the exact inverse.
export const DeleteTrip = z.object({
  type: z.literal("DeleteTrip"),
  tripId: z.string().uuid(),
});
export type DeleteTrip = z.infer<typeof DeleteTrip>;

export const TripDeletedV1 = z.object({
  type: z.literal("TripDeleted"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid() }),
});
export type TripDeletedV1 = z.infer<typeof TripDeletedV1>;

export const RestoreTrip = z.object({
  type: z.literal("RestoreTrip"),
  tripId: z.string().uuid(),
});
export type RestoreTrip = z.infer<typeof RestoreTrip>;

export const TripRestoredV1 = z.object({
  type: z.literal("TripRestored"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid() }),
});
export type TripRestoredV1 = z.infer<typeof TripRestoredV1>;

export const TripStatus = z.enum(["active", "deleted"]);
export type TripStatus = z.infer<typeof TripStatus>;

export const DayAddedV1 = z.object({
  type: z.literal("DayAdded"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), dayId: z.string().uuid() }),
});
export type DayAddedV1 = z.infer<typeof DayAddedV1>;

// Its activities return to the backlog (evolve semantics).
export const DayRemovedV1 = z.object({
  type: z.literal("DayRemoved"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), dayId: z.string().uuid() }),
});
export type DayRemovedV1 = z.infer<typeof DayRemovedV1>;

export const TripStartDateSetV1 = z.object({
  type: z.literal("TripStartDateSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), startDate: z.string().regex(ISO_DATE).nullable() }),
});
export type TripStartDateSetV1 = z.infer<typeof TripStartDateSetV1>;

export const SetTripCurrency = z.object({
  type: z.literal("SetTripCurrency"),
  tripId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type SetTripCurrency = z.infer<typeof SetTripCurrency>;

export const TripCurrencySetV1 = z.object({
  type: z.literal("TripCurrencySet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/) }),
});
export type TripCurrencySetV1 = z.infer<typeof TripCurrencySetV1>;

export const SetTripBudget = z.object({
  type: z.literal("SetTripBudget"),
  tripId: z.string().uuid(),
  budget: Money.nullable(), // null clears
});
export type SetTripBudget = z.infer<typeof SetTripBudget>;

export const TripBudgetSetV1 = z.object({
  type: z.literal("TripBudgetSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), budget: Money.nullable() }),
});
export type TripBudgetSetV1 = z.infer<typeof TripBudgetSetV1>;

export const TripEvent = z.discriminatedUnion("type", [
  TripCreatedV1,
  DayAddedV1,
  DayRemovedV1,
  TripStartDateSetV1,
  TripNameSetV1,
  ActivityAddedV1,
  ActivityUpdatedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
  ConflictDismissedV1,
  ConflictUndismissedV1,
  TripCurrencySetV1,
  TripBudgetSetV1,
  TripDeletedV1,
  TripRestoredV1,
]);
export type TripEvent = z.infer<typeof TripEvent>;

export const TripCommand = z.discriminatedUnion("type", [
  CreateTrip,
  AddDay,
  RemoveDay,
  SetTripStartDate,
  SetTripName,
  SetTripDates,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
  UndoLastChange,
  RedoChange,
  RevertToState,
  DismissConflict,
  DeleteTrip,
  RestoreTrip,
  SetTripCurrency,
  SetTripBudget,
]);
export type TripCommand = z.infer<typeof TripCommand>;

// Commands eligible for atomic batching (M6): every TripCommand except
// CreateTrip (a trip's genesis), the history commands (decided separately),
// and destructive/stream-level operations (DeleteTrip, RestoreTrip).
export const BatchableCommand = z.discriminatedUnion("type", [
  AddDay,
  RemoveDay,
  SetTripStartDate,
  SetTripName,
  SetTripDates,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
  DismissConflict,
  SetTripCurrency,
  SetTripBudget,
]);
export type BatchableCommand = z.infer<typeof BatchableCommand>;

// Ordered least- to most-privileged; `AccessPolicy` (apps/web/src/server) is
// the only thing that interprets the ranking, and the planning domain never
// reads a role at all (AGENTS.md invariant 6c). `owner` is still the only role
// anything MINTS — TripCreated makes its creator the owner and no command adds
// a member — so editor/viewer are unreachable at runtime until invites (M11
// link 3). Widening a literal to an enum that contains it is backwards
// compatible: every `members` row already persisted in `trip_summaries` /
// `trip_details` jsonb still parses.
export const TripRole = z.enum(["viewer", "editor", "owner"]);
export type TripRole = z.infer<typeof TripRole>;

export const TripMember = z.object({
  userId: z.string().min(1),
  role: TripRole,
});
export type TripMember = z.infer<typeof TripMember>;

export const TripSummary = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  status: TripStatus,
  members: z.array(TripMember).min(1),
  createdAt: z.string(), // ISO 8601
});
export type TripSummary = z.infer<typeof TripSummary>;
