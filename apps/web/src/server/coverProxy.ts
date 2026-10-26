import { createHmac, timingSafeEqual } from "node:crypto";
import { coverProxySecret } from "./config";

// The signature on a URL cover's proxy path (ADR-081 item 3). The server signs
// a cover's URL only when it serializes that cover to a client (`coverRows.ts`),
// so `/api/cover-image` serves exactly the URLs covers hold: the HMAC carries
// the authorization the serializer already decided, and nobody can mint a
// path for a URL of their own.

/** HMAC-SHA256 of `url` under `COVER_PROXY_SECRET`, base64url. */
export function signCoverUrl(url: string): string {
  return createHmac("sha256", coverProxySecret()).update(url, "utf8").digest("base64url");
}

/**
 * Whether `signature` is this server's for `url`. Constant time, because the
 * signature is attacker-supplied and `===` stops at the first differing byte.
 * The length check leaks only the length, which is public: every signature is
 * 43 characters.
 */
export function verifyCoverUrl(url: string, signature: string): boolean {
  const expected = Buffer.from(signCoverUrl(url), "utf8");
  const presented = Buffer.from(signature, "utf8");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

// Spelled as the URL parser spells it, because that is what the route
// compares against: `encodeURIComponent` leaves `'` raw, which the parser
// escapes, and parsing a query it has already serialized changes nothing.
const queryFor = (url: string, signature: string) =>
  new URL(`?u=${encodeURIComponent(url)}&s=${signature}`, "https://cover.invalid").search;
const pathFor = (url: string, signature: string) => `/api/cover-image${queryFor(url, signature)}`;

/**
 * Whether `search`, a request's raw query string, names exactly the `u` and
 * `s` parameters `coverProxySrc` mints for `url` and `signature`, under any
 * percent-encoding spelling. The minted spelling (`queryFor`) is still the
 * one path minted, but the route must not demand it byte for byte: a layer
 * in front of the route may respell the query — production, 2026-10-26,
 * normalized the parentheses in a Wikimedia filename, so a minted path
 * never arrived intact and its cover showed as none, while the same image
 * under a parenthesis-free name served. Decoding is the comparison, so a
 * respelling of the same pair passes and anything else (an extra parameter,
 * a duplicated one, a different URL or signature) does not; the HMAC stays
 * the authorization, and no URL without the server's signature serves. The
 * cost is cache keys, not security: the CDN keys on the whole query, so
 * distinct spellings of one image are distinct entries, each its own
 * upstream fetch on a miss.
 */
export function isCanonicalCoverQuery(search: string, url: string, signature: string): boolean {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.length !== 2 || !keys.includes("u") || !keys.includes("s")) return false;
  return params.get("u") === url && params.get("s") === signature;
}

/** The same-origin path a browser loads a URL cover from. */
export function coverProxySrc(url: string): string {
  return pathFor(url, signCoverUrl(url));
}

/**
 * Whether the path `coverProxySrc` mints for `url` passes the proxy route's
 * own gates, parsed the way the route parses a request: the minted spelling
 * survives the URL parser, and the signature verifies. Setting a cover
 * checks this before saving, so a day or trip never holds a cover the proxy
 * would refuse on every view. It cannot prove the edge serves the minted
 * path — a layer in front of the route may respell the query after this
 * check ran, which only the route's spelling-tolerant check and its
 * regression test cover — and a signing failure (production without
 * `COVER_PROXY_SECRET`) is a false, not a throw, so the caller refuses the
 * URL instead of storing a cover that shows as none.
 */
export function coverProxySrcVerifies(url: string): boolean {
  try {
    const parsed = new URL(coverProxySrc(url), "https://cover.invalid");
    const signature = parsed.searchParams.get("s");
    return (
      signature !== null &&
      isCanonicalCoverQuery(parsed.search, url, signature) &&
      verifyCoverUrl(url, signature)
    );
  } catch (error) {
    console.error("cover proxy path does not verify", { error: String(error) });
    return false;
  }
}

// `TripCover.proxySrc`'s cap in `@tc/contracts`, and the length of every
// signature: SHA-256 is 32 bytes, 43 characters of unpadded base64url.
const PROXY_SRC_MAX = 2048;
const SIGNATURE_LENGTH = 43;

/**
 * Whether the path minted for `url` fits the contract. Encoding can triple a
 * URL, so a URL within its own cap can still mint a path a client refuses to
 * parse; setting a cover checks this first. Needs no key, so it answers even
 * where signing would throw.
 */
export function coverProxySrcFits(url: string): boolean {
  return pathFor(url, "x".repeat(SIGNATURE_LENGTH)).length <= PROXY_SRC_MAX;
}
