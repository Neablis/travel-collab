# ADR-082: Motion has one home: tokens, view transitions, a welcome cookie, and reduced motion in e2e

**Status:** **Accepted — 2026-10-26.** Mitchell answered M54's decisions 17–21 as recommended.
**Deciders:** Mitchell (product); Claude — drafted
Related: M54 (`docs/milestones/M54-the-motion-pass.md`), the design
(`docs/specs/2026-10-25-motion-pass-design.md`), ADR-078 (the landing is static and home lives at
`/home`).

## Context

Motion today is about eight one-off keyframes in `apps/web/src/app/globals.css`, each with literal
durations and its own reduced-motion block. No overlay animates its exit. Navigation freezes the
old page until the server HTML arrives. The motion pass adds motion to every surface, so it needs
one place for timing, one way to cross routes, a way for the first page after sign-in to know it
follows a sign-in, and a test suite that stays fast and deterministic.

The installed versions decide what is possible: Next 16.4.2, React 19.3.1, Tailwind 4.3.3 and
Playwright 1.64.1. React exports `ViewTransition` as stable. Next runs view transitions in the
App Router with no config flag.

## Decision

1. **Timing lives in `@theme` tokens.** Durations are `--transition-duration-*` and easings are
   `--ease-*`, the names Tailwind 4 turns into `duration-*` and `ease-*` utilities. Named
   animations are `--animate-*`. No new rule uses a literal duration. The colour wall's ban on
   bracket values still applies. Every animation has a `prefers-reduced-motion: reduce` path that
   keeps the end state without movement.
2. **Exits are CSS animations, not transitions.** Radix Presence delays an unmount only for an
   `animationend`. Non-Radix surfaces (the toast) use one small hook that delays the unmount and
   makes the exiting node `inert` at once. Under reduced motion, overlays have `animation: none`,
   and so unmount immediately.
3. **Routes cross-fade through React's `<ViewTransition>`**, around the page body in `AppShell` and
   the front-door slot in the root layout. The app header and the phone tab bar carry their own
   `view-transition-name`, so they hold still. Where the View Transitions API is missing, a
   `template.tsx` fades the new page in with CSS, gated on
   `@supports not (view-transition-name: none)`. The page-wide `RouteViewTransition` runs only on
   a path change.
4. **The first page after sign-in learns it from a cookie.** `recordSignIn`
   (`apps/web/src/server/users.ts`) sets a short-lived `tc_welcome` cookie, with the value `signin`
   or `signup` according to the `returning` value it already computes. The app shell reads it once
   and clears it. Auth.js runs JWT sessions with no adapter, so its `isNewUser` is not available. A
   query parameter was rejected because a refresh or a shared link would replay the moment.
   The cookie shows a full-screen welcome splash on every viewport, after both signup and
   sign-in (M54 decision 4 as amended). **Decided by Mitchell, 2026-10-26 (built in PR 607):**
   the splash says "Welcome, {name}" when the name is known by the time the text appears (the
   name wait is about 450 ms, counted from when the splash goes up), and "Welcome!" otherwise;
   he approved the wording "Welcome!". The words are fixed once shown and never swap
   mid-splash, and the screen-reader announcement uses the same words. Every splash, named or
   not, lasts about 1.6 s from when it appears. It blocks taps while it is up, and the 3 s
   fail-safe stays and releases it. A plain reload or navigation never shows the splash, and an
   e2e test guards that. **Accepted by Mitchell, 2026-10-26:** when the page hydrates so late
   that the 3 s fail-safe fires, the visual welcome is skipped and only the screen reader
   speaks, with the same words ("Welcome, {name}", or "Welcome!" when the name is not known).
5. **A PWA cold launch paints its overlay before first paint**, from an inline `<head>` script
   that runs only in standalone display mode, the pattern of `LEAVE_LANDING_IF_SIGNED_IN`. The
   overlay is server HTML, never hidden-then-shown. It leaves on hydration.
6. **e2e runs with reduced motion** (`use.reducedMotion: "reduce"` in `playwright.config.ts`). A
   test therefore never sees an exit in flight, and specs that measure an overlay right after it
   opens are unaffected. **One spec opts back in** to prove that an exiting overlay is inert and
   that focus moves at once.

## Consequences

- No test waits on an animation, and the suite's timing does not change.
- The motion users see is not what e2e drives. The motion-on spec and Mitchell's preview walk
  cover that gap. A regression in a non-reduced animation's own CSS is caught by eye, not by CI.
- A browser without view transitions gets a fade-in, not a cross-fade.
- Exactly one cookie is added, read on the first app page after sign-in. It is not a session or
  tracking cookie.
