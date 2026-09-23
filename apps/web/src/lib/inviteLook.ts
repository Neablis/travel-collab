/**
 * *Have a look first* (M27 D12): which trip reads carry an invite token.
 *
 * The look screen mounts the ordinary board — `TripProvider`, the lenses, the
 * notebook — and those read through plain helper functions in `apiClient.ts`
 * and `pagesClient.ts`, not through anything a React context can reach. So the
 * token is registered here, **keyed by trip id**, for as long as the look
 * screen is mounted, and the READ helpers for that trip attach it as a header.
 *
 * Three properties keep this from being a global credential:
 *
 *   - **Per trip.** A read for any other trip finds nothing and sends nothing,
 *     so the token cannot leak onto a request it was not minted for (and the
 *     server would refuse it there anyway — `isPendingInviteFor`).
 *   - **Per mount.** `beginInviteLook` hands back its own undo, and the screen
 *     runs it on unmount, so leaving the look screen ends the look.
 *   - **Reads only.** Only the GET helpers ask; no write helper does, and no
 *     write route on the server accepts the header (`requireTripAccess`'s
 *     `inviteToken` is passed by the eight read routes and nothing else).
 *
 * Plain data and no imports: `server/access/trip-access.ts` reads the header
 * NAME from here, so both sides spell it once.
 */

export const INVITE_TOKEN_HEADER = "x-invite-token";

const looks = new Map<string, string>();

/** Start sending `token` with this trip's reads. Returns the undo. */
export function beginInviteLook(tripId: string, token: string): () => void {
  looks.set(tripId, token);
  return () => {
    // Only our own entry: a second look screen for the same trip (StrictMode's
    // double mount, or a fast re-navigation) may already have replaced it.
    if (looks.get(tripId) === token) looks.delete(tripId);
  };
}

/** The header a read of `tripId` should carry, if a look is open on it. */
export function inviteLookHeaders(tripId: string): Record<string, string> {
  const token = looks.get(tripId);
  return token === undefined ? {} : { [INVITE_TOKEN_HEADER]: token };
}

/**
 * Is a look open on `tripId`? The board reads this at render to treat the look
 * the way it treats the demo: no assistant (Ask answers 401 to a signed-out
 * visitor, so a launcher has no outcome but an error) and a header pinned to
 * the top (the front door's header above it does not stick). Safe to read at
 * render because `InviteLookScope` registers before it renders its children.
 */
export function isInviteLook(tripId: string): boolean {
  return looks.has(tripId);
}
