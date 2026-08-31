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

/**
 * Who can see a saved day. **Private is the default** (M11b link 3): a day
 * becomes findable only when its author publishes it, and unpublishing puts it
 * straight back.
 *
 * A named enum rather than an `isPublic` boolean, which is the obvious
 * alternative for two states. Three reasons, heaviest first:
 *
 *   1. **A third state is already on the roadmap.** M12 quarantines reporting
 *      and moderation, and a day withdrawn by a moderator is neither the
 *      author's `private` (they did not choose it, and their own unpublish/
 *      publish must not silently undo it) nor `public`. Adding a member here
 *      is a contract change with an exhaustiveness typecheck behind it — the
 *      property `AdmissionRefusal` was chosen for; widening a boolean is a
 *      column rewrite plus a re-reading of every site that said `!isPublic`.
 *   2. **The stored and wire values say what they mean.** `visibility:
 *      "public"` reads the same in a row, a JSON body and a log line;
 *      `is_public: false` has to be decoded against a field name.
 *   3. It is what this repo already does for a small closed state set —
 *      `trip_invites.status`, `TripStatus`.
 *
 * ADR-029 decision 3 deleted the shell's three-option select ("Only me / Trip
 * collaborators / Anyone with the link") and is explicit that "anyone with the
 * link" returns as a bearer token on its own table (ADR-027's shape), NOT as a
 * member here. This enum is about discoverability in the public library and
 * nothing else.
 */
export const SavedDayVisibility = z.enum(["private", "public"]);
export type SavedDayVisibility = z.infer<typeof SavedDayVisibility>;

export const SavedDay = z.object({
  savedDayId: z.string().uuid(),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(200),
  stops: z.array(SavedStop),
  /**
   * The cities this day touches, derived from `stops[].location.city` at SAVE
   * time and stored — a snapshot, on the same terms as `sourceTripName` below
   * (M11b link 1).
   *
   * Stored rather than derived per read because `stops` is jsonb precisely so
   * it is never queried into (ADR-029); deriving this per Discover query would
   * be querying into the value that ADR says is a value. `[]`, never null,
   * when no stop carries a city — so "how many cities does this day touch" is
   * always a length.
   *
   * The derivation is `citiesOfStops` in `@tc/domain`, and only that: time
   * order, `location.city` with no name/area fallback, duplicates collapsed to
   * the first occurrence. It is the same function `citiesOfDay` folds, so a
   * profile's cities cannot disagree with Discover's.
   */
  cities: z.array(z.string().min(1)),
  visibility: SavedDayVisibility,
  /**
   * How many times this day has been added to a trip — the denormalised
   * counter over the adds ledger (M11b link 4), and what the leaderboard
   * ranks on.
   *
   * A count rather than a list because every surface that shows it shows a
   * number. The ledger is the authority: an add counts once per trip, only
   * after the trip has dates, and never when the author copies their own day
   * into their own trip. **A build that counts raw inserts produces a
   * different and gameable order** — which is the whole reason the ledger
   * exists rather than an `adds++`.
   */
  adds: z.number().int().nonnegative(),
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
