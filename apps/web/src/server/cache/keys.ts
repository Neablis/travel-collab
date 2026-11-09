import { createHash } from "node:crypto";
import { deployEnv } from "@/lib/deployment/env";

// Every key this app writes to the shared Redis, in one file (ADR-059). One
// free-tier database serves Preview and Production, so each key starts with
// the environment: a preview can never read, overwrite or delete a production
// entry. A new use adds its key here, with its own budget line in the ADR.
//
// **A credential never appears in a key** (CodeRabbit, PR #259). An invite
// token is a bearer credential (ADR-026) and a referral code an admission one,
// and anyone who can list the shared database's keys would otherwise hold
// working links. Keys carry the SHA-256 of the value instead: the same input
// always yields the same key, so lookup and invalidation still meet, and the
// key gives back nothing that can be used.

function prefix(): string {
  return `${deployEnv() ?? "dev"}:og`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The invite link-preview card's data for `token`, keyed by the token's digest. */
export function inviteCardKey(token: string): string {
  return `${prefix()}:invite:${digest(token)}`;
}

/** The referrer's first name for referral `code`, keyed by the code's digest. */
export function referralCardKey(code: string): string {
  return `${prefix()}:referral:${digest(code)}`;
}

/**
 * A client metadata document fetched from `url` (ADR-083 §6), keyed by the
 * URL's digest like the rest. Its TTL is `CIMD_CACHE_TTL_SECONDS` in
 * `server/oauth/clients.ts`.
 */
export function cimdDocumentKey(url: string): string {
  return `${deployEnv() ?? "dev"}:oauth:cimd:${digest(url)}`;
}

/**
 * A client assertion's `jti` seen (RFC 7523 section 3), keyed by the digest of
 * client and `jti` together, since a `jti` is only unique per issuer. Lives as
 * long as the assertion could still verify.
 */
export function clientAssertionJtiKey(clientId: string, jti: string): string {
  return `${deployEnv() ?? "dev"}:oauth:jti:${digest(`${clientId}\n${jti}`)}`;
}

/**
 * A verified Personal Agent delegation (Poppy 5.2), by agent and delegation
 * `jti`. A resource sees one delegation on every request for hours, so its
 * checked form is kept until its `exp`. Keyed by agent too: a `jti` is only
 * unique per issuer.
 */
export function poppyDelegationKey(clientId: string, jti: string): string {
  return `${deployEnv() ?? "dev"}:poppy:delegation:${digest(`${clientId}\n${jti}`)}`;
}

/** An hour: a pending invite's card, which is also deleted on revoke and accept. */
export const INVITE_CARD_TTL_SECONDS = 3600;

/** A day: a referrer's first name, which changes only if they rename themselves. */
export const REFERRAL_CARD_TTL_SECONDS = 86400;
