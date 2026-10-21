import { HOME_PATH } from "@/lib/homePath";

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

// ADR-078: `/` is a static page, so it cannot read the session — and the
// Auth.js cookie is HttpOnly, so a script on it cannot either. This second
// cookie exists to be read by `LEAVE_LANDING_IF_SIGNED_IN`, and says only "this
// browser had a session the last time an app page knew its user". The app
// shell sets it (`setSignedInHint`, from `SessionUserProvider`); the proxy
// only deletes it. **It authorises nothing.** A stale or forged one costs a
// visit to `/home`, where the proxy finds no session, sends the visitor to sign
// in and clears it — so the worst it can do is one extra hop, never a loop and
// never a page.
/** The non-HttpOnly cookie that tells the static landing a signed-in browser is reading it. */
export const SIGNED_IN_HINT_COOKIE = "tc_signed_in";

// Auth.js's default session life: `authConfig` sets no `session.maxAge`, so
// the JWT lasts 30 days from its last refresh. The shell re-sets the hint on
// every app page a signed-in person opens, so the two age out together.
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Deletes the hint from the browser. Called before every sign-out and by Home
 * when its session has lapsed, so the landing does not send the visitor
 * straight back.
 */
export function clearSignedInHint(doc: Pick<Document, "cookie"> = document): void {
  hintCleared = true;
  doc.cookie = `${SIGNED_IN_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// Set by `clearSignedInHint`, read by `setSignedInHint`: once this document has
// started signing out, nothing in it may put the hint back. Every sign-out
// clears the hint, then POSTs, then navigates away, and a render in that window
// that re-set it would send the signed-out visitor from the landing to `/home`
// and on to sign in. The shell's setter is keyed on the user id, which does not
// change in that window, so this is the second lock, not the only one; and with
// the proxy no longer setting the hint, no response can put it back either.
// Module state, so a full load — which is how every sign-out ends — resets it.
let hintCleared = false;

/**
 * Sets the hint from the browser: readable by script, sent on same-site
 * navigations, `Path=/` like the proxy's delete, Secure on https. The only
 * setter (ADR-078) — the `(app)` shell and the library's live copy call it once
 * a session user is known (`SessionUserProvider`), so the hint arrives after
 * hydration rather than on the first response. A no-op after
 * `clearSignedInHint` in the same document.
 */
export function setSignedInHint(
  doc: Pick<Document, "cookie"> = document,
  secure: boolean = location.protocol === "https:",
): void {
  if (hintCleared) return;
  doc.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

const HINT_IN_COOKIE_HEADER = new RegExp(`(?:^|;\\s*)${SIGNED_IN_HINT_COOKIE}=`);

/** Whether a `document.cookie` string carries the hint. */
export function hasSignedInHint(cookie: string): boolean {
  return HINT_IN_COOKIE_HEADER.test(cookie);
}

/**
 * An inline `<head>` script (root layout): on `/`, with the hint present,
 * replaces the landing with `/home` before the page paints. `replace`, so Back
 * from Home does not return to a page that would only leave again.
 *
 * In the root layout rather than the landing page itself because React never
 * runs a `<script>` it renders on the client: a client navigation to `/`
 * would get a dead tag and, in development, a console error. The layout's
 * head is sent once per full load and never re-rendered, which is the only
 * case the script can act in anyway. The CSP already admits inline scripts
 * (next.config.ts).
 *
 * A client navigation to `/`, and a back-forward-cache restore of it, are the
 * landing's own effect's (`LeaveLandingIfSignedIn`). Its length no longer
 * binds: the seo 404 comparison stopped reading flight bytes in PR 514
 * (KI-2026-10-18-e, resolved), so a `pageshow` check could join it here.
 */
export const LEAVE_LANDING_IF_SIGNED_IN = `if(location.pathname==="/"&&/(?:^|;\\s*)${SIGNED_IN_HINT_COOKIE}=/.test(document.cookie))location.replace(${JSON.stringify(HOME_PATH)});`;
