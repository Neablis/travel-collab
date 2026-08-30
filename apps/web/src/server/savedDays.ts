import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  SavedDayVisibility,
  SavedStop,
  type BatchableCommand,
  type SavedDay,
  type TripDetail,
} from "@tc/contracts";
import { citiesOfStops } from "@tc/domain";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { executeTripCommandBatch, type CommandResult } from "./commands";
import type { AccessError, AccessResult } from "./access/invites";
// Shared with the UI (the Keep-this-day dialog describes what it is about to
// save). Lives in src/lib because the lint wall forbids UI importing
// @/server/*, and two copies of "what's included" would be two chances to
// disagree in the one place a user is asked to trust a summary.
import { stopsForDay } from "@/lib/savedStops";

// The Library: a person's saved day fragments (M11 link 6, ADR-029). CRUD,
// owned by a person rather than by a trip, and not event-sourced — the same
// boundary ADR-003 draws for Identity and Access.
//
// Authorization is NOT decided here. Saving reads a trip (the caller checks
// `viewer`), inserting writes one (the caller checks `editor`); this module
// only ever owns the library rows themselves.

type SavedDayRow = typeof savedDays.$inferSelect;

/**
 * The one place a stored instant becomes a `SavedDay`'s string. The column is
 * `mode: "date"` precisely so this conversion cannot be skipped on the write
 * path: a row built in memory carries a `Date` exactly like a row read back
 * does, so both paths render the same ISO-8601 string (KI-53).
 *
 * `stops` is passed in rather than read off the row, so that every path into a
 * `SavedDay` has had to produce a PARSED array first — see `fromRow` (KI-71).
 */
function toDto(row: SavedDayRow, stops: SavedStop[]): SavedDay {
  return {
    savedDayId: row.id,
    ownerId: row.ownerId,
    name: row.name,
    stops,
    cities: row.cities,
    visibility: row.visibility,
    adds: row.adds,
    sourceTripId: row.sourceTripId,
    sourceTripName: row.sourceTripName,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The read boundary: a stored row becomes a `SavedDay`, or it becomes nothing.
 *
 * KI-71. The column is `jsonb("stops").$type<SavedStop[]>()`, and `$type` is a
 * **compile-time cast on Drizzle's side, not a runtime check** — it describes
 * what the write path intends, never what the bytes are. Passing `row.stops`
 * straight through therefore trusted every row ever written against today's
 * contract: the day `SavedStop` gains a required field, rows written before it
 * existed become an opaque 400 at the response boundary, at read time, on data
 * the user already saved, with nothing naming the row or the field. This is the
 * same species as the unparsed `trip_details.doc` (KI-74, and the "500 loading
 * any trip" before it); the fix is the one `requireTripAccess` took — parse
 * where the row is read, so the type is true once for every caller.
 *
 * DROPPING the row, not rejecting the read, and not throwing: a library is a
 * list, and one unreadable fragment must not be able to take the other
 * twenty-nine with it. `getSavedDay` returning null puts an unreadable row in
 * the same place a deleted one is already in, which every caller of it already
 * handles (404 / "does not exist"). What the user is not owed is silence, so
 * the failure is LOGGED with the row id and the parse issues — the missing
 * half of the entry's complaint, and the reason this returns null rather than
 * quietly substituting an empty stop list, which would look like a saved day
 * that legitimately holds nothing.
 */
function fromRow(row: SavedDayRow): SavedDay | null {
  const stops = SavedStop.array().safeParse(row.stops);
  if (!stops.success) {
    console.error("saved_days.stops failed SavedStop[] parse", {
      savedDayId: row.id,
      issues: stops.error.issues,
    });
    return null;
  }
  // `visibility` gets the same treatment as `stops`, and for the same reason.
  // The column is `text` with a `$type<SavedDayVisibility>()` cast, which is
  // compile-time only — nothing stops a row holding any other string, and
  // without this parse `toDto` would hand that string out as a typed contract
  // value. Once M11b link 3 makes visibility decide who can READ a day, a row
  // that is neither "private" nor "public" is a value no caller has a branch
  // for; dropping it is the same fail-closed choice `stops` already makes.
  //
  // Raised independently by PR1's implementer and by review on pull request 100 — two
  // readers finding the same hole is not a coincidence to leave open.
  const visibility = SavedDayVisibility.safeParse(row.visibility);
  if (!visibility.success) {
    console.error("saved_days.visibility is not a SavedDayVisibility", {
      savedDayId: row.id,
      value: row.visibility,
    });
    return null;
  }
  return toDto(row, stops.data);
}

export async function saveDay(
  input: { name: string; dayId: string },
  detail: TripDetail,
  ownerId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<SavedDay>> {
  const stops = stopsForDay(detail, input.dayId);
  if (stops === null) {
    return { ok: false, error: { code: "not-found", message: "That day is not in this trip." } };
  }
  // An empty day saves nothing worth reusing, and the "Save" button is
  // disabled for one — but the API is the boundary, so it says so too.
  if (stops.length === 0) {
    return { ok: false, error: { code: "invalid", message: "This day has no stops to save." } };
  }
  // Trimmed BEFORE the emptiness check, not after: `SavedDay.name` requires
  // at least one character, and "   " passes the route's Zod parse on length
  // 3 and then trims to "" — a row that violates its own contract and throws
  // on the next read (CodeRabbit, PR #71).
  const name = input.name.trim();
  if (name === "") {
    return { ok: false, error: { code: "invalid", message: "Give this day a name." } };
  }
  // Checked BEFORE the insert, deliberately (KI-71's write-path half). The
  // stops come from `stopsForDay` over a `TripDetail` the caller was handed —
  // which is exactly the value that used to be an unparsed `trip_details.doc`,
  // and copied `undefined` into a required `SavedStop.kind` so the response
  // threw AFTER the library row had already been inserted (PR #71 review §2).
  // Refusing here means the failure mode is "nothing was saved", not "an
  // unreadable row is in your library and the request 500ed".
  const validated = SavedStop.array().safeParse(stops);
  if (!validated.success) {
    console.error("refused to save a day whose stops do not match SavedStop", {
      tripId: detail.tripId,
      dayId: input.dayId,
      issues: validated.error.issues,
    });
    return { ok: false, error: { code: "invalid", message: "This day cannot be saved." } };
  }
  const row: SavedDayRow = {
    id: randomUUID(),
    ownerId,
    name,
    stops: validated.data,
    // Derived HERE, once, at save time — the snapshot ADR-029 already takes of
    // `sourceTripName`, for the reason link 1 gives: `stops` is jsonb because a
    // saved day is never queried into, and Discover has to search on cities.
    //
    // `citiesOfStops` is the domain's single rule, the same one `citiesOfDay`
    // folds for the trip readout. A second implementation over `SavedStop[]`
    // would be free to drift, and a profile whose cities disagree with
    // Discover's is a gate box, not a rounding error.
    cities: citiesOfStops(validated.data),
    // Private until its author says otherwise (M11b link 3). Spelled through
    // the contract's enum rather than as the literal "private", so the set of
    // visibilities has exactly one definition — the rule M11a set for
    // `AdmissionRefusal`.
    visibility: SavedDayVisibility.enum.private,
    // Nobody has taken this day yet. It is only ever moved by the path that
    // writes a `saved_day_adds` row (PR2); see the schema note.
    adds: 0,
    sourceTripId: detail.tripId,
    sourceTripName: detail.name,
    createdAt: new Date(now),
  };
  await db.insert(savedDays).values(row);
  return { ok: true, value: toDto(row, validated.data) };
}

/** Newest first — what you just saved is what you are most likely to reach for. */
export async function listSavedDays(ownerId: string): Promise<SavedDay[]> {
  const rows = await db.select().from(savedDays).where(eq(savedDays.ownerId, ownerId));
  return rows
    .map(fromRow)
    // A row this server can no longer read is left out rather than allowed to
    // fail the whole library (see `fromRow`); it is logged, never silent.
    .filter((day): day is SavedDay => day !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function getSavedDay(savedDayId: string, ownerId: string): Promise<SavedDay | null> {
  const rows = await db
    .select()
    .from(savedDays)
    .where(and(eq(savedDays.id, savedDayId), eq(savedDays.ownerId, ownerId)));
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

export async function deleteSavedDay(savedDayId: string, ownerId: string): Promise<boolean> {
  const deleted = await db
    .delete(savedDays)
    .where(and(eq(savedDays.id, savedDayId), eq(savedDays.ownerId, ownerId)))
    .returning();
  return deleted.length > 0;
}

/**
 * Insert a saved day into a trip, as ONE batch — a new day at the end, then
 * its stops in order.
 *
 * One batch, not N commands, for the reason `executeTripCommandBatch` exists:
 * it appends under a single batchId, so the whole insert is one history entry
 * and one undo (ADR-005-adjacent). Half an inserted day is not a state anyone
 * should be able to land in.
 *
 * Ids are minted here, fresh per insert, so the same saved day can go into two
 * trips — or twice into one — without ever putting the same id in two streams
 * (the KI-1 hazard; `cloneTrip` remaps for the same reason).
 */
export function insertCommands(saved: SavedDay, tripId: string): BatchableCommand[] {
  const dayId = randomUUID();
  return [
    { type: "AddDay", tripId, dayId },
    ...saved.stops.map(
      (stop): BatchableCommand => ({
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: stop.title,
        // The event payloads use explicit null for "unset"; AddActivity uses
        // .optional() for the same fields, so null must become undefined
        // before it will pass validation (same normalization cloneTrip does).
        timeWindow: stop.timeWindow ?? undefined,
        location: stop.location ?? undefined,
        notes: stop.notes ?? undefined,
        anchors: stop.anchors,
        kind: stop.kind,
        tags: stop.tags,
        cost: stop.cost ?? undefined,
      }),
    ),
  ];
}

export async function insertSavedDay(
  savedDayId: string,
  tripId: string,
  actorId: string,
): Promise<CommandResult | { ok: false; error: AccessError }> {
  const saved = await getSavedDay(savedDayId, actorId);
  if (saved === null) {
    return { ok: false, error: { code: "not-found", message: "That saved day does not exist." } };
  }
  return executeTripCommandBatch(insertCommands(saved, tripId), actorId);
}
