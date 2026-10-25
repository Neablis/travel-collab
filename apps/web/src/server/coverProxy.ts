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

/** The same-origin path a browser loads a URL cover from. */
export function coverProxySrc(url: string): string {
  return `/api/cover-image?u=${encodeURIComponent(url)}&s=${signCoverUrl(url)}`;
}
