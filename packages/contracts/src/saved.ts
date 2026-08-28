import { z } from "zod";
import { ActivityKind, ActivityTag, Anchor, Location, TimeWindow } from "./activity";
import { Money } from "./money";

// Saved parts (M11 link 6, ADR-029) — "select parts of my trip and save them
// for reuse".
//
// A saved day is a personal, reusable FRAGMENT: an ordered list of stops with
// their times, places, costs and notes, and deliberately no dates. It is not
// planning state — it belongs to a person, not to a trip — so it is ordinary
// CRUD in its own module, the same shape the module map gives Identity and
// Access. Nothing here is event-sourced (ADR-003).

/**
 * One stop inside a saved day.
 *
 * `ActivityView` minus `activityId`: an id would tie the fragment to the
 * activity it was copied from, and inserting the same saved day into two
 * trips would then put the same id in two streams — the KI-1 hazard, and the
 * same reason `cloneTrip` remaps ids (ADR-028). Ids are minted fresh at insert
 * time instead.
 */
export const SavedStop = z.object({
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
  anchors: z.array(Anchor),
  kind: ActivityKind,
  tags: z.array(ActivityTag),
  cost: Money.nullable(),
});
export type SavedStop = z.infer<typeof SavedStop>;

export const SavedDay = z.object({
  savedDayId: z.string().uuid(),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(200),
  stops: z.array(SavedStop),
  // Where it came from, on the same terms as a trip's lineage (ADR-028): the
  // trip's name is a SNAPSHOT taken at save time, so the credit survives the
  // source being renamed, deleted, or becoming unreadable.
  sourceTripId: z.string().uuid(),
  sourceTripName: z.string().min(1).max(200),
  createdAt: z.string(),
});
export type SavedDay = z.infer<typeof SavedDay>;

/**
 * The client names a day and points at it; the SERVER reads the stops.
 *
 * Deliberately not `{ name, stops }`: letting a client post the plan content
 * would make this an unvalidated write path into a person's library, and the
 * server has to read the trip to authorize the save anyway.
 */
export const CreateSavedDayInput = z.object({
  name: z.string().min(1).max(200),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type CreateSavedDayInput = z.infer<typeof CreateSavedDayInput>;
