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

/** The structural subset of Auth.js's `User`/`AdapterUser` that we read. */
type SignInUser = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Pure: what an Auth.js sign-in payload means as durable identity.
 *
 * Email is lowercased because it is the only field a human will later type to
 * invite someone (link 3), and "Ana@Example.com" inviting "ana@example.com"
 * must not produce two people. The id is kept verbatim — it is the provider's
 * own subject (`sub`, or `dev-<username>`) and is the string already stored in
 * `events.actor_id`, `pages.actor_id` and `TripMember.userId`.
 */
export function normalizeIdentity(user: SignInUser | null | undefined): SignInIdentity | null {
  const id = blankToNull(user?.id);
  if (id === null) return null;
  const email = blankToNull(user?.email);
  return {
    id,
    email: email === null ? null : email.toLowerCase(),
    name: blankToNull(user?.name),
    image: blankToNull(user?.image),
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
  { user }: { user?: SignInUser | null },
  pending: PendingAdmission = cookiePendingAdmission(),
): Promise<boolean | string> {
  const identity = normalizeIdentity(user);
  if (identity === null) return false;

  const returning = await hasUserRow(identity.id);
  const outcome = returning
    ? ({ admitted: true, via: "returning-user" } as const)
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
