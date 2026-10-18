import { PreferencesResponse } from "@tc/contracts";
import { readPreferences } from "@/server/users";
import { defaultColorFor } from "@/server/access/personaColors";
import { callerIsAdmin } from "@/server/entitlements/admin";

// One function for both readers of this answer: `GET /api/account/preferences`
// and `(app)/layout.tsx`, which serves it with the page so `PreferencesProvider`
// does not ask for it after hydration. Two copies of the composition would be
// two shapes the moment one of them gained a field; `apiClient`'s
// `AccountPreferencesRead` is the shape both must match.
/**
 * The signed-in account's preferences, its derived default colour and whether
 * it is an operator, exactly as `GET /api/account/preferences` answers them.
 * Never throws for a missing row: `readPreferences` answers the storage
 * defaults for a session whose row has gone (ADR-025).
 */
export async function readAccountPreferences(
  userId: string,
): Promise<PreferencesResponse & { isAdmin: boolean }> {
  // `isAdmin` rides alongside the preferences, not inside them; the route's
  // GET says why.
  const [preferences, isAdmin] = await Promise.all([readPreferences(userId), callerIsAdmin(userId)]);
  return { ...PreferencesResponse.parse({ preferences, defaultColor: defaultColorFor(userId) }), isAdmin };
}
