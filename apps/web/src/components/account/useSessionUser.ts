"use client";

import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";

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
 */
export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((session) => {
      if (!cancelled) setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
