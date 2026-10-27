import { scryptSync } from "node:crypto";
import { ApiTokenPepperMissingError, digestsMatch } from "@/server/secrets/keyedDigest";

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
 * Exported for the integration test, which plants a pre-0069 row. Nothing that
 * mints may call it.
 */
export function legacyScryptDigest(secret: string): string {
  const pepper = process.env.API_TOKEN_PEPPER ?? "";
  if (pepper === "") throw new ApiTokenPepperMissingError();
  return scryptSync(secret, pepper, 32, SCRYPT).toString("hex");
}

/**
 * Is `secret` the one this pre-0069 row was minted for?
 *
 * The caller has already narrowed to rows with the secret's prefix and the
 * `storage-changed` reason, so the ~37ms is paid only by someone presenting a
 * token 0069 revoked.
 */
export function matchesLegacyToken(secret: string, row: { tokenHash: string }): boolean {
  return digestsMatch(legacyScryptDigest(secret), row.tokenHash);
}
