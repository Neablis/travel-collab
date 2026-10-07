import { z } from "zod";

// Cover photos (M37 D1–D3). A cover is a decoration on a trip, not a plan
// fact: it lives in a CRUD side table (`trip_covers`), never in the event log,
// and its images are hotlinked from Unsplash's CDN rather than copied
// (Unsplash's API guidelines, binding on M37 parts 3–5; the plan
// `docs/plans/2026-10-06-M37-trip-cards-and-covers.md` lists them).
//
// URLs are plain strings here, not `.url()`: the offline fake the e2e lane
// runs against serves its images from the app's own origin as paths
// (`/offline-covers/…`). Which hosts are acceptable is a server decision made
// when a cover is set (`server/external/unsplash`), not a shape rule — and the
// credit links below are re-checked wherever they are rendered.

// Long enough for any imgix URL Unsplash returns (they run to ~250
// characters), short enough that a body of them stays small.
const Href = z.string().min(1).max(2048);

/** The three image sizes kept for a photo: `raw` takes imgix sizing parameters, the other two are ready-made. */
export const CoverUrls = z.object({
  /** The original, for sizing with imgix parameters (`w`, `q`, `fm`, `fit`, `crop`). */
  raw: Href,
  /** 1080px wide. */
  regular: Href,
  /** 400px wide. */
  small: Href,
});
export type CoverUrls = z.infer<typeof CoverUrls>;

/**
 * One search result in the cover picker. Everything a cover needs once
 * chosen, plus `downloadLocation` — the URL a pick must ping (D2), which is
 * never stored and never shown.
 */
export const CoverCandidate = z.object({
  /** Unsplash's photo id. */
  id: z.string().min(1).max(64),
  urls: CoverUrls,
  /** Unsplash's `alt_description`; the UI falls back to "Photo by <name>". */
  alt: z.string().max(1000).nullable(),
  photographerName: z.string().min(1).max(200),
  /** The photographer's Unsplash profile, linked in the credit. */
  photographerUrl: Href,
  /** The photo's own page on Unsplash. */
  photoPageUrl: Href,
  /** `links.download_location`: GET it, with the key, when the photo is picked. */
  downloadLocation: Href,
});
export type CoverCandidate = z.infer<typeof CoverCandidate>;

/** `GET /api/trips/:tripId/cover/search` — one page of candidates. */
export const CoverSearchResponse = z.object({
  results: z.array(CoverCandidate),
});
export type CoverSearchResponse = z.infer<typeof CoverSearchResponse>;

/** `PUT /api/trips/:tripId/cover` — the photo the editor picked. */
export const SetCoverBody = z.object({
  candidate: CoverCandidate,
});
export type SetCoverBody = z.infer<typeof SetCoverBody>;

/**
 * A trip's chosen cover, as every surface that shows it reads it: the images
 * and the credit (photographer and photo page), stored with the choice so a
 * page never asks Unsplash for them (D2).
 */
export const TripCover = z.object({
  /** Unsplash's photo id, so the picker can mark the current one. */
  unsplashId: z.string().min(1),
  urls: CoverUrls,
  alt: z.string().nullable().default(null),
  photographerName: z.string().min(1),
  photographerUrl: Href,
  photoPageUrl: Href,
});
export type TripCover = z.infer<typeof TripCover>;

/** `GET` and `PUT /api/trips/:tripId/cover` — the trip's cover, or `null` for none. */
export const TripCoverResponse = z.object({
  cover: TripCover.nullable(),
});
export type TripCoverResponse = z.infer<typeof TripCoverResponse>;

/** Where the credit's "Unsplash" links to. */
export const UNSPLASH_HOME = "https://unsplash.com/";

// A string match, not `new URL`: this package compiles into `@tc/predict`,
// whose build has neither the DOM's nor Node's globals. What it accepts is
// narrower than a URL parser would, on purpose — an https URL on exactly
// `unsplash.com`, its path starting with `/` — so `unsplash.com.evil.test` and
// `unsplash.com@evil.test` both fall through to the home page.
const CREDIT_URL = /^https:\/\/unsplash\.com(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#\S*)?$/;

/**
 * The href for a credit link — the photographer, the photo page, or Unsplash
 * itself — carrying the referral parameters Unsplash's guidelines ask for:
 * `utm_source` is the registered app name, `utm_medium=referral`.
 *
 * Anything that is not an https URL on `unsplash.com` comes back as Unsplash's
 * home page instead. A stored credit is shown to everyone on the trip, so a
 * `javascript:` or look-alike URL that got past the write must still not
 * become a link.
 */
export function unsplashCreditHref(url: string): string {
  const match = CREDIT_URL.exec(url);
  const path = match?.[1] || "/";
  const kept = (match?.[2] ?? "").split("&").filter((pair) => pair !== "" && !/^utm_(source|medium)(=|$)/.test(pair));
  return `https://unsplash.com${path}?${[...kept, "utm_source=caesura", "utm_medium=referral"].join("&")}`;
}
