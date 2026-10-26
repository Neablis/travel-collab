// The welcome moment's two cues (M54 decision 19), written down once for the
// server that sets them and the client that plays them.
//
// Plain data and string functions, importing nothing: `recordSignIn` reads it
// on the server, the root layout's `LaunchOverlay` in the browser, and
// `LAUNCH_SCRIPT` is a string the root layout inlines (a `"use client"` module
// could not hand a server component a string, only a client reference).

/** Set by `recordSignIn`, read and cleared once by the root layout's `LaunchOverlay`. */
export const WELCOME_COOKIE = "tc_welcome";

/** What the sign-in that just completed was. Both are welcomed by name. */
export type WelcomeKind = "signin" | "signup";

// A minute covers the redirect back from Google and the first page's load.
// Longer, and a cue that page never spent (one served with no script) would
// greet the person on some later visit instead.
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
// launch or of the first page after a sign-in, and on no other kind of load
// (decision 6: never hidden-then-shown). After a sign-in it is the welcome
// splash, at every width, and the page is not seen until it goes (Mitchell's
// walk: a mark over a page already drawn read as unstyled content). Every
// sign-in is a full load, Google's redirect and dev login's alike.
// The standalone test is `installPrompt.ts`'s `route()`: iOS's home-screen app
// is not a display-mode match on every version, `navigator.standalone` is.
// `globals.css` shows `.launch-overlay` only under `html[data-launch]`, and
// `LaunchOverlay` takes the attribute away once the page has hydrated.
// Its value is when the splash went up, on the page's clock. `LaunchOverlay`
// times its cap from that rather than from navigation start, which after a
// Google sign-in is the OAuth callback, seconds of token exchange, awaited
// email and redirect before this page painted.
//
// A launch is once per session: in the installed app a refresh and the
// sign-out redirect are full loads too, and neither is a launch.
// `sessionStorage` lives exactly as long as the app's window does.
const LAUNCHED_KEY = "tc_launched";
export const LAUNCH_SCRIPT = `try{var w=/${WELCOME_IN_COOKIES.source}/.test(document.cookie);if((navigator.standalone===true||matchMedia("(display-mode: standalone)").matches)&&!sessionStorage.getItem("${LAUNCHED_KEY}")){sessionStorage.setItem("${LAUNCHED_KEY}","1");w=true}if(w)document.documentElement.setAttribute("data-launch",String(Math.round(performance.now())))}catch(e){}`;
