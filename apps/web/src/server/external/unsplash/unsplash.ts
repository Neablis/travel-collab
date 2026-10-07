import { CoverCandidate } from "@tc/contracts";
import { UpstreamError, creditLinksOnUnsplash, httpsOn, type CoverPhotos } from "./ports";

// Unsplash's API (https://unsplash.com/documentation), on the terms the M37
// plan lists under "Unsplash's API guidelines". The ones kept in this file:
//
// - the Access Key only, server-side, as `Authorization: Client-ID <key>`
//   (guideline 6) — never in a URL, so it is in no log line or Referer;
// - `content_filter=high` on every search (guideline 8);
// - the download ping is a GET to the photo's own `links.download_location`,
//   query string and all, with the key (guideline 2), and only ever to that
//   photo's `/photos/{id}/download` on api.unsplash.com: a location from
//   anywhere else would be handing the key to a host we did not choose, and
//   one for another photo would credit the wrong photographer.
//
// Hotlinking (guideline 1) is the absence of code here: `urls.*` are passed
// through as Unsplash returned them and nothing downloads them.

const API = "https://api.unsplash.com";
const API_HOST = "api.unsplash.com";
const IMAGE_HOST = "images.unsplash.com";
const PER_PAGE = 12;
// A person is waiting on the picker; a slow vendor should fail visibly rather
// than hold a serverless function. MET's budget, for the same reason.
const TIMEOUT_MS = 4000;
// Unsplash sends no `Retry-After` with its 403; its window is an hour, and
// ten minutes is MET's backoff for the same silence.
const FALLBACK_BACKOFF_MS = 10 * 60 * 1000;
// Unsplash's image paths are `/photo-<id>`; anything else on its CDN (a
// profile image, a placeholder) is not a photo anyone searched for.
const IMAGE_PATH = /^\/photo-[\w-]+$/;
// The contract's own ceilings, read rather than restated, so a long caption
// or name is cut to fit instead of costing the photo.
const ALT_MAX = CoverCandidate.shape.alt.unwrap().maxLength ?? Infinity;
const NAME_MAX = CoverCandidate.shape.photographerName.maxLength ?? Infinity;

/** The fields of a search result this adapter reads. */
interface PhotoBody {
  id?: string;
  alt_description?: string | null;
  urls?: { raw?: string; regular?: string; small?: string };
  links?: { html?: string; download_location?: string };
  user?: { name?: string; links?: { html?: string } };
}

/** `text` cut to at most `max` UTF-16 units, an ellipsis marking the cut and no surrogate pair split. */
function fit(text: unknown, max: number): unknown {
  if (typeof text !== "string" || text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

/**
 * One Unsplash photo as a `CoverCandidate`, or `null` when it is missing a
 * field a cover needs. Alt text and a name too long for the contract are
 * shortened, not refused: neither is a reason to lose the photo.
 */
export function toCandidate(photo: PhotoBody): CoverCandidate | null {
  const parsed = CoverCandidate.safeParse({
    id: photo.id,
    urls: { raw: photo.urls?.raw, regular: photo.urls?.regular, small: photo.urls?.small },
    alt: fit(photo.alt_description ?? null, ALT_MAX),
    photographerName: fit(photo.user?.name, NAME_MAX),
    photographerUrl: photo.user?.links?.html,
    photoPageUrl: photo.links?.html,
    downloadLocation: photo.links?.download_location,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The photo id `url` is the download location of — an https URL on exactly
 * api.unsplash.com, path `/photos/{id}/download`, at most an `ixid` in its
 * query — or `null` for anything else.
 */
export function downloadLocationId(url: string): string | null {
  if (!httpsOn(url, API_HOST)) return null;
  const parsed = new URL(url);
  if (parsed.port || parsed.username || parsed.password || parsed.hash) return null;
  if ([...parsed.searchParams.keys()].some((key) => key !== "ixid")) return null;
  const match = /^\/photos\/([\w-]+)\/download$/.exec(parsed.pathname);
  return match ? match[1]! : null;
}

/** Whether `url` is a photo on Unsplash's image CDN. */
function photoOnCdn(url: string): boolean {
  return httpsOn(url, IMAGE_HOST) && IMAGE_PATH.test(new URL(url).pathname);
}

/** Unsplash's limit, spent: a 429, or the 403 it actually sends with `X-Ratelimit-Remaining: 0`. */
function rateLimited(res: Response): boolean {
  return res.status === 429 || (res.status === 403 && res.headers.get("X-Ratelimit-Remaining") === "0");
}

/** When to ask again: `Retry-After` in seconds when Unsplash sends one, else the fallback. */
function retryAfterOf(res: Response): Date {
  const seconds = Number(res.headers.get("Retry-After"));
  return new Date(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : FALLBACK_BACKOFF_MS));
}

/** A `CoverPhotos` backed by Unsplash's API, authenticated with `accessKey`. */
export function createUnsplash(accessKey: string): CoverPhotos {
  const headers = { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" };

  // A timeout or a dropped connection is the vendor not answering, the same
  // as a 5xx: one error type, so a route has one thing to catch. Redirects
  // are never followed: the key rides on a same-origin hop, to a path the
  // checks above never saw, so a 3xx is a failure like any other non-2xx.
  const get = async (url: URL | string, what: string): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new UpstreamError(`Unsplash ${what}: ${error instanceof Error ? error.name : "failed"}`);
    }
    // A spent limit is "not now", not "broken": it is reported as a 429
    // whichever status Unsplash used, so a route can say when to come back.
    if (rateLimited(res)) throw new UpstreamError(`Unsplash ${what}: rate limited`, 429, retryAfterOf(res));
    if (!res.ok) throw new UpstreamError(`Unsplash ${what}: ${res.status}`, res.status);
    return res;
  };

  const owns = (candidate: CoverCandidate): boolean =>
    Object.values(candidate.urls).every(photoOnCdn) &&
    creditLinksOnUnsplash(candidate) &&
    downloadLocationId(candidate.downloadLocation) === candidate.id;

  return {
    owns,

    async search(query, page) {
      const url = new URL(`${API}/search/photos`);
      url.searchParams.set("query", query);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(PER_PAGE));
      url.searchParams.set("content_filter", "high");
      url.searchParams.set("orientation", "landscape");
      const res = await get(url, "search");
      const body: unknown = await res.json().catch(() => {
        throw new UpstreamError("Unsplash search: a body that is not JSON");
      });
      // JSON is not yet a search answer: `null`, `{results: {}}` or a null in
      // the list would otherwise be a TypeError, and a 500 instead of a 502.
      const results = (body as { results?: unknown } | null)?.results;
      if (!Array.isArray(results) || !results.every((r) => typeof r === "object" && r !== null)) {
        throw new UpstreamError("Unsplash search: a body that is not a page of photos");
      }
      return (results as PhotoBody[])
        .map(toCandidate)
        .filter((candidate): candidate is CoverCandidate => candidate !== null && owns(candidate));
    },

    async trackDownload(downloadLocation) {
      if (downloadLocationId(downloadLocation) === null) {
        throw new UpstreamError(`Unsplash download: refusing a location that is not a photo's on ${API_HOST}`);
      }
      await get(downloadLocation, "download");
    },
  };
}
