"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DistanceUnit, PersonColor, TimeFormat, UpdateUserPreferences, UserPreferences } from "@tc/contracts";
import { fetchPreferences, updatePreferences, type AccountPreferencesRead, type ApiResult } from "@/lib/apiClient";

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
 * **Served by the `(app)` layout, fetched here otherwise.** That layout reads
 * the answer `GET /api/account/preferences` gives (`server/accountPreferences.ts`)
 * beside the plan, under its lint-wall exemption, and hands it over as
 * `initialRead`; given one, there is no mount fetch. That fetch was the trip
 * page's first API request after the document. Without one — the layout's read
 * failed, or the mount point serves nothing (the operator console's layout) —
 * the provider fetches through the typed client, as it did since M17. Either
 * way no client component imports `src/server` (ADR-019); only the transport
 * differs.
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
 * agree with `PREFERENCE_DEFAULTS` in `server/users.ts` and with the columns'
 * own `DEFAULT 'km'` (migration 0015) and `DEFAULT '12h'` (migration 0031).
 * Three copies is one more than anyone wants; the alternative is a client
 * module importing `@/server/*`, which the lint wall forbids, or a default in
 * `packages/contracts`, which would be a storage decision living in a package
 * that deliberately holds none.
 */
const DEFAULTS: UserPreferences = {
  displayName: null,
  homeAirport: null,
  distanceUnit: "km",
  timeFormat: "12h",
  avatar: null,
  color: null,
  publicDisplayName: false,
};

type PreferencesValue = {
  preferences: UserPreferences;
  /** False until the first read has come back — the Sheet must not show `null` as "cleared". */
  loaded: boolean;
  /** PATCH, and adopt the server's answer. Resolves; never rejects (apiClient's invariant). */
  save: (patch: UpdateUserPreferences) => Promise<ApiResult<UserPreferences>>;
  /**
   * Whether the account is an operator — NOT a preference, and never written by
   * `save`. It rides in the same response, so it is taken from the same read
   * rather than asked for again (KI-2026-09-14-f). `false` until that read
   * lands and after one that failed; see `useIsAdmin`.
   */
  isAdmin: boolean;
  /**
   * The colour a trip gives this person while `preferences.color` is `null`
   * (`PreferencesResponse.defaultColor`). Not a preference either, and from the
   * same read; `null` until it lands, after one that failed, and from a server
   * older than the field. See `useShownColor`.
   */
  defaultColor: PersonColor | null;
};

const Context = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({
  children,
  noSessionCookie = false,
  initialRead,
}: {
  children: React.ReactNode;
  /**
   * The read the server already made for this page, in place of the mount
   * fetch. Taken once, as initial state: a later render's value is not
   * adopted, because a `save` that has landed since is newer than it.
   */
  initialRead?: AccountPreferencesRead;
  /**
   * The layout saw no session cookie (`lib/sessionHint.ts`): a reader with no
   * account, whose read could only 401 (ADR-061's public playbooks). Defaults,
   * marked loaded, and no request.
   */
  noSessionCookie?: boolean;
}) {
  const [preferences, setPreferences] = useState<UserPreferences>(initialRead?.preferences ?? DEFAULTS);
  const [isAdmin, setIsAdmin] = useState(initialRead?.isAdmin ?? false);
  const [defaultColor, setDefaultColor] = useState<PersonColor | null>(initialRead?.defaultColor ?? null);
  const [loaded, setLoaded] = useState(noSessionCookie || initialRead !== undefined);
  // Settled at mount, like the state above. Re-derived per render, a read that
  // arrives later (a `router.refresh()` while the provider's own fetch is in
  // flight) would flip it, cancel that fetch, and leave the defaults in place.
  const [served] = useState(initialRead !== undefined);

  useEffect(() => {
    if (noSessionCookie || served) return;
    let cancelled = false;
    void fetchPreferences().then((result) => {
      if (cancelled) return;
      // A failure leaves the defaults in place and still marks the read done.
      // Everything downstream is display: a distance rendered in kilometres
      // because the preference could not be read is a smaller wrong than a map
      // rail that never shows a total. `isAdmin` stays `false` on failure for
      // the reason `useIsAdmin` gives.
      if (result.ok) {
        setPreferences(result.value.preferences);
        setIsAdmin(result.value.isAdmin);
        setDefaultColor(result.value.defaultColor);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [noSessionCookie, served]);

  // Monotonic, and the only reason it exists is the race below. A ref rather
  // than state: it must be read and written synchronously within one `save`
  // call, and a re-render is exactly what it must NOT cause.
  const lastAdopted = useRef(0);
  const issued = useRef(0);

  const save = useCallback(async (patch: UpdateUserPreferences) => {
    const seq = ++issued.current;
    const result = await updatePreferences(patch);

    // **Adopt only if no newer save has already landed.** Two saves can be in
    // flight at once — the Sheet commits a name on blur while the same click
    // flips the distance unit — and every response carries the WHOLE
    // preferences object, not a patch. So an older response arriving second
    // would reinstate the values it was built from and silently undo the newer
    // save, on screen and in the map labels, until the next reload. Ordering by
    // arrival is the bug; ordering by issue is the fix. Found by review on
    // pull request 112.
    //
    // The request itself is never cancelled: it is a legitimate write and the
    // server has already applied it. What is discarded is only its stale view
    // of the world.
    if (result.ok && seq > lastAdopted.current) {
      lastAdopted.current = seq;
      // The SERVER's answer, not the patch: `homeAirport` is normalized there
      // (trim + uppercase), so adopting what was sent would leave "sfo" on
      // screen until the next reload and make the client look like it had
      // disagreed.
      setPreferences(result.value);
    }
    return result;
  }, []);

  const value = useMemo(
    () => ({ preferences, loaded, save, isAdmin, defaultColor }),
    [preferences, loaded, save, isAdmin, defaultColor],
  );
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

/**
 * Whether to offer the operator console (M20 link 7). Advisory, and it decides
 * one link: the console's layout, its page and every admin endpoint answer 404
 * to a non-admin whatever this returns.
 *
 * `false` outside a provider, before the read lands, and after one that failed
 * — a menu item that fails to appear costs an operator one typed URL, and one
 * that appears wrongly is a 404 nobody expected.
 */
export function useIsAdmin(): boolean {
  return useContext(Context)?.isAdmin ?? false;
}

/**
 * The colour this person's own chip draws on Account and in the header: the
 * one they chose, or the one a trip derives for them (M38). Never a guess on
 * the client — the derivation is the domain's, and the server sends it. `null`
 * (the chip's slate) only while neither is known.
 */
export function useShownColor(): PersonColor | null {
  const value = useContext(Context);
  return value?.preferences.color ?? value?.defaultColor ?? null;
}

/**
 * The trips whose publish-as-a-Playbook offer this person dismissed (M50
 * decision 7), and how to dismiss one more. Stored on the account, so a
 * dismissal on the phone holds on the laptop.
 *
 * `null` outside a provider and until the first read lands: without the list
 * the offer cannot know whether it was already dismissed, and showing it again
 * to someone who said no is the worse mistake.
 */
export function usePublishOfferDismissals(): {
  dismissed: readonly string[];
  dismiss: (tripId: string) => void;
} | null {
  const value = useContext(Context);
  const dismissed = value?.preferences.dismissedPublishOffers;
  const save = value?.save;
  const dismiss = useCallback(
    (tripId: string) => {
      // The whole list, as the contract asks: the read this was built from is
      // at most one save old, since every save adopts the server's answer.
      if (save !== undefined) void save({ dismissedPublishOffers: [...(dismissed ?? []), tripId] });
    },
    [save, dismissed],
  );
  if (value === null || !value.loaded) return null;
  return { dismissed: dismissed ?? [], dismiss };
}

/** The common case, named for what the call sites are asking. */
export function useDistanceUnit(): DistanceUnit {
  return usePreferences().distanceUnit;
}

/**
 * The clock this person reads times in, for `toClockLabel` / `toClockRange`.
 * `"12h"` outside a provider, which is what a signed-out reader of a shared
 * trip or day should see anyway: the design's clock, and every account's
 * default.
 */
export function useTimeFormat(): TimeFormat {
  return usePreferences().timeFormat;
}
