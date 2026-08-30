import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { AdmissionRefusal } from "@tc/contracts";
import { db } from "./db/client";
import { inviteCodes, tripInvites } from "./db/schema";

// The invite gate (M11a link 1): the rule for who may get an account, written
// once and asked twice — advisorily by the `/signup` form so a wrong code says
// so before the browser leaves for Google, and authoritatively by
// `recordSignIn` on the way back.
//
// Admission is evaluated ONLY for someone with no `users` row. "Never been to
// the app" is exactly "has no `users` row" (ADR-025), so every account that
// existed before this gate shipped passes without a code and nothing needs a
// backfill. That check lives in `recordSignIn`, which is the only place that
// can do it before `upsertUser` creates the row.
//
// This module must never be imported from `src/proxy.ts`. The proxy runs in
// the Edge runtime with no database (ADR-024); it stores the credential in a
// cookie and validates nothing.

/** The cookie that carries an admission credential across the OAuth round trip. */
export const PENDING_ADMISSION_COOKIE = "pending_admission";

/**
 * Ten minutes: long enough for a Google round trip including a fresh consent
 * screen, short enough that a credential left on a shared machine is not a
 * standing invitation. The cookie is also cleared explicitly in `recordSignIn`
 * on both success and refusal — this TTL only covers a sign-in never finished.
 */
export const PENDING_ADMISSION_MAX_AGE_SECONDS = 600;

/** How a person got through the gate. Recorded so a refusal can be told from each. */
export type AdmissionGrant = "returning-user" | "trip-invite" | "super-code" | "invite-code";

export type AdmissionOutcome =
  | { admitted: true; via: AdmissionGrant }
  | { admitted: false; reason: AdmissionRefusal };

/**
 * The `pending_admission` cookie, behind a seam.
 *
 * `recordSignIn` is handed `{ user }` and no request, so the credential can
 * only be reached through `next/headers`. Injecting the accessor keeps that
 * out of the decision and lets the integration suite drive the whole gate
 * without a request context.
 */
export type PendingAdmission = {
  read(): Promise<string | null>;
  clear(): Promise<void>;
};

/**
 * The real cookie jar.
 *
 * Mutation is legal here: an App Route handler opens its request store with
 * `phase: 'action'` (`next/dist/server/route-modules/app-route/module.js:291`),
 * which is the one phase `areCookiesMutableInCurrentPhase` allows, and the same
 * module appends the mutated cookies onto the outgoing response (`:483`,
 * `:524`). `recordSignIn` runs inside `/api/auth/[...nextauth]`, so the delete
 * below reaches the browser.
 */
export function cookiePendingAdmission(): PendingAdmission {
  return {
    async read() {
      const jar = await cookies();
      return normalizeCredential(jar.get(PENDING_ADMISSION_COOKIE)?.value);
    },
    async clear() {
      const jar = await cookies();
      // Named with its path: a delete only matches the cookie it was written
      // with, and the contract fixes `path: "/"`.
      jar.delete({ name: PENDING_ADMISSION_COOKIE, path: "/" });
    },
  };
}

/**
 * Pure: the string a person actually presented, or `null` for "nothing".
 *
 * Surrounding whitespace goes because a code is copied out of a message and a
 * trailing space is not a different code. **Case is not folded**, and that is
 * the load-bearing part: the same field carries a trip-invite token, which is
 * 32 bytes of base64url (`access/invites.ts` `mintToken`) and case-sensitive.
 * Folding here would silently destroy the token path.
 */
export function normalizeCredential(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Pure: does the presented credential equal the configured super code?
 *
 * **Absent means closed.** An unset or blank `INVITE_SUPER_CODE` returns
 * `false` before any comparison happens, so a deployment that forgot the
 * variable refuses everyone rather than admitting everyone — the failure mode
 * worth being paranoid about, since the other direction is silent.
 *
 * Constant time, because this is a shared secret compared against attacker-
 * supplied input and `===` on strings short-circuits at the first differing
 * byte. `timingSafeEqual` throws on unequal lengths, so length is compared
 * first; that leaks the code's length and nothing else, which is why the code
 * should be minted from a CSPRNG rather than chosen to be memorable.
 */
export function matchesSuperCode(configured: string | undefined, presented: string): boolean {
  const expected = (configured ?? "").trim();
  if (expected === "" || presented === "") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Pure: where a refusal sends the browser.
 *
 * Auth.js collapses every falsy `signIn` return into one `AccessDenied`
 * (`@auth/core@0.41.3` `lib/actions/callback/index.js:393-409`) but passes a
 * *string* through the `redirect` callback, and the default redirect honours
 * any path starting with `/` (`init.js:13-19`). A returned path is therefore
 * the only way three refusals reach three different sentences.
 */
export function refusalRedirect(reason: AdmissionRefusal): string {
  return `/signin?error=${reason}`;
}

/**
 * Link 2: holding a pending, unrevoked trip invite admits you with no code.
 *
 * `status = 'pending'` alone already implies unrevoked — revocation writes
 * `status = 'revoked'` — which is the same predicate `acceptInvite` claims a
 * token with (`access/invites.ts:290`).
 *
 * Admission deliberately does NOT consume the token. The person is admitted so
 * that they can then land on `/invite/<token>` and accept it for real; burning
 * it here would sign them in and then tell them their link was already used.
 */
async function hasPendingTripInvite(token: string): Promise<boolean> {
  const found = await db
    .select({ id: tripInvites.id })
    .from(tripInvites)
    .where(and(eq(tripInvites.token, token), eq(tripInvites.status, "pending")))
    .limit(1);
  return found.length > 0;
}

/** Read at call time, not at module load, so an unset variable stays unset. */
function configuredSuperCode(): string | undefined {
  return process.env.INVITE_SUPER_CODE;
}

/**
 * Link 4: claim a single-use code, or say why it cannot be claimed.
 *
 * The construction is `acceptInvite`'s, deliberately (`invites.ts:287-296`):
 * one conditional `UPDATE ... WHERE code = ? AND redeemed_by IS NULL
 * RETURNING`, and an empty result means the row was already claimed — by a
 * concurrent sign-in, by an earlier one, or it never existed. Postgres settles
 * that under READ COMMITTED with no transaction and no lock, which is what
 * makes "exactly one of two racing redemptions wins" true by construction.
 * A re-read is then the only way to tell "spent" from "never existed", and
 * those are two different screens.
 */
async function claimInviteCode(
  code: string,
  userId: string,
  now: Date,
): Promise<AdmissionOutcome> {
  const claimed = await db
    .update(inviteCodes)
    .set({ redeemedBy: userId, redeemedAt: now })
    .where(and(eq(inviteCodes.code, code), isNull(inviteCodes.redeemedBy)))
    .returning();
  if (claimed[0] !== undefined) return { admitted: true, via: "invite-code" };

  const found = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
  const current = found[0];
  if (current === undefined) {
    return { admitted: false, reason: AdmissionRefusal.enum.INVALID_INVITE_CODE };
  }
  if (current.redeemedBy === userId) {
    // Already spent BY THIS PERSON — two tabs, or a retried callback. A
    // success from where they are standing, and still one redeemer on the row,
    // so single-use is not weakened. Same judgement `acceptInvite` makes for
    // "already used by you".
    return { admitted: true, via: "invite-code" };
  }
  return { admitted: false, reason: AdmissionRefusal.enum.SPENT_INVITE_CODE };
}

/**
 * **Advisory.** Would this credential admit someone right now? Redeems nothing.
 *
 * For the `/signup` form, so "that code isn't valid" is said before the browser
 * leaves for the provider. The answer can go stale between this call and the
 * sign-in that follows it — another person can spend the same single-use code
 * in between — so this is never the gate. `redeemAdmission` is.
 */
export async function checkAdmission(
  credential: string | null | undefined,
): Promise<AdmissionOutcome> {
  const presented = normalizeCredential(credential);
  if (presented === null) {
    return { admitted: false, reason: AdmissionRefusal.enum.MISSING_INVITE_CODE };
  }
  if (await hasPendingTripInvite(presented)) return { admitted: true, via: "trip-invite" };
  if (matchesSuperCode(configuredSuperCode(), presented)) {
    return { admitted: true, via: "super-code" };
  }
  const found = await db.select().from(inviteCodes).where(eq(inviteCodes.code, presented));
  const current = found[0];
  if (current === undefined) {
    return { admitted: false, reason: AdmissionRefusal.enum.INVALID_INVITE_CODE };
  }
  if (current.redeemedBy !== null) {
    return { admitted: false, reason: AdmissionRefusal.enum.SPENT_INVITE_CODE };
  }
  return { admitted: true, via: "invite-code" };
}

/**
 * **Authoritative.** Validate the credential and, if it is a single-use code,
 * burn it — one call, because a check followed by a separate redeem is the
 * race this table exists to close.
 *
 * The three ways through are tried in the order they cost: the trip-invite
 * token and the super code consume nothing, so a person who holds either keeps
 * whatever single-use code they were also given. A database failure propagates
 * rather than being swallowed (ADR-025 §4) — no session may exist for someone
 * the gate never actually cleared.
 */
export async function redeemAdmission(
  credential: string | null | undefined,
  userId: string,
  now: Date = new Date(),
): Promise<AdmissionOutcome> {
  const presented = normalizeCredential(credential);
  if (presented === null) {
    return { admitted: false, reason: AdmissionRefusal.enum.MISSING_INVITE_CODE };
  }
  if (await hasPendingTripInvite(presented)) return { admitted: true, via: "trip-invite" };
  if (matchesSuperCode(configuredSuperCode(), presented)) {
    return { admitted: true, via: "super-code" };
  }
  return claimInviteCode(presented, userId, now);
}
