import { eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { TripCover, type CoverCandidate } from "@tc/contracts";
import { db } from "./db/client";
import { savedDayCovers, tripCovers } from "./db/schema";

// A trip's cover photo (M37 D1): ordinary CRUD on `trip_covers`, never an
// event. The routes under `app/api/trips/[tripId]/cover/` are the only callers
// that write; the listing query reads the same table through
// `TRIP_COVER_JSON` (`projections.ts`), so both shapes are built here.
// `saved_day_covers` has these columns too, and `savedDayCovers.ts` reads and
// writes it through `coverOf` and `coverValues` below.

/**
 * The `TripCover` a row of `table` describes, as one jsonb value, or SQL null
 * when the LEFT JOIN on `key` found no row. Read alongside a listing, so its
 * covers cost no statement of their own.
 */
export function coverJson(table: typeof tripCovers | typeof savedDayCovers, key: AnyColumn): SQL<TripCover | null> {
  return sql<TripCover | null>`CASE WHEN ${key} IS NULL THEN NULL ELSE jsonb_build_object(
  'unsplashId', ${table.unsplashId},
  'urls', jsonb_build_object('raw', ${table.urlRaw}, 'regular', ${table.urlRegular}, 'small', ${table.urlSmall}),
  'alt', ${table.alt},
  'photographerName', ${table.photographerName},
  'photographerUrl', ${table.photographerUrl},
  'photoPageUrl', ${table.photoPageUrl}
) END`;
}

/** A trip's cover in the home listing (`LISTED_SUMMARY`). */
export const TRIP_COVER_JSON = coverJson(tripCovers, tripCovers.tripId);

/** The columns a cover row has, in `trip_covers` and `saved_day_covers` alike. */
export type CoverRow = Omit<typeof tripCovers.$inferSelect, "tripId">;

/** The `TripCover` a cover row describes. */
export function coverOf(row: CoverRow): TripCover {
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
  const values = coverValues(candidate, userId, now);
  const [row] = await db
    .insert(tripCovers)
    .values({ tripId, ...values })
    .onConflictDoUpdate({ target: tripCovers.tripId, set: values })
    .returning();
  return coverOf(row!);
}

/** The row a pick of `candidate` writes: everything but its `downloadLocation`. */
export function coverValues(candidate: CoverCandidate, userId: string, now: Date): CoverRow {
  return {
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
}

/** Remove the trip's cover. Clearing a trip with none is not an error. */
export async function clearTripCover(tripId: string): Promise<void> {
  await db.delete(tripCovers).where(eq(tripCovers.tripId, tripId));
}
