import { createHash } from "node:crypto";

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
  return `${process.env.VERCEL_ENV ?? "dev"}:og`;
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

/** An hour: a pending invite's card, which is also deleted on revoke and accept. */
export const INVITE_CARD_TTL_SECONDS = 3600;

/** A day: a referrer's first name, which changes only if they rename themselves. */
export const REFERRAL_CARD_TTL_SECONDS = 86400;
