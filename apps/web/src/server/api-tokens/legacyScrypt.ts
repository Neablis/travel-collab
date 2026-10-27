import { scrypt } from "node:crypto";
import { candidatePeppers, digestsMatch } from "@/server/secrets/keyedDigest";

// **The one scrypt verify left, in its own file so deleting it is one commit**
// (ADR-083 §3; KI-2026-10-27-e carries the date).
//
// Before migration 0069 a `tc_` token was stored as `scrypt(secret, pepper)`.
// 0069 revoked every one of those rows with `revoked_reason = 'storage-changed'`,
// and their digests can never match a `keyedDigest` lookup. Without this, a
// person presenting one would be told the token "is not valid", which reads as
// a typo rather than "we revoked it; mint a new one". This confirms the secret
// really is that row's so the refusal can say so. A match never authenticates.
//
// Delete it, and `verifyToken`'s call to it, once every `storage-changed` row's
// `expires_at` has passed (at most 2027-10-27).

/** The parameters every pre-0069 row was written with; any other value matches nothing. */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/**
 * The digest a `tc_` token was stored under before 0069, hex.
 *
 * **Async, on libuv's thread pool.** The prefix the caller narrows by is shown
 * in the UI, so anyone can make the server pay ~37ms here; `scryptSync` would
 * stall every other request for that long.
 *
 * Exported for the integration test, which plants a pre-0069 row. Nothing that
 * mints may call it.
 */
export function legacyScryptDigest(secret: string, pepper: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(secret, pepper, 32, SCRYPT, (error, key) =>
      error === null ? resolve(key.toString("hex")) : reject(error),
    );
  });
}

/**
 * Is `secret` the one this pre-0069 row was minted for?
 *
 * The caller has already narrowed to one row with the secret's prefix and the
 * `storage-changed` reason, so the ~37ms is paid at most once per pepper, and
 * only by someone presenting that prefix.
 *
 * **Under the current pepper, then the previous one.** The row was salted with
 * the pepper of its day, so after a rotation it is `API_TOKEN_PEPPER_PREVIOUS`
 * that matches; trying only the current one would turn every refusal into "not
 * valid". The peppers pass the same 32-byte floor as the keyed lookup, which
 * runs first and already refuses a short one, so exempting them here would
 * change no answer.
 */
export async function matchesLegacyToken(
  secret: string,
  row: { tokenHash: string },
): Promise<boolean> {
  for (const pepper of candidatePeppers()) {
    if (digestsMatch(await legacyScryptDigest(secret, pepper), row.tokenHash)) return true;
  }
  return false;
}
