import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { TripCover, type CoverCandidate } from "@tc/contracts";
import { coverProxySrc } from "./coverProxy";
import type { savedDayCovers, tripCovers } from "./db/schema";

// What a cover row is, whichever table holds it (M37): `trip_covers` (a trip's,
// `tripCovers.ts`) and `saved_day_covers` (a playbook day's,
// `savedDayCovers.ts`) have the same columns but their key, so the jsonb a
// listing reads, the `TripCover` a getter answers and the row a pick writes
// are built here once, for both.
//
// A row is one of `TripCover`'s two sources (M49, ADR-081): the Unsplash
// columns, or a `url` with an optional credit. Every mapping between the two
// shapes is here, so a table read anywhere else never decides which is which.
// So is minting a URL cover's `proxySrc`: every read that hands a cover to a
// client comes through `coverJson` or `coverOf`, and a URL cover without one
// shows as none.

type UrlCover = Extract<TripCover, { source: "url" }>;

/** What setting a cover from a URL takes: the URL, and optionally its alt, credit and framing. */
export type UrlCoverInput = Pick<UrlCover, "url"> & Partial<Pick<UrlCover, "alt" | "credit" | "position">>;

let unsignedLogged = false;

/**
 * `cover`, with the signed same-origin path a browser loads it from when it
 * is a URL cover. Without a signing key (production with `COVER_PROXY_SECRET`
 * unset) the cover goes without one and shows as none: a listing that threw
 * would cost the page over a decoration. Logged once per process, not per row;
 * the proxy route itself still refuses with a 500.
 */
function withProxySrc(cover: TripCover): TripCover {
  if (cover.source !== "url") return cover;
  try {
    return { ...cover, proxySrc: coverProxySrc(cover.url) };
  } catch (error) {
    if (!unsignedLogged) console.error("URL covers served without proxySrc", { error: String(error) });
    unsignedLogged = true;
    return cover;
  }
}

/**
 * The `TripCover` a row of `table` describes, as one jsonb value, or SQL null
 * when the LEFT JOIN on `key` found no row. Read alongside a listing, so its
 * covers cost no statement of their own. The signature cannot be taken in
 * SQL, so a URL cover's `proxySrc` is added as the row is decoded.
 */
export function coverJson(table: typeof tripCovers | typeof savedDayCovers, key: AnyColumn): SQL<TripCover | null> {
  return sql<TripCover | null>`CASE WHEN ${key} IS NULL THEN NULL WHEN ${table.source} = 'url' THEN jsonb_build_object(
  'source', 'url',
  'url', ${table.url},
  'alt', ${table.alt},
  'credit', CASE WHEN ${table.creditName} IS NULL THEN NULL ELSE jsonb_build_object('name', ${table.creditName}, 'url', ${table.creditUrl}) END,
  'position', ${table.position}
) ELSE jsonb_build_object(
  'source', 'unsplash',
  'unsplashId', ${table.unsplashId},
  'urls', jsonb_build_object('raw', ${table.urlRaw}, 'regular', ${table.urlRegular}, 'small', ${table.urlSmall}),
  'alt', ${table.alt},
  'photographerName', ${table.photographerName},
  'photographerUrl', ${table.photographerUrl},
  'photoPageUrl', ${table.photoPageUrl},
  'position', ${table.position}
) END`.mapWith((value: TripCover | null) =>
    value !== null && value.source === "url" && typeof value.url === "string" ? withProxySrc(value) : value,
  );
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
  const parsed = TripCover.safeParse(
    row.source === "url"
      ? {
          source: "url",
          url: row.url,
          alt: row.alt,
          credit: row.creditName === null ? null : { name: row.creditName, url: row.creditUrl },
          position: row.position,
        }
      : {
          source: "unsplash",
          unsplashId: row.unsplashId,
          urls: { raw: row.urlRaw, regular: row.urlRegular, small: row.urlSmall },
          alt: row.alt,
          photographerName: row.photographerName,
          photographerUrl: row.photographerUrl,
          photoPageUrl: row.photoPageUrl,
          position: row.position,
        },
  );
  if (parsed.success) return withProxySrc(parsed.data);
  console.error("cover row failed TripCover parse; shown without it", {
    source: row.source,
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

/**
 * The row a pick of `candidate` writes: everything but its `downloadLocation`.
 * Every column is named, so a pick over a URL cover clears its `url` and
 * credit, and a new photo is framed at the centre again (decision 9).
 */
export function coverValues(candidate: CoverCandidate, userId: string, now: Date): CoverRow {
  return {
    source: "unsplash",
    unsplashId: candidate.id,
    urlRaw: candidate.urls.raw,
    urlRegular: candidate.urls.regular,
    urlSmall: candidate.urls.small,
    alt: candidate.alt,
    photographerName: candidate.photographerName,
    photographerUrl: candidate.photographerUrl,
    photoPageUrl: candidate.photoPageUrl,
    url: null,
    creditName: null,
    creditUrl: null,
    position: 50,
    setBy: userId,
    setAt: now.toISOString(),
  };
}

/**
 * The row setting a cover from `input.url` writes: a reference to the image,
 * never a copy (ADR-081 item 2). Every Unsplash column is named and cleared,
 * as `coverValues` clears the URL ones, and the framing is the centre unless
 * the caller chose one.
 */
export function urlCoverValues(input: UrlCoverInput, userId: string, now: Date): CoverRow {
  return {
    source: "url",
    unsplashId: null,
    urlRaw: null,
    urlRegular: null,
    urlSmall: null,
    alt: input.alt ?? null,
    photographerName: null,
    photographerUrl: null,
    photoPageUrl: null,
    url: input.url,
    creditName: input.credit?.name ?? null,
    creditUrl: input.credit?.url ?? null,
    position: input.position ?? 50,
    setBy: userId,
    setAt: now.toISOString(),
  };
}
