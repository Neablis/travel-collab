import { eq } from "drizzle-orm";
import { DistanceUnit, UserPreferences, type UpdateUserPreferences } from "@tc/contracts";
import {
  cookiePendingAdmission,
  redeemAdmission,
  refusalRedirect,
  type PendingAdmission,
} from "./admission";
import { db } from "./db/client";
import { users } from "./db/schema";
import { isDevLoginEnabled } from "@/lib/devLogin";

// The Identity module's whole write surface (AGENTS.md module map): a user row
// is created or refreshed on sign-in and nothing else touches it. Identity is
// ordinary CRUD, not event-sourced — ADR-003 scopes the log to planning.
//
// ADR-025: sessions stay JWT-only, so this table is not an Auth.js adapter and
// Auth.js never reads it. It exists so that `actor_id` — already the Auth.js
// user id verbatim — refers to something durable that outlives a token, which
// is what inviting a person requires (M11 link 1).

/** A sign-in payload reduced to the fields we durably keep. */
export type SignInIdentity = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
};

/**
 * The structural subset of Auth.js's `User`/`AdapterUser` that we read.
 *
 * `id` is deliberately ABSENT. Auth.js does supply one, and it is worthless:
 * `getUserAndAccount` overwrites it with a fresh `crypto.randomUUID()` on
 * every OAuth sign-in (`@auth/core@0.41.3`
 * `lib/actions/callback/oauth/callback.js:216-236`). Leaving the field off the
 * type is what makes the mistake this module made for a week — reading the id
 * from here — fail to compile rather than fail in production.
 */
type SignInUser = {
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

/**
 * The structural subset of Auth.js's `Account` that we read: the provider's
 * own subject for this person, and the only stable identifier in the payload.
 *
 * For Google this is `google-<sub>`, namespaced by `googleProfile`; for dev
 * login it is `dev-<username>`, namespaced by the provider itself. Both are
 * therefore already distinct across providers, which is why nothing here
 * branches on `account.provider`.
 */
type SignInAccount = {
  providerAccountId?: string | null;
  // WHICH provider authenticated, not which one the caller claims. Auth.js
  // builds this from the provider that actually handled the request, so it is
  // the only trustworthy way to recognise a dev-login sign-in — a `dev-`
  // prefix on `providerAccountId` is a string anyone can present through
  // Google. See `recordSignIn`'s dev-login branch.
  provider?: string | null;
};

/** What Auth.js hands the `signIn` callback, reduced to what identity needs. */
export type SignInPayload = {
  user?: SignInUser | null;
  account?: SignInAccount | null;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Pure: what an Auth.js sign-in payload means as durable identity.
 *
 * **The id comes from the ACCOUNT, the profile fields from the USER.** That
 * split is the whole point of taking one payload rather than two arguments:
 * `account.providerAccountId` is the provider's own subject and is the string
 * already stored in `events.actor_id`, `pages.actor_id` and
 * `TripMember.userId`, while `user.id` is a per-sign-in UUID Auth.js mints and
 * discards (see `SignInUser` above, and `googleProfile` in `lib/authConfig`).
 * Reading the id from the user is the 2026-09-05 bug; `SignInUser` has no `id`
 * field so that this cannot be written again.
 *
 * No subject means no identity, and no identity means no row: there is
 * deliberately no fallback to anything else in the payload, because every
 * candidate fallback is exactly the value that caused the incident.
 *
 * Email is lowercased because it is the only field a human will later type to
 * invite someone (link 3), and "Ana@Example.com" inviting "ana@example.com"
 * must not produce two people.
 */
export function normalizeIdentity(payload: SignInPayload | null | undefined): SignInIdentity | null {
  const id = blankToNull(payload?.account?.providerAccountId);
  if (id === null) return null;
  const email = blankToNull(payload?.user?.email);
  return {
    id,
    email: email === null ? null : email.toLowerCase(),
    name: blankToNull(payload?.user?.name),
    image: blankToNull(payload?.user?.image),
  };
}

/**
 * Create the row, or refresh the profile fields on an existing one.
 *
 * Last sign-in wins, including with a null: a provider is fixed per id, so the
 * fields it omits it always omits, and preferring the stored value would make
 * a genuinely cleared Google avatar unclearable.
 */
export async function upsertUser(
  identity: SignInIdentity,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db
    .insert(users)
    .values({ ...identity, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: identity.email, name: identity.name, image: identity.image, updatedAt: now },
    });
}

/**
 * What a user row means as preferences, when there is no user row.
 *
 * Spelled once, here, so the API's answer for a session whose row has gone and
 * the database's own `DEFAULT 'km'` cannot drift apart. `null` is the DTO's
 * "unset" for the two settable fields; `distanceUnit` has no unset state, which
 * is why the column is `not null default 'km'` rather than nullable.
 */
const PREFERENCE_DEFAULTS: UserPreferences = {
  displayName: null,
  homeAirport: null,
  distanceUnit: DistanceUnit.enum.km,
};

type UserRow = typeof users.$inferSelect;

/**
 * The read boundary: a stored row becomes a `UserPreferences`, the same shape
 * `savedDays.fromRow` uses and for the same reason.
 *
 * `distance_unit` is `text().$type<DistanceUnit>()`, and `$type` is a
 * COMPILE-TIME cast on Drizzle's side — it describes what the write path
 * intends, never what the bytes are. Handing `row.distanceUnit` straight into
 * the DTO would let any string in the column out as a typed contract value, and
 * the readers of it (`kmLabel`) branch on exactly two. A row holding anything
 * else falls back to the default rather than failing the read: unlike a saved
 * day, a preference nobody can parse has an obviously correct substitute, and
 * refusing to render the whole account over it would be the wrong trade. It is
 * LOGGED, never silent.
 *
 * `display_name` and `home_airport` are re-validated for the same reason — the
 * columns are plain `text`, so a row written before the contract's bounds
 * existed (or by hand) can hold a 500-character name or "San Francisco".
 * A value the contract refuses reads back as unset, which is what the account
 * settings Sheet can actually offer to fix.
 */
function toPreferences(row: UserRow): UserPreferences {
  const parsed = UserPreferences.safeParse({
    displayName: row.displayName,
    homeAirport: row.homeAirport,
    distanceUnit: row.distanceUnit,
  });
  if (parsed.success) return parsed.data;
  console.error("users preference columns failed UserPreferences parse", {
    userId: row.id,
    issues: parsed.error.issues,
  });
  return {
    displayName: UserPreferences.shape.displayName.safeParse(row.displayName).data ?? null,
    homeAirport: UserPreferences.shape.homeAirport.safeParse(row.homeAirport).data ?? null,
    distanceUnit: DistanceUnit.safeParse(row.distanceUnit).data ?? PREFERENCE_DEFAULTS.distanceUnit,
  };
}

/**
 * This person's preferences, or the storage defaults.
 *
 * **A missing row is not an error here.** Sessions are JWT-only (ADR-025), so a
 * token outlives the row it was minted from — a database restored from before
 * the account existed, or a row removed by hand, leaves a perfectly valid
 * session pointing at nothing. Throwing would turn that into a 500 on every
 * authenticated page rather than an account that shows its defaults, and the
 * defaults are what a brand-new row would have said anyway.
 */
export async function readPreferences(userId: string): Promise<UserPreferences> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] === undefined ? PREFERENCE_DEFAULTS : toPreferences(rows[0]);
}

/**
 * Apply a partial update and answer with the whole of what is now stored.
 *
 * The patch's two states are kept apart all the way down, which is the reason
 * `UpdateUserPreferences` is not a `Partial<>` of an optional-field schema: an
 * ABSENT key is left alone, an explicit `null` clears the column. `in` is the
 * test, not truthiness — `?? undefined` would silently turn "clear my name"
 * into "leave my name", the one bug this shape exists to make impossible.
 *
 * `null` for no such row, the idiom every owner-scoped write in `savedDays`
 * already uses. It must NOT quietly insert one: the sign-in callback is the
 * Identity module's only creator of rows (`upsertUser`), and a settings PATCH
 * minting an account would be a second door into that with none of the
 * admission gate behind it (M11a).
 */
export async function writePreferences(
  userId: string,
  patch: UpdateUserPreferences,
  now: string = new Date().toISOString(),
): Promise<UserPreferences | null> {
  const updated = await db
    .update(users)
    .set({
      ...("displayName" in patch ? { displayName: patch.displayName } : {}),
      ...("homeAirport" in patch ? { homeAirport: patch.homeAirport } : {}),
      ...("distanceUnit" in patch ? { distanceUnit: patch.distanceUnit } : {}),
      updatedAt: now,
    })
    .where(eq(users.id, userId))
    .returning();
  return updated[0] === undefined ? null : toPreferences(updated[0]);
}

/**
 * Has this person been here before?
 *
 * Asked BEFORE the upsert, because after it the answer is always yes:
 * `upsertUser` is a bare `onConflictDoUpdate` with no `RETURNING` and cannot
 * say whether the row it left behind is one it just created. Do not try to
 * infer admission from the upsert.
 */
async function hasUserRow(id: string): Promise<boolean> {
  const found = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return found.length > 0;
}

/**
 * Auth.js `signIn` callback. Wired in `server/auth.ts`; deliberately fail-closed
 * on every path, because the point of the table is that no session can exist
 * for a person who has no row. A payload with no id is refused (`false` → the
 * designed `/signup?error=` screen), and a database failure propagates rather
 * than being swallowed into a session with no durable identity behind it.
 *
 * **M11a widens the return to `boolean | string`** (ADR-025 amendment
 * 2026-08-30). Auth.js collapses every falsy return into a single
 * `AccessDenied` code, so `false` cannot say *why* the gate refused; a returned
 * path is passed through the `redirect` callback instead, which is the only way
 * the three refusals reach three different sentences. Fail-closed is unchanged:
 * `false` and a refusal path both end at `/signin`, and nothing here returns
 * `true` on a path the gate did not clear.
 *
 * The gate applies **only to someone with no `users` row**. An existing row is
 * admission, full stop, with no credential consumed — nobody already here gets
 * locked out, and a returning user never spends a code they still hold.
 *
 * The `pending_admission` cookie is cleared unconditionally, before either
 * answer is returned: an admission credential must not outlive the sign-in that
 * used it, and that includes a sign-in that turned out not to need it.
 */
export async function recordSignIn(
  payload: SignInPayload,
  pending: PendingAdmission = cookiePendingAdmission(),
): Promise<boolean | string> {
  // Refused here means refused before the gate is consulted and before any row
  // exists — including a payload carrying no account, which after 2026-09-05
  // is the shape that must never be admitted rather than quietly given an id.
  const identity = normalizeIdentity(payload);
  if (identity === null) return false;

  const returning = await hasUserRow(identity.id);
  // DEV LOGIN IS ITS OWN ADMISSION. The invite gate exists to control who
  // reaches a real deployment; dev login cannot reach one. `isDevLoginEnabled()`
  // requires AUTH_DEV_LOGIN=true AND VERCEL_ENV !== "production", and Vercel
  // sets VERCEL_ENV itself, so production cannot satisfy it however the opt-in
  // was scoped — the provider is not even registered there
  // (`lib/authConfig.ts`). Requiring an invite code on top of that gated a door
  // that is already locked, and locked out every fresh dev user on preview and
  // on a new local database: reported 2026-09-07, "i cant log in, sign in with
  // dev login errors because i dont have a invite code".
  //
  // BOTH conditions, in the repo's fail-closed idiom (`isDemoDataResetEnabled`,
  // `matchesSuperCode`): the environment must allow dev login, and the sign-in
  // must have come THROUGH the dev-login provider. Keying on `identity.id`
  // starting with `dev-` would be the bug — that string arrives from the
  // provider's subject and a Google account could carry it.
  //
  // THE ONE OPT-OUT, and it exists because this bypass would otherwise delete
  // the invite gate's only end-to-end coverage. `m11a-invite-gate.spec.ts`
  // proves the gate through DEV LOGIN — four refusals, a single-use race, and
  // the pending-admission cookie — because dev login is the only way a browser
  // test can mint an identity the app has never seen. Admitting every dev-login
  // sign-in makes all of that vacuous, so the e2e server sets this and the gate
  // applies there exactly as it did before. Set in `playwright.config.ts`
  // beside `INVITE_SUPER_CODE`, nowhere else: a human never sets it, and a
  // deployment never should.
  const gateAppliesAnyway = process.env.DEV_LOGIN_HONOURS_INVITE_GATE === "true";
  const viaDevLogin =
    isDevLoginEnabled() && payload?.account?.provider === "dev-login" && !gateAppliesAnyway;
  const outcome = returning
    ? ({ admitted: true, via: "returning-user" } as const)
    : viaDevLogin
      ? ({ admitted: true, via: "dev-login" } as const)
      : await redeemAdmission(await pending.read(), identity.id);

  // After the decision and before either answer, so a refusal cannot leave the
  // rejected credential behind to be replayed by the next sign-in attempt. Not
  // in a `finally`: a database failure above must propagate as itself rather
  // than be masked by whatever this throws.
  await pending.clear();

  if (!outcome.admitted) return refusalRedirect(outcome.reason);
  await upsertUser(identity);
  return true;
}
