import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
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
import { isUuid } from "./ids";
import { executeTripCommandBatch, type CommandResult } from "./commands";
import { addCounts, recordAdd } from "./savedDayAdds";
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
  const row = newSavedDayRow({
    ownerId,
    name,
    stops: validated.data,
    sourceTripId: detail.tripId,
    sourceTripName: detail.name,
    createdAt: new Date(now),
  });
  await db.insert(savedDays).values(row);
  return { ok: true, value: toDto(row, validated.data) };
}

/**
 * The one construction of a `saved_days` row — every derived and defaulted
 * field decided in exactly one place.
 *
 * Exported because the demo seed writes rows too (`POST /api/dev/saved-days`),
 * and the point of routing it through here is that it exercises the same
 * derivation a real save does. A seed that hand-wrote `cities` beside the stops
 * it declares would be a second source of truth that agreed only until somebody
 * edited a stop — which is the thing `packages/fixtures/japan/savedDays.ts`
 * already refuses to do on the fixture side.
 */
export function newSavedDayRow(input: {
  ownerId: string;
  name: string;
  stops: SavedStop[];
  sourceTripId: string;
  sourceTripName: string;
  createdAt: Date;
  /** Defaults to private — see below. Only the seed ever passes anything else. */
  visibility?: SavedDayVisibility;
  /** The seed declares its own ids so re-seeding is idempotent. */
  savedDayId?: string;
}): SavedDayRow {
  const visibility = input.visibility ?? SavedDayVisibility.enum.private;
  return {
    id: input.savedDayId ?? randomUUID(),
    ownerId: input.ownerId,
    name: input.name,
    stops: input.stops,
    // Derived HERE, once, at save time — the snapshot ADR-029 already takes of
    // `sourceTripName`, for the reason link 1 gives: `stops` is jsonb because a
    // saved day is never queried into, and Discover has to search on cities.
    //
    // `citiesOfStops` is the domain's single rule, the same one `citiesOfDay`
    // folds for the trip readout. A second implementation over `SavedStop[]`
    // would be free to drift, and a profile whose cities disagree with
    // Discover's is a gate box, not a rounding error.
    cities: citiesOfStops(input.stops),
    // Private until its author says otherwise (M11b link 3). Spelled through
    // the contract's enum rather than as the literal "private", so the set of
    // visibilities has exactly one definition — the rule M11a set for
    // `AdmissionRefusal`.
    visibility,
    // Nobody has taken this day yet. It is only ever moved by `recordAdd`,
    // which writes the ledger row in the same statement pair; see the schema
    // note on `saved_days.adds`.
    adds: 0,
    // Moves with `visibility` and only with it (see `setSavedDayVisibility`):
    // a row that is public has a publish time, a row that is private has none.
    publishedAt: visibility === SavedDayVisibility.enum.public ? input.createdAt : null,
    // Never deleted. Only `deleteSavedDay` ever moves this, and nothing moves
    // it back yet — the restore path the column exists for is a future button,
    // not a code path (see the schema note).
    deletedAt: null,
    sourceTripId: input.sourceTripId,
    sourceTripName: input.sourceTripName,
    createdAt: input.createdAt,
  };
}

/**
 * Newest first — what you just saved is what you are most likely to reach for.
 *
 * `deleted_at is null`, like every other read of this table: a soft-deleted day
 * is gone from its owner's own library too. "It just removes it here" is the
 * whole of what the button promises, and a day that reappeared in the one list
 * its owner deletes from would make the promise false.
 */
export async function listSavedDays(ownerId: string): Promise<SavedDay[]> {
  const rows = await db
    .select()
    .from(savedDays)
    .where(and(eq(savedDays.ownerId, ownerId), isNull(savedDays.deletedAt)));
  return rows
    .map(fromRow)
    // A row this server can no longer read is left out rather than allowed to
    // fail the whole library (see `fromRow`); it is logged, never silent.
    .filter((day): day is SavedDay => day !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Owner-scoped: your own day, whatever its visibility. Nobody else's, ever.
 *
 * And not a deleted one — the `deleted_at is null` clause is in the WHERE for
 * the same reason the owner clause is, so a deleted day is "no row" rather than
 * a row a caller has to remember to check.
 */
export async function getSavedDay(savedDayId: string, ownerId: string): Promise<SavedDay | null> {
  // `saved_days.id` is a uuid column (KI-2026-09-05-x). "No row" is the answer
  // to a day that is not yours, was deleted, or never existed — and it is the
  // answer to an id that could never have named one. Anything else here is a
  // `22P02` from the driver, which the routes turned into a 500.
  if (!isUuid(savedDayId)) return null;
  const rows = await db
    .select()
    .from(savedDays)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
      ),
    );
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/**
 * The read rule the public library rests on: **your own day, or anybody's
 * published one.** The access seam over it, and the reasoning for why it is a
 * seam of its own rather than a role on `requireTripAccess`, is
 * `access/saved-day-access.ts`.
 *
 * Expressed in the WHERE clause rather than as a check after the read, which is
 * the same construction `getSavedDay` and `deleteSavedDay` already use: a
 * private day belonging to somebody else comes back as "no row", so it is
 * indistinguishable from one that never existed. That is the right answer to
 * both, and it is what stops a caller enumerating ids to discover what people
 * have kept to themselves.
 */
export async function readableSavedDay(
  savedDayId: string,
  readerId: string,
): Promise<SavedDay | null> {
  // `getSavedDay`'s reason. This one also covers `insertSavedDay`, which reads
  // through here — so `POST /api/trips/:id/saved-days/not-a-uuid` answers 404
  // without the route learning that uuids exist.
  if (!isUuid(savedDayId)) return null;
  const rows = await db
    .select()
    .from(savedDays)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        // A deleted day is not readable by ANYONE, its author included, and it
        // is refused the same way a private one is: by producing no row, so the
        // route's 404 cannot tell the two apart. `saved-day-access.ts` records
        // why that indistinguishability is load-bearing.
        isNull(savedDays.deletedAt),
        or(
          eq(savedDays.ownerId, readerId),
          eq(savedDays.visibility, SavedDayVisibility.enum.public),
        ),
      ),
    );
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/**
 * Publish or unpublish one of your own days (M11b link 3).
 *
 * Owner-scoped in the WHERE clause, for `getSavedDay`'s reason: somebody else's
 * day is "no row", so publishing is never something you can do to another
 * person's library and the refusal does not confirm the day exists. Unpublish
 * is here rather than in M12 because it is the author's control over their own
 * content — a publish button with no way back is not a thing to ship.
 *
 * `published_at` moves with `visibility` and only here. Publishing an
 * already-public day is a no-op on the timestamp (`COALESCE`) so that a
 * double-click, a retry or an idempotent client cannot quietly reorder
 * Discover's "newest" — unpublishing clears it, so a genuine republish does
 * take a new date, which is the honest answer for a day that was withdrawn and
 * put back.
 *
 * Returns the updated day, or null when there is no such row of yours.
 */
export async function setSavedDayVisibility(
  savedDayId: string,
  ownerId: string,
  visibility: SavedDayVisibility,
  now: string = new Date().toISOString(),
): Promise<SavedDay | null> {
  // `getSavedDay`'s reason: `null` here already means "no such row of yours",
  // and the publish route turns it into a 404 (KI-2026-09-05-x).
  if (!isUuid(savedDayId)) return null;
  const at = new Date(now);
  const updated = await db
    .update(savedDays)
    .set({
      visibility,
      publishedAt:
        visibility === SavedDayVisibility.enum.public
          ? sql`coalesce(${savedDays.publishedAt}, ${at})`
          : null,
    })
    // `deleted_at is null` as well as owner-scoped: a deleted day cannot be
    // published back into Discover. Without this an author could delete a day
    // and then publish it — the row is still there and the publish route only
    // ever knew "is it yours" — putting a day nobody can open onto the front of
    // the library.
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
      ),
    )
    .returning();
  if (updated[0] === undefined) return null;
  const day = fromRow(updated[0]);
  if (day === null) {
    // `null` from here means "no such row of yours", and the route turns it
    // into a 404. It must not also mean "the row is unreadable", because by
    // this point the UPDATE has ALREADY COMMITTED — the author would be told
    // the day does not exist while it sits published. `fromRow` returns null
    // for a row whose `stops` or `visibility` fail their schema, and both
    // columns are compile-time `$type` casts with no runtime guarantee, so
    // that is reachable for a row written before the contract moved.
    //
    // Failing loudly keeps the reported state and the stored state agreeing.
    // Raised in review on pull request 101.
    throw new Error(`saved day ${savedDayId} is unreadable after a committed visibility change`);
  }
  return day;
}

/**
 * What `deleteSavedDay` answered with. Three outcomes, because two of them are
 * different refusals and the route owes them different words.
 *
 *   * `deleted` — the row is soft-deleted and gone from every read;
 *   * `published` — the day is public, so it must be unpublished first;
 *   * `not-found` — there is no such day of yours, and this is deliberately
 *     also the answer for somebody else's day and for one already deleted.
 */
export type SavedDayDeletion = "deleted" | "published" | "not-found";

/**
 * Delete one of your own days — a SOFT delete (Mitchell, 2026-09-01: *"for now
 * we can even just add a new db column deletedAt and set the deleted at date,
 * and set a filter to not return deletedAt activities so we have a way to
 * restore in the future"*).
 *
 * **What this does not touch, and must never touch.** The adds ledger
 * (`saved_day_adds`) is a record of what happened, not a grant, so no row is
 * removed from it — the same reasoning `scopePredicate` already records for the
 * `saved` scope. And a day somebody has already taken stays in their trip:
 * `insertCommands` mints fresh ids and appends real events into THAT trip's
 * stream, so the copy is a value with nothing pointing back here (ADR-029).
 * *"It doesn't remove it from anyone, it just removes it here."*
 *
 * **Published days are refused rather than silently unpublished.** Deleting a
 * day that is out in the library is two decisions — withdraw it, then remove
 * it — and doing both off one button would take a day out of everyone's
 * Discover results as a side effect of an action whose stated scope is "just
 * removes it here". The author unpublishes first, deliberately, and the refusal
 * says so.
 *
 * **Owner-scoped in the WHERE clause**, the construction every other write on
 * this table uses: somebody else's day is "no row", so a refusal never confirms
 * that an id names something. The published check is expressed as a predicate
 * on the same UPDATE rather than as a read-then-write, so a publish landing
 * between the two cannot slip a public day past it.
 *
 * Idempotent by omission: deleting an already-deleted day matches nothing and
 * answers `not-found`, which is what every read of it already says.
 */
export async function deleteSavedDay(
  savedDayId: string,
  ownerId: string,
  now: string = new Date().toISOString(),
): Promise<SavedDayDeletion> {
  // `getSavedDay`'s reason. `not-found` and not `published`: an id that is not
  // a uuid names nothing, so there is nothing to unpublish first
  // (KI-2026-09-05-x).
  if (!isUuid(savedDayId)) return "not-found";
  const deleted = await db
    .update(savedDays)
    .set({ deletedAt: new Date(now) })
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
        eq(savedDays.visibility, SavedDayVisibility.enum.private),
      ),
    )
    .returning({ id: savedDays.id });
  if (deleted.length > 0) return "deleted";

  // Nothing moved. Two reasons are possible and the caller needs to tell them
  // apart, so the row is re-read under the SAME owner scope — a day that is not
  // yours still comes back as no row here, so this second query cannot turn a
  // non-disclosure into a disclosure. Only a day that is genuinely yours, still
  // present, and public can produce "published".
  const rows = await db
    .select({ visibility: savedDays.visibility })
    .from(savedDays)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
      ),
    );
  return rows[0]?.visibility === SavedDayVisibility.enum.public ? "published" : "not-found";
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

/**
 * Insert a saved day into a trip, and — when the design's rule says it counts —
 * write the adds ledger row in the SAME transaction (M11b link 4).
 *
 * Two things changed here in M11b, both load-bearing:
 *
 * **The day no longer has to be yours.** It is read through
 * `readableSavedDay`, so a day somebody published can be taken into your trip —
 * which is what link 6's "Add to a trip" is, and what makes the counter mean
 * anything. A private day of somebody else's is still "no such day", the same
 * 404 as before.
 *
 * **The ledger row rides the command pipeline's own transaction.** It is
 * written through `executeTripCommandBatch`'s `alsoInSameTransaction` hook
 * rather than after the call returns, because the two writes have to be one
 * fact: an add recorded against a batch that then failed its optimistic-
 * concurrency check would be an add of a day that is not in the trip, and a
 * batch that committed while the ledger write failed would be an add nobody is
 * credited for. `recordAdd` moves the denormalised counter in the same
 * transaction again, so `saved_days.adds` and `count(*)` over the ledger cannot
 * come apart at any point a reader could observe.
 *
 * An uncounted add is SILENT — the insert still succeeds and the response is
 * unchanged. All three of the design's clauses describe perfectly ordinary
 * things to do (adding the same day twice, planning an undated trip, reusing
 * your own template); none of them is an error to report to the person doing
 * it. What must not happen is the number moving.
 */
export async function insertSavedDay(
  savedDayId: string,
  tripId: string,
  actorId: string,
  now: string = new Date().toISOString(),
): Promise<CommandResult | { ok: false; error: AccessError }> {
  const saved = await readableSavedDay(savedDayId, actorId);
  if (saved === null) {
    return { ok: false, error: { code: "not-found", message: "That saved day does not exist." } };
  }
  return executeTripCommandBatch(insertCommands(saved, tripId), actorId, async (tx, { detail }) => {
    // `detail` is the trip as it stands after the insert committed inside this
    // transaction — and `startDate` is untouched by AddDay/AddActivity, so it
    // is equally the trip's dating before it. Read from here rather than
    // re-queried so the eligibility decision cannot see a different trip than
    // the one the batch just wrote.
    if (!addCounts({ authorId: saved.ownerId, actorId, tripStartDate: detail.startDate })) return;
    await recordAdd(tx, {
      savedDayId: saved.savedDayId,
      tripId,
      addedBy: actorId,
      createdAt: new Date(now),
    });
  });
}
