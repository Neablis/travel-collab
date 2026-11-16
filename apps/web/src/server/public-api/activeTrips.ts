import { SOON_DAYS, type TripPhase } from "@tc/pages";
import { getTripDetails, listTripSummariesPage } from "@/server/projections";
import { turnNowOf } from "@/server/assistant/context";
import { buildTripGlobals } from "@/server/tripGlobals";
import { MAX_PAGE_LIMIT, type CollectionPage } from "./route";

// `GET /v1/trips?active=true`'s scan, out of the route file because it names
// its own cursor, and a route file leaves pagination to the wrapper.

type Listed = Awaited<ReturnType<typeof listTripSummariesPage>>[number];

/** The trip list's keyset cursor, matching `listTripSummariesPage`'s ORDER BY. */
export const tripKeyOf = (trip: { createdAt: string; tripId: string }) => `${trip.createdAt}|${trip.tripId}`;

const DAY_MS = 86_400_000;
/** Batches one `?active=true` request reads before it hands the caller a cursor to go on from. */
const ACTIVE_SCAN_BATCHES = 5;

/**
 * A page of the trips in `phases` at `at`: `tripNow`'s phase, on the server's
 * zone fallback (`turnNowOf`, ADR-080) with no asker's zone.
 *
 * The filter needs each trip's document, which the listing does not read, so
 * it walks the same keyset pages until it has `limit` trips in the phases or
 * runs out, and the cursor stays the list's own. Only a trip whose dates reach
 * within `startHorizonDays` of UTC's today is read: no zone is more than a day
 * from UTC, so no other trip can be in the phases anywhere — the underway scan
 * reads a day either side, the current scan `SOON_DAYS` past that, for a trip
 * starting soon.
 *
 * The batch is the list's largest page, not the caller's `limit`, and a request
 * reads at most `ACTIVE_SCAN_BATCHES` of them: an account of thousands of trips
 * with none in the phases is otherwise thousands of queries for one `[]`. At
 * the cap the page is short and its cursor is the last row read, so the next
 * request goes on from there.
 */
async function tripsInPhasesPage(
  userId: string,
  page: { limit: number; after: string | null },
  at: number,
  phases: readonly TripPhase[],
  startHorizonDays: number,
): Promise<CollectionPage<Listed>> {
  const yesterday = new Date(at - DAY_MS).toISOString().slice(0, 10);
  const horizon = new Date(at + startHorizonDays * DAY_MS).toISOString().slice(0, 10);
  const wanted = new Set(phases);
  const found: Listed[] = [];
  let after = page.after;
  for (let batch = 0; batch < ACTIVE_SCAN_BATCHES; batch++) {
    const rows = await listTripSummariesPage(userId, { limit: MAX_PAGE_LIMIT, after });
    const near = rows.filter(
      (row) => row.startDate !== null && row.endDate !== null && row.startDate <= horizon && row.endDate >= yesterday,
    );
    const details = await getTripDetails(near.map((row) => row.tripId), "omit");
    for (const row of near) {
      const detail = details.get(row.tripId);
      if (detail === undefined || !wanted.has(turnNowOf(detail, buildTripGlobals(detail), at).phase)) continue;
      found.push(row);
      // Rows after this one in the batch are read again from its cursor.
      if (found.length === page.limit) return { items: found, nextCursor: tripKeyOf(row) };
    }
    if (rows.length < MAX_PAGE_LIMIT) return { items: found, nextCursor: null };
    after = tripKeyOf(rows.at(-1)!);
  }
  return { items: found, nextCursor: after };
}

/**
 * A page of the trips under way at `at` (M52 decision 21) — what
 * `GET /v1/trips?active=true` lists.
 */
export async function activeTripsPage(
  userId: string,
  page: { limit: number; after: string | null },
  at: number,
): Promise<CollectionPage<Listed>> {
  return tripsInPhasesPage(userId, page, at, ["underway"], 1);
}

/**
 * A page of the trips under way now or starting soon at `at` — what a
 * `current:read` credential lists, and what `current:write` may change. A start
 * is soon within `SOON_DAYS`; the horizon carries one more day for the zone
 * skew, the same argument as the underway scan's.
 */
export async function currentTripsPage(
  userId: string,
  page: { limit: number; after: string | null },
  at: number,
): Promise<CollectionPage<Listed>> {
  return tripsInPhasesPage(userId, page, at, ["underway", "soon"], SOON_DAYS + 1);
}
