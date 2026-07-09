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

export const CreateTrip = z.object({
  type: z.literal("CreateTrip"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type CreateTrip = z.infer<typeof CreateTrip>;

export const TripCreatedV1 = z.object({
  type: z.literal("TripCreated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    name: z.string().min(1).max(200),
    createdBy: z.string().min(1),
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

export const TripEvent = z.discriminatedUnion("type", [
  TripCreatedV1,
  DayAddedV1,
  DayRemovedV1,
  TripStartDateSetV1,
  ActivityAddedV1,
  ActivityUpdatedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
  ConflictDismissedV1,
  ConflictUndismissedV1,
]);
export type TripEvent = z.infer<typeof TripEvent>;

export const TripCommand = z.discriminatedUnion("type", [
  CreateTrip,
  AddDay,
  RemoveDay,
  SetTripStartDate,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
  UndoLastChange,
  RedoChange,
  RevertToState,
  DismissConflict,
]);
export type TripCommand = z.infer<typeof TripCommand>;

export const TripMember = z.object({
  userId: z.string().min(1),
  role: z.literal("owner"),
});
export type TripMember = z.infer<typeof TripMember>;

export const TripSummary = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  members: z.array(TripMember).min(1),
  createdAt: z.string(), // ISO 8601
});
export type TripSummary = z.infer<typeof TripSummary>;
