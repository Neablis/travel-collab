// The welcome moment's two cues (M54 decision 19), written down once for the
// server that sets them and the client that plays them.
//
// Plain data and string functions, importing nothing: `recordSignIn` reads it
// on the server, the shell in the browser, and `LAUNCH_SCRIPT` is a string the
// root layout inlines (a `"use client"` module could not hand a server
// component a string, only a client reference).

/** Set by `recordSignIn`, read and cleared once by the app shell's `WelcomeCue`. */
export const WELCOME_COOKIE = "tc_welcome";

/** What the sign-in that just completed was. Only "signup" adds "Welcome, {name}". */
export type WelcomeKind = "signin" | "signup";

// A minute covers the redirect back from Google and the first app page's
// load. Longer, and a sign-in that landed on a front-door page (which has no
// shell to clear it) would greet the person on some later visit instead.
export const WELCOME_COOKIE_MAX_AGE_SECONDS = 60;

const WELCOME_IN_COOKIES = new RegExp(`(?:^|;\\s*)${WELCOME_COOKIE}=(signin|signup)(?:;|$)`);

/** The cue in a `document.cookie` string, or `null` when there is none (or it is not one of ours). */
export function readWelcomeCue(cookies: string): WelcomeKind | null {
  const match = WELCOME_IN_COOKIES.exec(cookies);
  return match ? (match[1] as WelcomeKind) : null;
}

/** Spends the cue, so a refresh or the next page does not play the moment again. */
export function clearWelcomeCue(doc: Pick<Document, "cookie"> = document): void {
  doc.cookie = `${WELCOME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// Runs in `<head>`, before the body paints, so the launch overlay that is
// already in the server HTML is shown on the very first frame of a home-screen
// launch and on no other kind of load (decision 6: never hidden-then-shown).
// The standalone test is `installPrompt.ts`'s `route()`: iOS's home-screen app
// is not a display-mode match on every version, `navigator.standalone` is.
// `globals.css` shows `.launch-overlay` only under `html[data-launch]`, and
// `LaunchOverlay` takes the attribute away once the page has hydrated.
export const LAUNCH_SCRIPT = `try{if(navigator.standalone===true||matchMedia("(display-mode: standalone)").matches)document.documentElement.setAttribute("data-launch","")}catch(e){}`;
