// A URL cover, served from our own origin (ADR-081 item 3). A browser never
// loads a cover's third-party URL itself: the CSP's `img-src` stays as it is,
// and the host never sees a viewer's IP, cookies or referrer. The route
// serves only a URL the server signed while serializing a cover that holds
// it (`server/coverProxy.ts`), so it is not an open proxy; and every fetch
// goes through the guarded fetcher, on each CDN miss.
import { isCanonicalCoverQuery, verifyCoverUrl } from "@/server/coverProxy";
import { fetchRemoteImage } from "@/server/external/remoteImage/fetchImage";
import { RemoteImageRefused } from "@/server/external/remoteImage/guard";

export const runtime = "nodejs";

// The pair (u, s) names one image for as long as the cover holds it, so it is
// cached hard: a day in the browser, thirty days at the CDN. A cover that
// changes its URL changes its path.
const IMAGE_CACHE = "public, max-age=86400";
const IMAGE_CDN_CACHE = "public, max-age=2592000, stale-while-revalidate=86400";
// A refusal is cached briefly, so a broken cover on a busy page is one
// upstream fetch a minute rather than one per viewer.
const REFUSAL_CACHE = "public, max-age=60";

/** The image a signed cover URL names, or 403 for a bad signature or a query not spelled as minted, and 502 for an image the fetcher refused. */
export async function GET(request: Request): Promise<Response> {
  const { search, searchParams } = new URL(request.url);
  const url = searchParams.get("u");
  const signature = searchParams.get("s");
  if (
    url === null ||
    signature === null ||
    !isCanonicalCoverQuery(search, url, signature) ||
    !verifyCoverUrl(url, signature)
  ) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const image = await fetchRemoteImage(url);
    return new Response(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": IMAGE_CACHE,
        "CDN-Cache-Control": IMAGE_CDN_CACHE,
        "X-Content-Type-Options": "nosniff",
        // Opened as a document, it still runs nothing. Under Next the same
        // policy is served by `next.config.ts`, whose headers win over a
        // route's; this one holds wherever the route is served without it.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (!(error instanceof RemoteImageRefused)) throw error;
    console.warn("cover image refused", { reason: error.reason });
    return new Response(null, { status: 502, headers: { "Cache-Control": REFUSAL_CACHE, "CDN-Cache-Control": REFUSAL_CACHE } });
  }
}
