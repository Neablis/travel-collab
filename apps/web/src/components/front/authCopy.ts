export type AuthMode = "signin" | "signup";

export type AuthCopy = {
  title: string;
  sub: string;
  scopeLine: string;
  swapPrompt: string;
  swapCta: string;
  swapHref: string;
  footnote: string;
};

// Verbatim from `.design-sync/handoff/design/Trip Planner Redesign.dc.html`
// :3388-3396 (the five bound strings) and :1620-1625 (the two footnotes).
// Do not reword — the handoff README makes the design the source of truth
// for product copy.
export const AUTH_COPY: Record<AuthMode, AuthCopy> = {
  signup: {
    title: "Start planning with Caesura",
    sub: "One trip, everyone editing it. Your account takes about four seconds to make.",
    scopeLine:
      "We ask Google for your name, email and profile picture. Nothing else, and nothing is posted anywhere.",
    swapPrompt: "Already planning a trip here?",
    swapCta: "Sign in",
    swapHref: "/signin",
    footnote:
      "By continuing you agree to the terms and the privacy notice. Caesura is open source — you can read exactly what it stores.",
  },
  signin: {
    title: "Welcome back",
    sub: "Pick up where the group left off — every change since your last visit is already in the plan.",
    scopeLine: "Google is the only way in, so there is no password to lose.",
    swapPrompt: "First time on Caesura?",
    swapCta: "Create an account",
    swapHref: "/signup",
    footnote:
      "Invited to someone's trip? Sign in with the address the invite went to and it'll be waiting.",
  },
};

// Auth.js redirects here with `?error=<code>` because server/auth.ts sets
// `pages.error` to this route. These strings are ours: the design shows the
// happy path only, and M15 scope item 5 makes the failure states part of the
// gate. Every branch says what happened and what to do — no raw code reaches
// the screen, and there is no blank state.
// Shared with the client-side "Google isn't configured" state (AuthScreen's
// `googleAvailable` prop): that state is detected server-side, before any
// `?error=` param can exist (see server/auth.ts's provider registration and
// AuthScreen.tsx's `googleAvailable` prop), but it is the same underlying
// misconfiguration Auth.js's own `Configuration` error describes. One
// string, referenced from both places, so they can't drift apart.
export const GOOGLE_UNAVAILABLE_MESSAGE =
  "Sign-in isn't set up on this deployment. That's our problem, not yours — nothing you do on this screen will fix it.";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "Google didn't hand us an account. If you closed the Google window or declined the permission, try again — we only ask for your name, email and picture.",
  Configuration: GOOGLE_UNAVAILABLE_MESSAGE,
  Verification: "That sign-in link has already been used or has expired. Start again below.",
  OAuthAccountNotLinked:
    "That email is already here under a different sign-in method. Use the one you signed up with.",
};

const FALLBACK =
  "Something went wrong signing you in. Try again — if it keeps happening, any trip you were invited to is still safe.";

export function errorMessage(code: string | null): string | null {
  if (!code) return null;
  // Plain-object lookup: `code` is untrusted (it comes straight off the URL's
  // `?error=` query param), and `ERROR_MESSAGES[code]` on a plain object
  // literal inherits from `Object.prototype` — `code` values like
  // "__proto__", "toString" or "constructor" resolve to an inherited object
  // or function, not undefined, so `?? FALLBACK` never catches them and this
  // function's `string | null` return type would be a lie at runtime.
  // `Object.hasOwn` restricts the lookup to the map's own declared keys.
  return Object.hasOwn(ERROR_MESSAGES, code) ? (ERROR_MESSAGES[code] ?? FALLBACK) : FALLBACK;
}
