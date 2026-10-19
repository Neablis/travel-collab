// The first channel that brought a visitor, kept until they sign up (ADR-079).
// `proxy.ts` writes it from a `?ref=` link and `recordSignIn` copies it onto a
// new account, so its name, its bound and its life are written down once, here.
//
// Plain data and string functions only: `proxy.ts` runs before every request
// it matches, so it stays light and nothing it imports may reach the database
// (ADR-024).
import { pendingAdmissionCookieOptions, type PendingAdmissionCookieOptions } from "./pendingAdmission";

export const SIGNUP_REF_COOKIE = "caesura_ref";

// Thirty days: most visitors browse first and sign up on a later visit, which
// a ref read only from the signup URL would lose (ADR-079).
export const SIGNUP_REF_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SIGNUP_REF_PATTERN = /^[a-z0-9-]{1,32}$/;

// What the signups-by-channel console and script call an account with no
// channel; a channel by that name would be counted as a second "direct" row.
const NO_CHANNEL_LABEL = "direct";

/**
 * The channel label in a `?ref=` value, lowercased, or `null` when it is not
 * one. Anyone can write the link, so anything outside the pattern is dropped
 * rather than trimmed into shape.
 */
export function normalizeSignupRef(raw: string | null | undefined): string | null {
  const ref = (raw ?? "").toLowerCase();
  return SIGNUP_REF_PATTERN.test(ref) && ref !== NO_CHANNEL_LABEL ? ref : null;
}

/**
 * The pending-admission cookie's attributes with a month's life: the same
 * `secure`-by-host rule, so a production build served on localhost
 * (`test:e2e:ci-like`) still gets a cookie the browser keeps.
 */
export function signupRefCookieOptions(host: string | null): PendingAdmissionCookieOptions {
  return { ...pendingAdmissionCookieOptions(host), maxAge: SIGNUP_REF_MAX_AGE_SECONDS };
}
