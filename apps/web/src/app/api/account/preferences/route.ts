import { UpdateUserPreferences, UserPreferences } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readPreferences, writePreferences } from "@/server/users";

// The Identity module's only read/write surface outside the sign-in callback
// (M17). Account scope, so there is no `requireUser()` here and no access seam
// to reach for: `requireTripAccess` and `requireSavedDayRead` both resolve a
// RESOURCE and answer "may you touch this one", and this endpoint resolves
// nothing — the only question is whether anyone is signed in, and the answer is
// always about the caller's own row. `auth()` directly, and a 401, is the whole
// of it. Same shape as `saved-day-access.ts`'s first three lines, without the
// part that exists because a saved day belongs to somebody.

/**
 * The session names a user row that does not exist — a stale cookie against a
 * reset database, most often. Named after the reason and branchable without
 * matching prose, the same convention as `DEMO_TRIP_UNSUPPORTED_CODE`.
 */
export const NO_ACCOUNT_CODE = "no-account";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Never 404s. `readPreferences` answers with the storage defaults for a
  // session whose row has gone (JWT sessions outlive rows, ADR-025), so the
  // account screen renders rather than erroring at someone who is signed in.
  return Response.json({ preferences: await readPreferences(session.user.id) });
}

/**
 * Trim and upcase what a person typed, BEFORE the schema sees it.
 *
 * `UserPreferences.homeAirport` validates `^[A-Z]{3}$` and deliberately carries
 * no transform — `packages/contracts` holds none by convention, and
 * `identity.test.ts` pins that a lowercase code is REJECTED there rather than
 * coerced. So somebody typing `sfo` has to be normalized on this side of the
 * boundary, which is also the only side that can be trusted to have done it: a
 * client that forgot would otherwise send an uppercase-looking field the server
 * never checked.
 *
 * `displayName` is trimmed for the reason `saveDay` records about `name`: a
 * value of `"   "` passes a min-length check on its raw length and then renders
 * as a nameless person. Trimmed first, `"   "` becomes `""` and the schema's
 * `min(1)` refuses it with a message the Sheet can show.
 *
 * Only strings are touched. `null` (clear it) and an absent key (leave it
 * alone) must stay exactly what they were — collapsing either into the other
 * here would undo the distinction `UpdateUserPreferences` exists to keep.
 * Anything else is passed through untouched so the schema, not this function,
 * is what refuses it.
 */
function normalizePatch(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const patch: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (typeof patch.homeAirport === "string") {
    patch.homeAirport = patch.homeAirport.trim().toUpperCase();
  }
  if (typeof patch.displayName === "string") {
    patch.displayName = patch.displayName.trim();
  }
  return patch;
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const patch = UpdateUserPreferences.safeParse(
    normalizePatch(await request.json().catch(() => null)),
  );
  // Includes the empty patch, which the contract refuses rather than treating
  // as a no-op — a PATCH carrying nothing is a client bug worth saying so about.
  if (!patch.success) {
    return Response.json(
      { error: patch.error.issues[0]?.message ?? "invalid-preferences" },
      { status: 400 },
    );
  }
  const preferences = await writePreferences(session.user.id, patch.data);
  // No row to update. Deliberately NOT an insert — `upsertUser` in the sign-in
  // callback is the Identity module's only creator of rows, and it sits behind
  // the admission gate (M11a). A settings PATCH must not be a second door.
  if (preferences === null) {
    // Prose for the person, a stable code for the client — the shape every
    // other refusal in this app uses (`demo-trip-unsupported`,
    // `ai-not-entitled`). It was a bare `"no-account"` in the `error` field,
    // which the settings Sheet renders verbatim: the one string a signed-in
    // person could be shown here was an identifier written for a log. Found by
    // review on #112.
    return Response.json(
      { error: "Your account could not be found. Sign out and back in.", code: NO_ACCOUNT_CODE },
      { status: 404 },
    );
  }
  return Response.json({ preferences: UserPreferences.parse(preferences) });
}
