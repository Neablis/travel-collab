import { eq } from "drizzle-orm";
import type { CoverCandidate, CoverPosition, TripCover } from "@tc/contracts";
import { coverProxySrcFits } from "./coverProxy";
import { coverJson, coverOf, coverValues, storedCover, urlCoverValues, type UrlCoverInput } from "./coverRows";
import { db } from "./db/client";
import { tripCovers } from "./db/schema";
import { fetchRemoteImage } from "./external/remoteImage/fetchImage";
import { RemoteImageRefused } from "./external/remoteImage/guard";

// A trip's cover photo (M37 D1): ordinary CRUD on `trip_covers`, never an
// event. The routes under `app/api/trips/[tripId]/cover/` and the public API's
// `app/api/v1/trips/[tripId]/cover/` are the only callers that write; the
// listing query reads the same table through
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

/**
 * Make the image at `input.url` the trip's cover, replacing any it had. The
 * URL is fetched once through the guarded fetcher first, and a refusal throws
 * its `RemoteImageRefused` (with the reason) having saved nothing, so a trip
 * never holds a cover that was not an image when it was set. A URL whose
 * signed path would not fit the contract is refused `url-too-long` before
 * that. The image itself is not kept: the cover is the URL (ADR-081 item 2).
 */
export async function setTripCoverFromUrl(
  tripId: string,
  input: UrlCoverInput,
  userId: string,
  { fetchImage = fetchRemoteImage, now = new Date() }: { fetchImage?: (url: string) => Promise<unknown>; now?: Date } = {},
): Promise<TripCover> {
  if (!coverProxySrcFits(input.url)) throw new RemoteImageRefused("url-too-long");
  await fetchImage(input.url);
  const values = urlCoverValues(input, userId, now);
  const [row] = await db
    .insert(tripCovers)
    .values({ tripId, ...values })
    .onConflictDoUpdate({ target: tripCovers.tripId, set: values })
    .returning();
  return storedCover(row);
}

/**
 * Move the trip's cover to `position` (0–100, checked by the caller's
 * contract), leaving the photo as it is. Answers the moved cover, or `null`
 * when the trip has none to move.
 */
export async function setTripCoverPosition(tripId: string, position: CoverPosition): Promise<TripCover | null> {
  const [row] = await db.update(tripCovers).set({ position }).where(eq(tripCovers.tripId, tripId)).returning();
  return row ? coverOf(row) : null;
}

/** Remove the trip's cover. Clearing a trip with none is not an error. */
export async function clearTripCover(tripId: string): Promise<void> {
  await db.delete(tripCovers).where(eq(tripCovers.tripId, tripId));
}
