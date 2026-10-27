import { createHash, timingSafeEqual } from "node:crypto";

// PKCE, S256 only (RFC 7636 §4.6). `plain` is refused at authorize, before any
// code exists (ADR-083 amendment I), so this is the only method there is.

// RFC 7636 §4.1: 43 to 128 unreserved characters.
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
// A base64url SHA-256 is 43 characters, unpadded.
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

/** Is `challenge` the shape an S256 challenge has. */
export function isS256Challenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

/** Does `verifier` hash to `challenge`. */
export function verifyS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !isS256Challenge(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"), "ascii");
  return timingSafeEqual(computed, Buffer.from(challenge, "ascii"));
}
