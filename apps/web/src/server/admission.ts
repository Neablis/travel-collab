import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { AdmissionRefusal } from "@tc/contracts";
// The cookie's name, TTL and attributes live in one module on purpose — see
// that file's header. Importing them here rather than re-declaring keeps the
// read/clear side and the two write sides from drifting apart, which is the
// exact failure it exists to prevent.
import { PENDING_ADMISSION_COOKIE } from "@/lib/pendingAdmission";
import { db } from "./db/client";
import { inviteCodes, tripInvites } from "./db/schema";

// The invite gate (M11a link 1), **no longer a gate** (ADR-063, 2026-10-03).
// Signup is open: a brand-new account is admitted whatever it presents. What
// survives is the tracking — a single-use code is still claimed here, once, so
// `invite_codes.redeemed_by` still says who came in on whose code and M20's
// referral reward still has a code to pay out on. A refusal from
// `redeemAdmission` now means only "no code was claimed", and `recordSignIn`
// admits the person anyway as `open-signup`.
//
// There is still no advisory pre-check: M11a decided against a "is this code
// valid?" route (a brute-force oracle over `invite_codes`, and TOCTOU besides).
// A wrong code is simply not claimed.
//
// Admission is evaluated ONLY for someone with no `users` row. "Never been to
// the app" is exactly "has no `users` row" (ADR-025), so a returning account
// never spends a code it still holds. That check lives in `recordSignIn`,
// which is the only place that can do it before `upsertUser` creates the row.
//
// This module must never be imported from `src/proxy.ts`. The proxy runs in
// the Edge runtime with no database (ADR-024); it stores the credential in a
// cookie and validates nothing.

/** The cookie that carries an admission credential across the OAuth round trip. */

/** How a person got through the gate. Recorded so a refusal can be told from each. */
export type AdmissionGrant =
  | "returning-user"
  | "trip-invite"
  | "super-code"
  | "invite-code"
  // Nothing presented was claimable — no credential, an unknown one, or a code
  // someone else already spent. Granted by `recordSignIn` since signup opened
  // (ADR-063); it credits nobody.
  | "open-signup"
  // Granted by `recordSignIn`, never by anything in this file: dev login is an
  // ENVIRONMENT fact (AUTH_DEV_LOGIN + a non-production VERCEL_ENV), not a
  // credential, so there is nothing here to check or to spend.
  | "dev-login";

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
 * `false` before any comparison happens, so a blank code presented to a
 * deployment that forgot the variable never matches. Since signup opened
 * (ADR-063) a miss costs nobody their account; the super code now only marks
 * how someone arrived.
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
 * Validate the credential and, if it is a single-use code, burn it — one
 * call, because a check followed by a separate redeem is the race this table
 * exists to close.
 *
 * A refusal here no longer keeps anyone out (ADR-063): `recordSignIn` turns it
 * into an `open-signup` admission. It is still reported, rather than folded
 * into a success, so the caller can tell "this code was claimed, credit its
 * minter" from "nothing was claimed".
 *
 * The three ways through are tried in the order they cost: the trip-invite
 * token and the super code consume nothing, so a person who holds either keeps
 * whatever single-use code they were also given. A database failure propagates
 * rather than being swallowed (ADR-025 §4).
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
