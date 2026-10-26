# M54 — The motion pass: press, pending, enter and exit, everywhere

**Status:** **Scoped 2026-10-26 with Mitchell; current milestone**, placed ahead of M43 on his
word. The design is `docs/specs/2026-10-25-motion-pass-design.md` (approved 2026-10-25), whose
decisions 1–16 stand as written there and are not repeated here. Decisions 17–21 below were
answered at scoping. The mechanisms are ADR-082. The plan is
`docs/plans/2026-10-26-M54-the-motion-pass.md` (deleted at gate close). The parts run as an
**unattended stack** (Mitchell, 2026-10-26): part K+1 branches from part K, and he merges them in
order.

## Why this exists

Mitchell, 2026-10-25: *"theres a lot of places in the app that the interactions with the page feel
really 'static', theres no click animation, no loading animations, no subtle hover animations. I
dont want to go overboard … but a design pass over the site to give it more subtle animations will
help a perceived performance and add more delight to the app."* The spec's §1 is the audit; its
citations were re-verified against `main` at `f5c9a16` on 2026-10-26, with three corrections:

- `TripHeader`'s facepile is `TravellerStack` at `trip/TripHeader.tsx:846-906` (its "+N" at :903),
  not :835-893.
- `AuthScreen`'s invite field is on screen **on `/signup` only** (`showAdmissionCode`, :193).
- There are **about 20 pending label swaps**, not about 11. The plan lists every one (part 2).

## Decisions

**1–16:** the spec's §2, approved by Mitchell 2026-10-25, unchanged.

**Answered by Mitchell at scoping, 2026-10-26, each as recommended:**

17. **Placement:** M54 is the current milestone, ahead of M43. The order is M54 → M43 → M44 → M53,
    with M48 parked.
18. **Route cross-fade: React's `<ViewTransition>` with a CSS fallback.** React 19.3.1 exports
    `ViewTransition` as stable, and Next 16.4.2 runs view transitions in the App Router with no
    config flag. The page body cross-fades. The app header and the phone tab bar are named out of
    the fade, so they hold still. A browser without the View Transitions API gets a short CSS
    fade-in on the new page instead (a `template.tsx`, applied only where `view-transition-name`
    is unsupported).
19. **The welcome moment's cues: a cookie and an inline script.** When sign-in completes,
    `recordSignIn` (`server/users.ts:403`, which already writes cookies and already knows
    `returning`) sets a short-lived `tc_welcome=signin|signup` cookie. The first app page reads it
    once and clears it. On a PWA cold launch, an inline `<head>` script paints the overlay before
    first paint (the pattern of `LEAVE_LANDING_IF_SIGNED_IN`, `app/layout.tsx:100`), and it leaves
    on hydration. Not a query parameter, since a refresh or a shared link would replay it.
20. **e2e runs with reduced motion.** `playwright.config.ts` sets `use.reducedMotion: "reduce"`,
    and under reduced motion overlays have **no exit animation**, so Radix unmounts them at once.
    The four specs that read an overlay's `boundingBox()` right after it opens
    (`m8-make-it-real:234,253`, `m39-installable:255`, `m29-time-river:104`,
    `m26-phone-surfaces:159`) and every `toBeHidden` closure keep passing unchanged. **One spec
    runs with motion on**, to prove an exiting overlay neither traps focus nor intercepts a click.
21. **The split is eight parts** (the spec's seven, with the label swaps as their own part 2).
    Mitchell sees the friendlier signup wording in part 5's PR body before he merges it
    (spec decision 4).

## Exit gate

- [ ] **Decisions 17–21 are answered and recorded here**, with ADR-082.
- [ ] **Motion has one home.** Durations and easings are `@theme` tokens, and no new animation or
      transition uses a literal duration or a bracket value. Every new animation has a
      `prefers-reduced-motion: reduce` path. *(Part 1; the colour wall stays green.)*
- [ ] **A pending control keeps its box.** Every one of the ~20 label swaps uses `Button`'s
      `pending` state, sets `aria-busy`, cannot be submitted twice, and keeps its accessible
      "…ing…" name. An e2e test measures a pending button's bounding box before and during pending,
      and was seen red with the width held off. *(Parts 1–2.)*
- [ ] **Overlays enter and exit without holding the app up.** Dialog, Sheet (an actual slide),
      Popover, Menu, Toast and the command palette animate in and out. The motion-on spec proves
      that an exiting overlay is inert and that focus moves at once, and was seen red with the exit
      left interactive. *(Part 1.)*
- [ ] **Every tab style slides its indicator**, and it sits under the active tab after a switch and
      after a resize (a test, seen red). Lenses cross-fade on the trip page. *(Part 3.)*
- [ ] **No page freezes on navigation.** `/home`, `/plans`, `/account` and the front-door routes have
      a skeleton, except `/signin` and `/signup`: there a skeleton raced hydration and wiped a typed
      username (m15, 2 of 8 runs), so a click to them holds instead (Mitchell, 2026-10-26). Routes
      cross-fade (decision 18). Covers fade in when they load after the page does (in-app
      navigation, or a lazy cover scrolled to); a cover already in the server's HTML and loaded
      by hydration shows at once, so a direct load of a page shows no fade by design. *(Part 4.)*
- [ ] **Sign-in has its cheer.** Continue with Google and dev login cannot be double-submitted, the
      invite code sits behind *Have an invite code?*, and the welcome moment plays after every
      sign-in (full-screen on a phone, small and non-blocking on desktop, "Welcome, {name}" after
      signup only) and on every PWA cold launch, with iOS startup images. A test proves the small
      moment never blocks input. *(Part 5.)*
- [ ] **One avatar stack** replaces the five facepiles, with a "+N" cap and a name per face on hover.
      *(Part 6.)*
- [ ] **Chat and Ask move.** Messages rise in, your own lands faded until saved, the list glides to
      the bottom, and Ask shows the dots with a per-step status line. *(Part 7.)*
- [ ] **The small moments:** trip cards lift and a deleted card leaves (and returns on a failed
      delete), the rack and its caret animate, river blocks settle, SaveLight has its "saved" beat,
      wizard steps and landing cells cross-fade. *(Part 8.)*
- [ ] **The touched e2e specs pass on CI** for every part, with no new waits on an animation.
- [ ] **[walk]** On the parts' previews, Mitchell finds it calm and quick, not noisy: the welcome
      moment on a phone and desktop, a dialog, a tab switch, an Ask turn, and reduced motion
      turned on.
- [ ] A retro is appended at gate close.
