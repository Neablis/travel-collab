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

const queryFor = (url: string, signature: string) => `?u=${encodeURIComponent(url)}&s=${signature}`;
const pathFor = (url: string, signature: string) => `/api/cover-image${queryFor(url, signature)}`;

/**
 * Whether `search`, a request's raw query string, is byte for byte the one
 * `coverProxySrc` mints for `url` and `signature`. The CDN keys on the whole
 * query, so a second spelling that still verifies (a parameter appended, `u`
 * percent-encoded another way) would be a cache miss, and an upstream fetch,
 * of its own; the route refuses every spelling but this one.
 */
export function isCanonicalCoverQuery(search: string, url: string, signature: string): boolean {
  return search === queryFor(url, signature);
}

/** The same-origin path a browser loads a URL cover from. */
export function coverProxySrc(url: string): string {
  return pathFor(url, signCoverUrl(url));
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
