import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { TripCover, type CoverCandidate } from "@tc/contracts";
import type { savedDayCovers, tripCovers } from "./db/schema";

// What a cover row is, whichever table holds it (M37): `trip_covers` (a trip's,
// `tripCovers.ts`) and `saved_day_covers` (a playbook day's,
// `savedDayCovers.ts`) have the same columns but their key, so the jsonb a
// listing reads, the `TripCover` a getter answers and the row a pick writes
// are built here once, for both.

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

/** The columns a cover row has, in `trip_covers` and `saved_day_covers` alike. */
export type CoverRow = Omit<typeof tripCovers.$inferSelect, "tripId">;

/**
 * The `TripCover` a cover row describes, or `null` when the row no longer
 * parses — logged, and shown as no cover. A stored photo whose shape a later
 * contract tightened costs the page its photo, never the page: Discover's
 * cards already read covers this way (`playbooks.ts`), and a day or trip read
 * that threw instead would be a 500 over a decoration.
 */
export function coverOf(row: CoverRow): TripCover | null {
  const parsed = TripCover.safeParse({
    unsplashId: row.unsplashId,
    urls: { raw: row.urlRaw, regular: row.urlRegular, small: row.urlSmall },
    alt: row.alt,
    photographerName: row.photographerName,
    photographerUrl: row.photographerUrl,
    photoPageUrl: row.photoPageUrl,
  });
  if (parsed.success) return parsed.data;
  console.error("cover row failed TripCover parse; shown without it", {
    unsplashId: row.unsplashId,
    issues: parsed.error.issues,
  });
  return null;
}

/**
 * The cover a pick just stored. Unlike a read, a row that does not parse here
 * is a fault — it was built from a candidate the contract had just accepted —
 * so it throws rather than answering a pick with no cover.
 */
export function storedCover(row: CoverRow | undefined): TripCover {
  const cover = row === undefined ? null : coverOf(row);
  if (cover === null) throw new Error("a cover row just written is missing or does not parse as a TripCover");
  return cover;
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
