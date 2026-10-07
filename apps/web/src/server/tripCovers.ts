import { eq, sql } from "drizzle-orm";
import { TripCover, type CoverCandidate } from "@tc/contracts";
import { db } from "./db/client";
import { tripCovers } from "./db/schema";

// A trip's cover photo (M37 D1): ordinary CRUD on `trip_covers`, never an
// event. The routes under `app/api/trips/[tripId]/cover/` are the only callers
// that write; the listing query reads the same table through
// `TRIP_COVER_JSON` (`projections.ts`), so both shapes are built here.

/**
 * The `TripCover` a `trip_covers` row describes, as one jsonb value, or SQL
 * null when the LEFT JOIN found no row. Read alongside the summary, so the
 * home grid's covers cost no statement of their own.
 */
export const TRIP_COVER_JSON = sql<TripCover | null>`CASE WHEN ${tripCovers.tripId} IS NULL THEN NULL ELSE jsonb_build_object(
  'unsplashId', ${tripCovers.unsplashId},
  'urls', jsonb_build_object('raw', ${tripCovers.urlRaw}, 'regular', ${tripCovers.urlRegular}, 'small', ${tripCovers.urlSmall}),
  'alt', ${tripCovers.alt},
  'photographerName', ${tripCovers.photographerName},
  'photographerUrl', ${tripCovers.photographerUrl},
  'photoPageUrl', ${tripCovers.photoPageUrl}
) END`;

type Row = typeof tripCovers.$inferSelect;

function coverOf(row: Row): TripCover {
  return TripCover.parse({
    unsplashId: row.unsplashId,
    urls: { raw: row.urlRaw, regular: row.urlRegular, small: row.urlSmall },
    alt: row.alt,
    photographerName: row.photographerName,
    photographerUrl: row.photographerUrl,
    photoPageUrl: row.photoPageUrl,
  });
}

/** The trip's cover, or `null` when it has none. */
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
  const values = {
    unsplashId: candidate.id,
    urlRaw: candidate.urls.raw,
    urlRegular: candidate.urls.regular,
    urlSmall: candidate.urls.small,
    alt: candidate.alt,
    photographerName: candidate.photographerName,
    photographerUrl: candidate.photographerUrl,
    photoPageUrl: candidate.photoPageUrl,
    setBy: userId,
    setAt: now.toISOString(),
  };
  const [row] = await db
    .insert(tripCovers)
    .values({ tripId, ...values })
    .onConflictDoUpdate({ target: tripCovers.tripId, set: values })
    .returning();
  return coverOf(row!);
}

/** Remove the trip's cover. Clearing a trip with none is not an error. */
export async function clearTripCover(tripId: string): Promise<void> {
  await db.delete(tripCovers).where(eq(tripCovers.tripId, tripId));
}
