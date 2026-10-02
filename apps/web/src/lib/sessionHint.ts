// "Is there a session cookie at all?" — answered on the server before the
// first paint, so the app shell can draw the right chrome without waiting for
// `/api/auth/session` (Mitchell, 2026-10-02: *"Doesnt need to validate the
// session, but just use the existence of a jwt"*).
//
// **Only the negative is trusted.** No cookie means nobody is signed in — the
// server would answer `null` too — so the shell renders signed-out at once and
// skips the session fetch. A cookie is NOT treated as signed in: it may be
// expired or forged, so that case stays "not known yet" and the client asks,
// exactly as before. The hint can make the shell honest sooner; it can never
// show a control to somebody who has no session.
//
// The names are Auth.js v5's defaults (`@auth/core` `lib/utils/cookie.js`):
// `authjs.session-token`, `__Secure-` prefixed on https, and `.0`, `.1`… when
// a large JWT is chunked. `authConfig` sets no custom cookie name.
const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

/** Whether any of these cookie names is an Auth.js session cookie. */
export function hasSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) if (SESSION_COOKIE.test(name)) return true;
  return false;
}
