import { CoverCandidate } from "@tc/contracts";
import { UpstreamError, creditLinksOnUnsplash, httpsOn, type CoverPhotos } from "./ports";

// Unsplash's API (https://unsplash.com/documentation), on the terms the M37
// plan lists under "Unsplash's API guidelines". The ones kept in this file:
//
// - the Access Key only, server-side, as `Authorization: Client-ID <key>`
//   (guideline 6) — never in a URL, so it is in no log line or Referer;
// - `content_filter=high` on every search (guideline 8);
// - the download ping is a GET to the photo's own `links.download_location`,
//   query string and all, with the key (guideline 2), and only ever to
//   api.unsplash.com: a location from anywhere else would be handing the key
//   to a host we did not choose.
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

/** The fields of a search result this adapter reads. */
interface PhotoBody {
  id?: string;
  alt_description?: string | null;
  urls?: { raw?: string; regular?: string; small?: string };
  links?: { html?: string; download_location?: string };
  user?: { name?: string; links?: { html?: string } };
}

/** One Unsplash photo as a `CoverCandidate`, or `null` when it is missing a field a cover needs. */
export function toCandidate(photo: PhotoBody): CoverCandidate | null {
  const parsed = CoverCandidate.safeParse({
    id: photo.id,
    urls: { raw: photo.urls?.raw, regular: photo.urls?.regular, small: photo.urls?.small },
    alt: photo.alt_description ?? null,
    photographerName: photo.user?.name,
    photographerUrl: photo.user?.links?.html,
    photoPageUrl: photo.links?.html,
    downloadLocation: photo.links?.download_location,
  });
  return parsed.success ? parsed.data : null;
}

/** A `CoverPhotos` backed by Unsplash's API, authenticated with `accessKey`. */
export function createUnsplash(accessKey: string): CoverPhotos {
  const headers = { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" };

  // A timeout or a dropped connection is the vendor not answering, the same
  // as a 5xx: one error type, so a route has one thing to catch.
  const get = async (url: URL | string, what: string): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new UpstreamError(`Unsplash ${what}: ${error instanceof Error ? error.name : "failed"}`);
    }
    // Unsplash answers an exhausted hourly limit with 403 and
    // `X-Ratelimit-Remaining: 0`, not 429; both read as "not now".
    if (!res.ok) throw new UpstreamError(`Unsplash ${what}: ${res.status}`, res.status);
    return res;
  };

  const owns = (candidate: CoverCandidate): boolean =>
    Object.values(candidate.urls).every((url) => httpsOn(url, IMAGE_HOST)) &&
    creditLinksOnUnsplash(candidate) &&
    httpsOn(candidate.downloadLocation, API_HOST);

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
      const body = (await res.json().catch(() => {
        throw new UpstreamError("Unsplash search: a body that is not JSON");
      })) as { results?: PhotoBody[] };
      return (body.results ?? [])
        .map(toCandidate)
        .filter((candidate): candidate is CoverCandidate => candidate !== null && owns(candidate));
    },

    async trackDownload(downloadLocation) {
      if (!httpsOn(downloadLocation, API_HOST)) {
        throw new UpstreamError(`Unsplash download: refusing a location off ${API_HOST}`);
      }
      await get(downloadLocation, "download");
    },
  };
}
