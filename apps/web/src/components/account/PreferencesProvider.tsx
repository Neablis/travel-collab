"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DistanceUnit, UpdateUserPreferences, UserPreferences } from "@tc/contracts";
import { fetchPreferences, updatePreferences, type ApiResult } from "@/lib/apiClient";

/**
 * Account preferences, resolved once per authenticated shell and shared by
 * everything that reads them (M17).
 *
 * **Not the session token.** Sessions are JWT-only (ADR-025, `authConfig.ts`'s
 * `jwt`/`session` callbacks), and a JWT is only rewritten on sign-in — so a
 * preference carried in the token would go stale the moment somebody changed
 * it and stay stale until they next signed in. That is the wrong shape for a
 * setting whose whole point is that it takes effect now.
 *
 * **Fetched here rather than passed down from a server component.** ADR-019's
 * rule for a server-only value is "props from a server component, never a
 * client component importing `src/server`" — but the lint wall (block 1 of
 * `eslint.config.mjs`) exempts only `src/server/**`, `src/app/api/**` and the
 * `.well-known` route from the `@/server/*` ban, so a page or layout file
 * cannot read the row either; `scripts/check-lint-wall.mjs` fixtures exactly
 * that import from `src/app` and asserts it is rejected. The wall's own
 * instruction for this case is the other half of the same rule — "UI must call
 * the API, not server internals" — which is what this does, through the typed
 * client, the same way `TripProvider` reaches trip state. The invariant the
 * ADR is protecting (no client component importing server code) holds either
 * way; only the transport differs. See the M17 report.
 *
 * Mounted in `(app)/layout.tsx` so the header's account menu and the trip
 * page's map are inside ONE provider: the Sheet writes and the map rail's
 * labels re-render from the same state, with no reload and no second fetch.
 * Same reasoning as `SaveLightProvider` sitting above both the header and the
 * trip it reads from.
 */

/**
 * What a signed-out shell, an in-flight first fetch, or a failed read shows.
 *
 * These are the STORAGE defaults restated for the client, and they have to
 * agree with `PREFERENCE_DEFAULTS` in `server/users.ts` and with the column's
 * own `DEFAULT 'km'` (migration 0015). Three copies is one more than anyone
 * wants; the alternative is a client module importing `@/server/*`, which the
 * lint wall forbids, or a default in `packages/contracts`, which would be a
 * storage decision living in a package that deliberately holds none.
 */
const DEFAULTS: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "km" };

type PreferencesValue = {
  preferences: UserPreferences;
  /** False until the first read has come back — the Sheet must not show `null` as "cleared". */
  loaded: boolean;
  /** PATCH, and adopt the server's answer. Resolves; never rejects (apiClient's invariant). */
  save: (patch: UpdateUserPreferences) => Promise<ApiResult<UserPreferences>>;
};

const Context = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPreferences().then((result) => {
      if (cancelled) return;
      // A failure leaves the defaults in place and still marks the read done.
      // Everything downstream is display: a distance rendered in kilometres
      // because the preference could not be read is a smaller wrong than a map
      // rail that never shows a total.
      if (result.ok) setPreferences(result.value);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (patch: UpdateUserPreferences) => {
    const result = await updatePreferences(patch);
    // The SERVER's answer, not the patch: `homeAirport` is normalized there
    // (trim + uppercase), so adopting what was sent would leave "sfo" on screen
    // until the next reload and make the client look like it had disagreed.
    if (result.ok) setPreferences(result.value);
    return result;
  }, []);

  const value = useMemo(() => ({ preferences, loaded, save }), [preferences, loaded, save]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * For the surface that EDITS preferences. Throws outside a provider, the same
 * contract `useTrip` has: a settings form with nowhere to write is a bug, not a
 * degraded state.
 */
export function useAccountPreferences(): PreferencesValue {
  const value = useContext(Context);
  if (!value) throw new Error("useAccountPreferences outside PreferencesProvider");
  return value;
}

/**
 * For the surfaces that only READ a preference to render something.
 *
 * Tolerates a missing provider and answers the defaults, which is deliberate
 * and is the opposite choice from `useAccountPreferences` above. `MapRail`,
 * `MapFocusCard`, `MapDayStrip` and the account menu are all rendered in unit
 * tests directly, with no shell around them, and throwing would make every one
 * of those tests carry a provider to assert something that has nothing to do
 * with preferences. The fallback is what a brand-new account holds, so the
 * worst case is a label in the wrong unit rather than a lens that will not
 * mount.
 */
export function usePreferences(): UserPreferences {
  return useContext(Context)?.preferences ?? DEFAULTS;
}

/** The common case, named for what the call sites are asking. */
export function useDistanceUnit(): DistanceUnit {
  return usePreferences().distanceUnit;
}
