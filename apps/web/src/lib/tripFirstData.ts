import {
  Page,
  PageListEntry,
  TripAccess,
  TripCoverResponse,
  TripDetail,
  TripGlobals,
  TripHistory,
  type TripCover,
} from "@tc/contracts";
import type { NotebookList } from "@/lib/pagesClient";
import { primeCached } from "@/lib/queryCache";
import { coverKeys, tripKeys } from "@/lib/queryKeys";

// **The trip page's first reads, sent with the page** (`docs/candidates.md`,
// "The trip page renders its first data on the server"). The board used to
// draw its header skeleton until hydration and then chain the reads below
// from the browser; the page now reads them in-process (`server/tripFirstData.ts`)
// and the board's first render is the board.
//
// Each field is the BODY its GET route answers, built by the same view builder
// (`server/tripViews.ts`), so what the page sends and what a later fetch
// receives cannot drift. The client decodes them here with the decoders the
// fetch helpers use.

/** What `tripFirstData` sends with the trip page: one GET route's body per field. */
export type TripFirstData = {
  /**
   * This answer's own id. A back or forward navigation can replay a page the
   * router kept, with its first data as old as the visit it came from, so a
   * provider adopts each answer once per document (`firstDataSpent`).
   */
  served: string;
  /** `GET /api/trips/:id` */
  trip: { trip: TripDetail };
  /** `GET /api/trips/:id/history` */
  history: { history: TripHistory };
  /** `GET /api/trips/:id/access` */
  access: { access: TripAccess };
  /** `GET /api/trips/:id/cover` */
  cover: TripCoverResponse;
  /** `GET /api/trips/:id/pages` */
  pages: { pages: PageListEntry[]; viewerId: string };
  /** `GET /api/trips/:id/pages/:overviewId`, or `null` for a trip with no Overview notebook. */
  overview: { page: Page } | null;
  /** `GET /api/trips/:id/globals` */
  globals: { globals: TripGlobals };
};

/** {@link TripFirstData} decoded: each value as its fetch helper resolves it, and as the query cache stores it. */
export type TripSeed = {
  detail: TripDetail;
  history: TripHistory;
  access: TripAccess;
  cover: TripCover | null;
  pages: NotebookList;
  overview: Page | null;
  globals: TripGlobals;
};

/** Decodes the page's first data with the fetch helpers' own schemas (`apiClient.ts`, `pagesClient.ts`). Pure. */
export function seedFrom(first: TripFirstData): TripSeed {
  return {
    detail: TripDetail.parse(first.trip.trip),
    history: TripHistory.parse(first.history.history),
    access: TripAccess.parse(first.access.access),
    cover: TripCoverResponse.parse(first.cover).cover,
    // `fetchPages`' decoding, written out: that module exports fetch helpers
    // only, which its own totality suite holds it to.
    pages: { pages: first.pages.pages.map((p) => PageListEntry.parse(p)), viewerId: first.pages.viewerId },
    overview: first.overview === null ? null : Page.parse(first.overview.page),
    globals: TripGlobals.parse(first.globals.globals),
  };
}

/**
 * Stores the seed in the query cache, as if each read had just answered, so
 * the board's own reads find it there and go to the wire only when it is old.
 *
 * **Browser only, and the caller's guard is not enough on its own, so this
 * holds its own.** The cache is a module: on the server one instance serves
 * every request, so a prime there would hand one reader's trip to the next
 * request that asked for the same key.
 */
export function primeTripSeed(tripId: string, seed: TripSeed): void {
  if (typeof window === "undefined") return;
  // Silent: this runs during `TripProvider`'s render, and a subscriber such as
  // the loading skeleton's cover peek must not be updated mid-render.
  const prime = <T,>(key: string, value: T) => primeCached(key, value, { silent: true });
  prime(tripKeys.detail(tripId), seed.detail);
  prime(tripKeys.history(tripId), seed.history);
  prime(tripKeys.access(tripId), seed.access);
  prime(coverKeys.trip(tripId), seed.cover);
  prime(tripKeys.pages(tripId), seed.pages);
  if (seed.overview !== null) prime(tripKeys.page(tripId, seed.overview.id), seed.overview);
  prime(tripKeys.globals(tripId), seed.globals);
}

/** The `served` ids this document has already adopted. */
const spent = new Set<string>();

/** Whether this document has adopted `first` before: a replayed page, whose data is as old as its first visit. */
export function firstDataSpent(first: TripFirstData): boolean {
  return spent.has(first.served);
}

/** Records that `first` has been adopted. From an effect, so a render React discards does not spend it. */
export function spendFirstData(first: TripFirstData): void {
  spent.add(first.served);
}
