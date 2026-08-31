import { AdmissionRefusal } from "@tc/contracts";

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
/**
 * **Build-side copy, awaiting design sign-off — NOT from the handoff.**
 *
 * Deliberately its own block rather than fields on `AUTH_COPY`, which is
 * verbatim handoff text that a design sync rewrites in place. Keeping these
 * separate means a sync cannot silently overwrite them, and nobody can mistake
 * them for handoff-approved strings.
 *
 * They exist because M11a put an "Invite code" field on `/signup` and the
 * handoff has no sentence explaining it — a first-time visitor would otherwise
 * meet an unexplained box with no way to know whether it is required or where
 * to get one. Drafted 2026-08-30 in the handoff's voice (second person, plain,
 * no exclamation), for Mitchell to accept or replace before merge.
 *
 * @see docs/milestones/M11a-invite-gate.md — link 6, the refusal is a designed
 * screen and so is the thing that asks for the code.
 */
export const ADMISSION_FIELD_COPY = {
  /** Sits above the field, explaining why it is there at all. */
  note: "Caesura is invite-only while it is small.",
  /** The field's own hint — says when it may be left empty. */
  hint: "Paste the code you were sent. Arriving from a trip invite link? Leave this empty.",
} as const;

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

// M11a link 6 — the invite gate's three refusals, kept in their own map and
// deliberately NOT merged into `ERROR_MESSAGES` above.
//
// Two properties come from the separation, and both are the point:
//
// 1. **Typed exhaustively.** `Record<AdmissionRefusal, string>` means adding a
//    member to the contract enum without writing copy for it fails the build,
//    instead of shipping a screen that silently renders FALLBACK. A
//    `Record<string, string>` would give that away, which is why the map above
//    (whose keys are Auth.js's, not ours to enumerate) needs its own
//    `Object.hasOwn` guard and this one does not.
// 2. **Parsed, not looked up.** `errorMessage` runs the untrusted `?error=`
//    value through `AdmissionRefusal.safeParse` before it can index this map,
//    so no arbitrary string reaches it at all.
//
// The two sets stay visually distinguishable too: ours are
// SCREAMING_SNAKE_CASE from `@tc/contracts`, Auth.js's are PascalCase.
//
// On the copy itself: Google has already said yes by the time any of these
// renders. The account is fine, it simply has no way in yet, and nothing was
// created for it. Each one names the next action and the affordance to do it
// with, because this is the front door's failure state — a dead end here is a
// person who never comes back. The "Create an account" they point at is this
// screen's own swap CTA (`AUTH_COPY.signin.swapCta`), so the instruction stays
// true as long as the screen does.
const ADMISSION_MESSAGES: Record<AdmissionRefusal, string> = {
  MISSING_INVITE_CODE:
    "Caesura is invite-only while it is small, so we need something that lets you in. Follow Create an account below and enter your invite code — or, if someone invited you to their trip, open that invite link instead and it admits you on its own.",
  INVALID_INVITE_CODE:
    "That invite code is not one of ours. Check it for a typo or a stray space and try again under Create an account — if it still will not take, ask whoever invited you for a fresh one.",
  SPENT_INVITE_CODE:
    "That invite code has already been used, and each one works only once. Ask whoever invited you for a new code — or open the trip invite link they sent you, which admits you without a code at all.",
};

const FALLBACK =
  "Something went wrong signing you in. Try again — if it keeps happening, any trip you were invited to is still safe.";

export function errorMessage(code: string | null): string | null {
  if (!code) return null;
  // Ours first, and by parsing rather than lookup. `code` is whatever the URL
  // says, so the schema — not a map's key set — is what decides whether it is
  // one of our refusals. A random string fails here and falls through to the
  // Auth.js codes and then FALLBACK; it never indexes `ADMISSION_MESSAGES`.
  const refusal = AdmissionRefusal.safeParse(code);
  if (refusal.success) return ADMISSION_MESSAGES[refusal.data];
  // Plain-object lookup: `code` is untrusted (it comes straight off the URL's
  // `?error=` query param), and `ERROR_MESSAGES[code]` on a plain object
  // literal inherits from `Object.prototype` — `code` values like
  // "__proto__", "toString" or "constructor" resolve to an inherited object
  // or function, not undefined, so `?? FALLBACK` never catches them and this
  // function's `string | null` return type would be a lie at runtime.
  // `Object.hasOwn` restricts the lookup to the map's own declared keys.
  return Object.hasOwn(ERROR_MESSAGES, code) ? (ERROR_MESSAGES[code] ?? FALLBACK) : FALLBACK;
}
