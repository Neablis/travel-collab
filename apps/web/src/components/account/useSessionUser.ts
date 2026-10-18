"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { setSignedInHint } from "@/lib/sessionHint";

export type SessionUser = { id?: string | null; name?: string | null; email?: string | null };

/**
 * The signed-in identity, resolved client-side unless the layout already has
 * it.
 *
 * This module cannot read the session itself: `src/components` is UI, and the
 * UI/server lint wall (AGENTS.md invariant 6, "server logic does not leak into
 * components") bars importing `@/server/*` from anywhere outside `src/server`
 * and `src/app/api`. A server layout that has already called `auth()` passes
 * the user down as `initialUser` on the provider below, as data rather than an
 * import, and then nothing is fetched. Without it, identity is resolved through
 * next-auth/react's `getSession` — the same NextAuth instance reached through
 * its client-side door (`/api/auth/session`, already registered by
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
 * **Read from `SessionUserProvider` when one is mounted** (ADR-061), so a page
 * under `(app)` asks once however many components want the answer; with no
 * provider above it, this resolves the session itself. Same three states
 * either way.
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
export function useSessionUser(): SessionUser | null | undefined {
  const shared = useContext(SessionUserContext);
  // Both hooks run on every render whichever answer is used — the rules of
  // hooks — but the fetch inside is skipped when a provider already holds it.
  const own = useResolvedSession(shared === NO_PROVIDER);
  return shared === NO_PROVIDER ? own : shared;
}

/**
 * The provider's answer, and `undefined` with no provider above: never a read
 * of its own. For a hook mounted on every assistant surface (the ask storage's
 * owner, `useOwnedAskName`), where a fetch per mount would be a request each
 * of their tests has to answer, and every route that mounts one is under
 * `(app)/layout.tsx` already.
 */
export function useKnownSessionUser(): SessionUser | null | undefined {
  const shared = useContext(SessionUserContext);
  return shared === NO_PROVIDER ? undefined : shared;
}

/**
 * One session read for everything under `(app)/layout.tsx` (ADR-061).
 *
 * Before this, every component that asked `useSessionUser()` fetched
 * `/api/auth/session` on its own: the header did, and the playbook screens'
 * signed-out branches would have made it three reads of one fact per page, each
 * free to land at a different moment — a header already offering *Sign in*
 * beside a day still showing *Report*. One provider makes them agree, and makes
 * the answer survive client navigation instead of being asked again per page.
 *
 * Optional, not required. `useSessionUser()` outside a provider resolves the
 * session itself, exactly as it always has, so a component rendered bare in its
 * own test, or on a route outside `(app)` (`/demo`, the front door), still works.
 */
export function SessionUserProvider({
  children,
  noSessionCookie = false,
  initialUser,
}: {
  children: ReactNode;
  /**
   * The server saw no session cookie (`lib/sessionHint.ts`), so nobody is
   * signed in: start at `null` — the first paint is already the signed-out one —
   * and do not ask. Without it, the state starts `undefined` and is fetched.
   */
  noSessionCookie?: boolean;
  /**
   * The session the server already resolved for this request, handed down so
   * the client does not ask `/api/auth/session` the same question again on
   * every full load. The user, or `null` for a cookie with no live session
   * behind it: either is an answer, and nothing is fetched. `undefined` — the
   * server could not tell (its read threw) or did not look — falls back to
   * the client's own read, exactly as before.
   *
   * Passed by `(app)/layout.tsx`, which may read `@/server/auth`; this file is
   * UI and may not, which is why it is a prop and not a call.
   */
  initialUser?: SessionUser | null;
}) {
  const known = noSessionCookie ? null : initialUser;
  const user = useResolvedSession(known === undefined, known);
  // ADR-078: the landing's signed-in hint, set from every app page however it
  // was reached — `/home`, `/trips/*`, `/plans`, `/account` and the library's
  // live copy all render this provider with the served user. **The only
  // setter**: the proxy only deletes the hint on a signed-out request, so it
  // appears after hydration, not on the first response. `/invite/*` has no
  // shell and does not set it; an invite hands off to a trip page, which does.
  //
  // Here, in the one place under `(app)` that already holds the answer.
  //
  // **Keyed on the id, not the user.** Sign-out clears the hint, then POSTs,
  // then navigates away, and the id does not change in that window, so this
  // cannot run in it; `setSignedInHint` also refuses once the document has
  // cleared the hint, should anything remount.
  const id = user?.id;
  useEffect(() => {
    if (id) setSignedInHint();
  }, [id]);
  return createElement(SessionUserContext.Provider, { value: user }, children);
}

/**
 * "No provider here", told apart from the provider's own `undefined` (not known
 * yet). A context default of `undefined` would make a mounted-but-unresolved
 * provider look absent, and every reader would start a fetch of its own.
 */
const NO_PROVIDER = Symbol("no SessionUserProvider");

const SessionUserContext = createContext<SessionUser | null | undefined | typeof NO_PROVIDER>(NO_PROVIDER);

function useResolvedSession(
  enabled: boolean,
  initial: SessionUser | null | undefined = undefined,
): SessionUser | null | undefined {
  const [user, setUser] = useState<SessionUser | null | undefined>(initial);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  return user;
}
