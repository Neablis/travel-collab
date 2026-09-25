"use client";

import { useEffect, useState } from "react";

export type SessionUser = { id?: string | null; name?: string | null; email?: string | null };

/**
 * The signed-in identity, resolved client-side.
 *
 * A server component cannot hand this down: `src/components` is UI, and the
 * UI/server lint wall (AGENTS.md invariant 6, "server logic does not leak into
 * components") bars importing `@/server/*` from anywhere outside `src/server`
 * and `src/app/api`. So identity is resolved through next-auth/react's
 * `getSession` — the same NextAuth instance reached through its client-side
 * door (`/api/auth/session`, already registered by
 * `src/app/api/auth/[...nextauth]/route.ts`) rather than a second auth path.
 *
 * Extracted from `AccountMenu` when `/account` became a route (M26 link 1) and
 * needed the same fact. Two copies of an eight-line effect is how the two
 * quietly stop agreeing about what "signed out" looks like.
 *
 * `id` is carried too, since M17: the display-name seam's last resort derives a
 * handle from it (`displayNameFor`), and it is already on the session — the JWT
 * `session` callback sets `session.user.id` on every call (`authConfig.ts`).
 *
 * **Three states, not two:** `undefined` until the first read resolves, then
 * `null` for nobody signed in, or the user.
 *
 * This returned `null` for both, on the reasoning that "both cases render the
 * same thing". They do not. `AccountScreen` passes `user?.email ?? ""` to
 * `ProfileSection`, which renders **"Not provided by your sign-in"** for an
 * empty string — so a signed-in account with an address was told its provider
 * had not supplied one, for as long as the session probe took, and permanently
 * if that probe failed. A statement of fact about the reader's own account is
 * exactly the wrong thing to guess at (CodeRabbit, PR 196).
 *
 * `undefined` is chosen over a `{ user, loading }` pair because every existing
 * caller reads it optionally (`user?.email`, `user?.name`), and those keep
 * working untouched; only a caller that must distinguish "not yet" from "not
 * signed in" has to look.
 *
 * **And a FAILED read is not a signed-out reader either.** `getSession()` is
 * gone from this file for one reason: next-auth's `fetchData()` catches a
 * network error or a non-OK response and returns `null`, the very same value
 * it returns for a confirmed empty session. Reading the endpoint it reads —
 * `/api/auth/session`, the door this comment already named — is what lets the
 * two be told apart. A throw or a non-OK response leaves the state `undefined`,
 * which is honest: we do not know. Only a 200 whose body carries no user is
 * `null`. Second half of the same finding (CodeRabbit, PR 196); the first half
 * was the initial-load case above.
 */
export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // eslint-disable-next-line no-restricted-globals -- Auth.js's own session endpoint, not an app route; it answers in Auth.js's shape, not ApiResult's
        const response = await fetch("/api/auth/session", { credentials: "same-origin" });
        if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
        const session = (await response.json()) as { user?: SessionUser | null } | null;
        if (!cancelled) setUser(session?.user ?? null);
      } catch {
        // Stay `undefined`. Callers render the not-yet-known shape, which is
        // the one state that claims nothing about the reader's account.
        if (!cancelled) setUser(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
