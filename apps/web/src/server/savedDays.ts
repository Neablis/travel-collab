import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BatchableCommand, SavedDay, TripDetail } from "@tc/contracts";
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

function toDto(row: SavedDayRow): SavedDay {
  return {
    savedDayId: row.id,
    ownerId: row.ownerId,
    name: row.name,
    stops: row.stops,
    sourceTripId: row.sourceTripId,
    sourceTripName: row.sourceTripName,
    createdAt: row.createdAt,
  };
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
  const row: SavedDayRow = {
    id: randomUUID(),
    ownerId,
    name,
    stops,
    sourceTripId: detail.tripId,
    sourceTripName: detail.name,
    createdAt: now,
  };
  await db.insert(savedDays).values(row);
  return { ok: true, value: toDto(row) };
}

/** Newest first — what you just saved is what you are most likely to reach for. */
export async function listSavedDays(ownerId: string): Promise<SavedDay[]> {
  const rows = await db.select().from(savedDays).where(eq(savedDays.ownerId, ownerId));
  return rows
    .map(toDto)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function getSavedDay(savedDayId: string, ownerId: string): Promise<SavedDay | null> {
  const rows = await db
    .select()
    .from(savedDays)
    .where(and(eq(savedDays.id, savedDayId), eq(savedDays.ownerId, ownerId)));
  return rows[0] === undefined ? null : toDto(rows[0]);
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
