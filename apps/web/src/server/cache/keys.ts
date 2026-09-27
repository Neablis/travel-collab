// Every key this app writes to the shared Redis, in one file (ADR-059). One
// free-tier database serves Preview and Production, so each key starts with
// the environment: a preview can never read, overwrite or delete a production
// entry. A new use adds its key here, with its own budget line in the ADR.

function prefix(): string {
  return `${process.env.VERCEL_ENV ?? "dev"}:og`;
}

/** The invite link-preview card's data for `token`. Personal cards only. */
export function inviteCardKey(token: string): string {
  return `${prefix()}:invite:${token}`;
}

/** The referrer's first name for referral `code`. Named referrers only. */
export function referralCardKey(code: string): string {
  return `${prefix()}:referral:${code}`;
}

/** An hour: a pending invite's card, which is also deleted on revoke and accept. */
export const INVITE_CARD_TTL_SECONDS = 3600;

/** A day: a referrer's first name, which changes only if they rename themselves. */
export const REFERRAL_CARD_TTL_SECONDS = 86400;
