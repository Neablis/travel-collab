import { eq } from "drizzle-orm";
import type { CoverCandidate, TripCover } from "@tc/contracts";
import { coverJson, coverOf, coverValues, storedCover } from "./coverRows";
import { db } from "./db/client";
import { tripCovers } from "./db/schema";

// A trip's cover photo (M37 D1): ordinary CRUD on `trip_covers`, never an
// event. The routes under `app/api/trips/[tripId]/cover/` are the only callers
// that write; the listing query reads the same table through
// `TRIP_COVER_JSON` (`projections.ts`). What a cover row is, in this table and
// in `saved_day_covers` alike, is `coverRows.ts`.

/** A trip's cover in the home listing (`LISTED_SUMMARY`). */
export const TRIP_COVER_JSON = coverJson(tripCovers, tripCovers.tripId);

/** The trip's cover, or `null` when it has none (or its row no longer parses). */
export async function getTripCover(tripId: string): Promise<TripCover | null> {
  const [row] = await db.select().from(tripCovers).where(eq(tripCovers.tripId, tripId));
  return row ? coverOf(row) : null;
}

/**
 * Make `candidate` the trip's cover, replacing any it had. The caller has
 * already checked the candidate came from the cover source (`owns`); its
 * `downloadLocation` is not kept.
 */
export async function setTripCover(
  tripId: string,
  candidate: CoverCandidate,
  userId: string,
  now: Date = new Date(),
): Promise<TripCover> {
  const values = coverValues(candidate, userId, now);
  const [row] = await db
    .insert(tripCovers)
    .values({ tripId, ...values })
    .onConflictDoUpdate({ target: tripCovers.tripId, set: values })
    .returning();
  return storedCover(row);
}

/** Remove the trip's cover. Clearing a trip with none is not an error. */
export async function clearTripCover(tripId: string): Promise<void> {
  await db.delete(tripCovers).where(eq(tripCovers.tripId, tripId));
}
