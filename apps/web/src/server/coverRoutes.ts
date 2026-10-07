import { after } from "next/server";
import { CoverSearchResponse, SetCoverBody, TripCoverResponse, type CoverCandidate, type TripCover } from "@tc/contracts";
import { UpstreamError } from "./external/upstream";
import { consumeQuota, quotaRefusal, unsplashPickQuota, unsplashSearchQuota } from "./quota";
import { readBody } from "./readBody";

// What a trip's cover routes and a playbook day's share once each has decided
// who may act (M37 parts 3 and 5): the search, the pick with its one download
// ping, and the answers the picker reads. One copy, so the two cannot drift on
// the 503, the 429, the quotas or the ping — Unsplash's guidelines are about
// the key, not about which page asked.
//
// The cover source arrives as an argument. This file may not import
// `server/external/unsplash` (the Unsplash wall, `eslint.config.mjs`): only a
// cover route may, so `CoverSource` restates the three methods used here.

/** The part of the cover port (`CoverPhotos`) these handlers call. */
export type CoverSource = {
  search(query: string, page: number): Promise<CoverCandidate[]>;
  trackDownload(downloadLocation: string): Promise<void>;
  owns(candidate: CoverCandidate): boolean;
};

// When Unsplash said "not now" without saying until when.
const FALLBACK_RETRY_SECONDS = 600;

/** Covers are not set up on this deployment: no key, and not offline. The UI says so. */
export const coversUnavailable = () => Response.json({ error: "covers-unavailable" }, { status: 503 });

/** The trip is deleted: no cover is searched for, set or cleared on it. */
export const tripDeleted = () => Response.json({ error: "This trip has been deleted." }, { status: 400 });

/**
 * What a failed call to Unsplash answers. Its rate limit is "not now", so a
 * 429 with `Retry-After`, as our own quota's refusal is; anything else is the
 * vendor failing, a 502.
 */
export function upstreamFailure(error: UpstreamError, now: Date = new Date()): Response {
  if (error.status !== 429) return Response.json({ error: "covers-upstream" }, { status: 502 });
  const retryAfterSeconds = error.retryAfter
    ? Math.max(1, Math.ceil((error.retryAfter.getTime() - now.getTime()) / 1000))
    : FALLBACK_RETRY_SECONDS;
  return Response.json(
    { error: "covers-rate-limited", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Unsplash's search answers at most 50 pages for a sensible query; a page
// beyond what anyone scrolls is refused here rather than spent there.
const MAX_PAGE = 50;
const MAX_QUERY = 100;

/**
 * The picker's search (D2): one page of candidates for `?q=`, `?page=` from 1,
 * as a `CoverSearchResponse`. Spends `userId`'s Unsplash search quota only on
 * a non-empty query; an empty one answers nothing without asking anyone, as
 * `/api/geocode` does, which is how the picker learns covers are set up.
 */
export async function coverSearch(request: Request, userId: string, photos: CoverSource | null): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const q = search.get("q")?.trim() ?? "";
  const page = Number(search.get("page") ?? "1");
  if (q.length > MAX_QUERY || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return Response.json({ error: `q is at most ${MAX_QUERY} characters; page is 1 to ${MAX_PAGE}` }, { status: 400 });
  }
  if (photos === null) return coversUnavailable();
  if (!q) return Response.json(CoverSearchResponse.parse({ results: [] }));
  const quota = await consumeQuota(unsplashSearchQuota(), userId);
  if (!quota.allowed) return quotaRefusal(quota);
  try {
    return Response.json(CoverSearchResponse.parse({ results: await photos.search(q, page) }));
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    console.error(`[covers] ${error.message}`);
    return upstreamFailure(error);
  }
}

/**
 * A pick: the body's candidate, re-checked against the cover source, charged
 * to the pick quota (its own, so searching cannot spend it), handed to
 * `store`, and then reported to Unsplash as a download after the response —
 * once per pick, a re-pick of the same photo included (guideline 2). Answers
 * `{ cover }`.
 */
export async function coverPick(
  request: Request,
  userId: string,
  photos: CoverSource | null,
  store: (candidate: CoverCandidate) => Promise<TripCover>,
): Promise<Response> {
  const body = await readBody(request, SetCoverBody, "candidate is required");
  if ("error" in body) return body.error;
  if (photos === null) return coversUnavailable();
  const { candidate } = body.data;
  // The pick comes from the browser and its links are then shown to everyone
  // who sees the cover, so it must be one the source could have returned:
  // images on its CDN, credits on unsplash.com, the ping on its API.
  if (!photos.owns(candidate)) return Response.json({ error: "not-a-cover-candidate" }, { status: 400 });
  const quota = await consumeQuota(unsplashPickQuota(), userId);
  if (!quota.allowed) return quotaRefusal(quota);
  const cover = await store(candidate);
  // After the response, and not fatal to it: the cover is chosen whether or
  // not Unsplash heard about it, so the person does not wait on a vendor round
  // trip, and failing the pick over a lost ping would make them pick again —
  // a second use, and a second ping.
  after(async () => {
    try {
      await photos.trackDownload(candidate.downloadLocation);
    } catch (error) {
      console.error(`[covers] download ping failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return Response.json(TripCoverResponse.parse({ cover }));
}
