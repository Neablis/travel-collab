/**
 * The reserved share slug the built-in demo trip is served under (ADR-031).
 *
 * `/s/featured` and `/api/shares/featured` are static segments, so Next.js
 * routes them ahead of the `[token]` siblings — and a real share token is 43
 * characters of base64url, so nothing a user creates can ever collide with it.
 *
 * In `lib/` rather than `server/` because both sides need it: the landing
 * page's CTAs link to it, `SharedTripScreen` uses it to tell the demo apart
 * from a real person's shared trip, and the route handlers serve it.
 */
export const DEMO_SHARE_SLUG = "featured";

/** The `/s/:token` path the landing page's CTAs point at. */
export const DEMO_SHARE_PATH = `/s/${DEMO_SHARE_SLUG}`;

export function isDemoShare(token: string): boolean {
  return token === DEMO_SHARE_SLUG;
}
