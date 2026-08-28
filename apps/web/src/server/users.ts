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
 * Auth.js `signIn` callback. Wired in `server/auth.ts`; deliberately fail-closed
 * on both paths, because the point of the table is that no session can exist
 * for a person who has no row. A payload with no id is refused (`false` → the
 * designed `/signin?error=` screen), and a database failure propagates rather
 * than being swallowed into a session with no durable identity behind it.
 */
export async function recordSignIn({ user }: { user?: SignInUser | null }): Promise<boolean> {
  const identity = normalizeIdentity(user);
  if (identity === null) return false;
  await upsertUser(identity);
  return true;
}
