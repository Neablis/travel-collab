import { z } from "zod";

/**
 * The Identity module's cross-boundary types (AGENTS.md module map).
 *
 * Nothing here is event-sourced. ADR-003 scopes the log to planning, and a
 * preference is not trip state: it is not versioned, not undoable, and belongs
 * to no trip's history. Putting "switch to miles" in the event log would make it
 * an entry in some trip's undo stack, which is the boundary smell ADR-003 exists
 * to name. These are ordinary CRUD columns on `users` (ADR-025).
 *
 * The planning domain never imports this file, and `packages/domain` never sees
 * a preference at all — a distance is computed in kilometres and *rendered* in
 * whatever the reader prefers, so the unit lives at the edge and never in the
 * pure core.
 */

/**
 * How a person wants distances shown. **Account scope, deliberately** —
 * SPEC §12: *"a trip does not have a unit, a person does."* There is no
 * per-trip unit field anywhere, and adding one later would mean deciding what
 * two collaborators with different preferences see on the same trip.
 *
 * Stored as the unit, not as a locale: a locale would imply we also derive
 * date and number formatting from it, which we do not.
 */
export const DistanceUnit = z.enum(["km", "mi"]);
export type DistanceUnit = z.infer<typeof DistanceUnit>;

/**
 * What a person has set about themselves, as read back.
 *
 * Every field is present in the DTO — an absent field would make a reader
 * decide whether "missing" meant "unset" or "not returned", and there is no
 * useful difference. `null` means unset; `distanceUnit` cannot be unset because
 * the storage layer defaults it, so a reader never has to pick a fallback.
 */
export const UserPreferences = z.object({
  /**
   * The name this person chose, distinct from `users.name`, which the sign-in
   * callback overwrites from the OAuth provider on EVERY sign-in
   * (`upsertUser`'s `onConflictDoUpdate`). One column cannot be both, so a
   * name typed into account settings would be silently clobbered the next time
   * they signed in with Google. `null` falls back to the provider's name, then
   * email, then a derived handle — see `displayNameFor`.
   */
  displayName: z.string().min(1).max(80).nullable(),
  /**
   * A three-letter IATA code, uppercase, or `null`.
   *
   * Validated but NOT resolved: no airport dataset ships with the app, and the
   * timezone this would eventually feed (SPEC §12's home-time-on-hover) is
   * explicitly out of M17's gate — the app has no timezone infrastructure at
   * all, and building one is its own decision. A regex is what can be promised
   * honestly today and stays forward-compatible with a real lookup later.
   *
   * **Uppercase is validated here, never coerced here.** This package contains
   * no transforms by convention — its schemas validate and nothing more — so
   * trimming and upcasing a typed "sfo" belongs to the route that accepts it,
   * before it reaches this schema. That keeps normalization server-side rather
   * than trusting a client to have done it.
   */
  homeAirport: z
    .string()
    .regex(/^[A-Z]{3}$/, "Use a three-letter airport code, like SFO.")
    .nullable(),
  distanceUnit: DistanceUnit,
});
export type UserPreferences = z.infer<typeof UserPreferences>;

/**
 * A partial update. Absent means "leave it alone"; an explicit `null` means
 * "clear it" — which is why the fields are nullable rather than optional in
 * `UserPreferences` above, and why this cannot simply be a `Partial<>` of a
 * schema whose fields were optional. The two states are different operations
 * and a reader must be able to tell them apart.
 *
 * `distanceUnit` has no `null` because it has no unset state.
 *
 * The empty patch is REFUSED rather than treated as a no-op write. A `PATCH`
 * carrying nothing is far more likely to be a client bug — a field name that
 * silently failed to match — than a deliberate request to change nothing, and
 * answering 200 to it would hide that. Same reasoning as the closed enums
 * elsewhere in this package: make the meaningless case fail loudly at the
 * boundary rather than succeed quietly behind it.
 */
export const UpdateUserPreferences = UserPreferences.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: "Provide at least one preference to update." },
);
export type UpdateUserPreferences = z.infer<typeof UpdateUserPreferences>;
