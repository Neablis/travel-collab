# M54 — The motion pass: press, pending, enter and exit, everywhere

**Status:** **Scoped 2026-10-26 with Mitchell; current milestone**, placed ahead of M43 on his
word. The design is `docs/specs/2026-10-25-motion-pass-design.md` (approved 2026-10-25), whose
decisions 1–16 stand as written there and are not repeated here, except decision 4, amended
below. Decisions 17–21 below were
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

**1–16:** the spec's §2, approved by Mitchell 2026-10-25, unchanged except as amended here.

- **Decision 4 (the welcome moment), amended by Mitchell, 2026-10-26: a splash, then the page,
  everywhere.** His walk of PR 607 found the small desktop moment read as a glitch: *"The logo on
  signup looks weird, the page has already loaded, but its in the middle of the page, over top of
  a trip, and disapears too quickly, so it almost looks like a flash of unstyled content if you
  dont know what you are seeing"*. He added: *"I think its almost A and C, full page held back
  experience just on login, that shows the animation"*. His choice, "Splash, then page": the
  page's reveal waits behind the welcome moment, a full-screen splash (the logo, and "Welcome,
  {name}" after signup and sign-in) on an opaque surface, then the page, for about 1.2–1.6 s, capped by the
  existing name-wait cap. It is the same on every viewport (phone, installed app and desktop) and
  plays after both signup and sign-in; he confirmed "signup and sign-in" and "same everywhere".
  Under reduced motion there is no animation and the hold is the same or shorter. The
  screen-reader announcement is unchanged. Declined: full-screen after signup only, a small toast
  anchored to a corner, and dropping the desktop moment. Built in part 5 (PR 607).
  **Further amended by Mitchell, 2026-10-26 (built in PR 607):** the splash says "Welcome,
  {name}" when the name is known by the time the text appears (the name wait is now about
  450 ms, counted from when the splash goes up), and "Welcome!" otherwise; he approved the
  wording "Welcome!". The words are fixed once shown and never swap mid-splash, and the
  screen-reader announcement uses the same words. Every splash, named or not, lasts about 1.6 s
  from when it appears; the 3 s fail-safe stays. The splash blocks taps while it is up, with
  the fail-safe releasing it. A plain reload or navigation never shows it, and an e2e test
  guards that. Recorded in ADR-082 §4.
- **A slow launch skips the visual welcome (Mitchell, call 3, 2026-10-26).** When the page
  hydrates so late that the 3 s fail-safe fires, the visual welcome is skipped and only the
  screen reader speaks, with the same words ("Welcome, {name}", or "Welcome!" when the name is
  not known). Recorded in ADR-082 §4.
- **The signup wording is approved (Mitchell, call 2, 2026-10-26).** He approved PR 607's signup
  wording as listed in its "Wording for Mitchell's approval" section, the `authCopy.ts` strings
  among them: the signup title "Your next trip starts here"; the sub "Bring the group, the ideas
  and the dates, and plan it all in one place together. Your account is ready in about four
  seconds."; the invite note "Add it so whoever invited you gets the credit."; the disclosure
  "Have an invite code?"; "Welcome, {name}" after signup and sign-in; and the `/developers` step 1 line that
  names *Have an invite code?*. No sign-in string changed.
- **Part 8's deviations from the plan (PR 606).** Wizard steps **fade in**; they do not
  cross-fade, because no two steps are ever on screen together. A moved river block settles
  **within its day only**: there is no cross-day settle, since a drop on another day mounts a new
  block with no drawn place to settle from, and the drag outline already showed where it lands.

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

CI below is the `ci.yml` run on each part's final head, all green (ci-ok, typecheck, lint, unit,
integration, scripts, e2e 1/2 and 2/2). Parts 1–8 (PRs 594, 595, 600, 601, 607, 604, 605, 606)
all reached `main` in `e9a46b0f` (Merge pull request 606, 2026-10-26), whose second parent is the
final stacked head `5ed08fda` (run 40400563433). Line numbers are at `e9a46b0f`.

- [x] **Decisions 17–21 are answered and recorded here**, with ADR-082.
      *Evidence:* decisions 17–21 above (*Answered by Mitchell at scoping, 2026-10-26*), plus the
      later amendments to decision 4 and part 8's deviations;
      `docs/architecture/ADR-082-motion-has-one-home.md` §1–6.
- [x] **Motion has one home.** Durations and easings are `@theme` tokens, and no new animation or
      transition uses a literal duration or a bracket value. Every new animation has a
      `prefers-reduced-motion: reduce` path. *(Part 1; the colour wall stays green.)*
      *Evidence:* `apps/web/src/app/globals.css:218-237` (`--transition-duration-fast|base|slow`,
      `--ease-calm`, the `--animate-*` tokens); the diff `ca6e9308..e9a46b0f` adds no
      `duration-[…]`/`ease-[…]`/`animate-[…]` class and no literal duration in `apps/web/src`;
      each new keyframe runs inside a `no-preference` block or has a `reduce` override
      (`globals.css:2827`, `:2891`, `:3021`, `:3101`, `:3186`). One literal time remains, a
      **delay**, not a duration: the launch fail-safe's `3s` at `globals.css:3073`, mirroring
      `LAUNCH_FAILSAFE_MS` (`WelcomeMoment.tsx:258`), and it applies under reduced motion on
      purpose. Colour wall green in lint on every part's CI.
- [ ] **A pending control keeps its box.** Every one of the ~20 label swaps uses `Button`'s
      `pending` state, sets `aria-busy`, cannot be submitted twice, and keeps its accessible
      "…ing…" name. An e2e test measures a pending button's bounding box before and during pending,
      and was seen red with the width held off. *(Parts 1–2.)*
      *Not ticked:* the code and the e2e are on main (`button.tsx:124-138`;
      `apps/web/e2e/m54-motion.spec.ts:174`; no `cond ? "…ing…" : label` button swap left in
      `apps/web/src`; PR 595's red-first table for the conversions), but no red is recorded for
      the **e2e** with the width held off: PR 594's red-first shows only the unit test
      (`primitives.test.tsx`, "width-keeping removed" → `expected '' to contain 'Ask'`).
- [x] **Overlays enter and exit without holding the app up.** Dialog, Sheet (an actual slide),
      Popover, Menu, Toast and the command palette animate in and out. The motion-on spec proves
      that an exiting overlay is inert and that focus moves at once, and was seen red with the exit
      left interactive. *(Part 1.)*
      *Evidence:* `data-motion` on `ui/dialog.tsx:48,69`, `ui/sheet.tsx:105` (`slide-up` /
      `slide-right`), `ui/popover.tsx:90`, `ui/menu.tsx:74`, `ui/toast.tsx:87` (`useExitPresence`);
      `apps/web/e2e/m54-motion.spec.ts:62,82,104,123` (popover, menu, keyboard menu, ⌘K: inert, no
      click, focus moved) and `:158` (reduced motion: gone at once). Seen red: PR 594's red-first,
      row "exit left interactive" (`+"holdsFocus": true, +"inert": false, +"takesClick": true`,
      3 failed). CI run 40396393631 on `5acabb6d`.
- [ ] **Every tab style slides its indicator**, and it sits under the active tab after a switch and
      after a resize (a test, seen red). Lenses cross-fade on the trip page. *(Part 3.)*
      *Not ticked:* the indicator half is met (`useIndicator` in `tab-strip.tsx`,
      `underline-tabs.tsx`, `segmented-control.tsx`, `nav/PhoneTabBar.tsx`;
      `m54-motion.spec.ts:247,263`, seen red in PR 600's red-first with `ResizeObserver` removed
      and with the wrong value passed; CI run 40398955833 on `1c89f404`). The lens is an enter-only
      fade of the incoming lens, not a cross-fade (`globals.css:2819-2825`, "the outgoing one is
      already gone"), and no decision records that deviation as part 8's wizard one is.
- [x] **No page freezes on navigation.** `/home`, `/plans`, `/account` and the front-door routes have
      a skeleton (`/demo` excepted). Part 4 restored the `/signin` and `/signup` skeletons, and m15
      then passed 49/49 and 97/97 (Mitchell kept the skeletons, call 1, 2026-10-26). Routes
      cross-fade (decision 18). Covers fade in when they load after the page does (in-app
      navigation, or a lazy cover scrolled to); a cover already in the server's HTML and loaded
      by hydration shows at once, so a direct load of a page shows no fade by design. *(Part 4.)*
      *Evidence:* `app/(app)/{home,plans,account}/loading.tsx`;
      `app/(front)/{signin,signup,invite/[token],s/[token]}/loading.tsx`, held by
      `app/(front)/loading.test.tsx:20-25`; `RouteViewTransition` in `AppShell.tsx:65-111` (header
      and tab bar named out) and `app/layout.tsx:166`, with the `template.tsx` fallbacks;
      `cover/CoverImage.tsx:245-247`. m15 49/49 and 97/97: PR 601's body, finding 4. Red-first in
      PR 601's table. CI run 40399175369 on `6348cbdb`.
- [ ] **Sign-in has its cheer.** Continue with Google and dev login cannot be double-submitted, the
      invite code sits behind *Have an invite code?*, and the welcome moment plays after every
      sign-in (a full-screen splash, then the page, on every viewport, per decision 4 as amended;
      "Welcome, {name}" after signup and sign-in) and on every PWA cold launch, with iOS startup images.
      A test proves the splash leaves within the name-wait cap and the page is usable after it.
      *(Part 5.)*
      *Not ticked:* an installed-app cold launch has not been seen on a device; everything else
      is on main. The iOS startup images **are** there: 20 `public/icons/startup-*.png` linked by
      `app/layout.tsx:40-76`, held by `layout.test.ts` (seen red in PR 607). The launch path is
      `LAUNCH_SCRIPT` plus `LaunchOverlay` (`WelcomeMoment.test.tsx:80,346`, jsdom only). The rest:
      `AuthScreen.tsx:211-251` (`inFlight`), `authCopy.ts:47`, `WelcomeMoment.test.tsx:154`
      ("leaves within the name-wait cap"), `apps/web/e2e/m54-welcome.spec.ts:78` (splash, then a
      usable page, at each width). PR 607's red-first; CI run 40399350035 on `f8d1d7b2`.
- [x] **One avatar stack** replaces the five facepiles, with a "+N" cap and a name per face on hover.
      *(Part 6.)*
      *Evidence:* `ui/avatar-stack.tsx:115` ("+N"); its five uses: `trip/TripHeader.tsx:886`,
      `home/TripCard.tsx:291`, `home/NextTripHero.tsx:299`, `pages/blocks/TripPeopleBlock.tsx:17`,
      `board/RiverBlock.tsx:595`. Seen red: PR 604's red-first (`avatar-stack.test.tsx`,
      `TripCard.test.tsx`). CI run 40399533359 on `40aa34b8`.
- [x] **Chat and Ask move.** Messages rise in, your own lands faded until saved, the list glides to
      the bottom, and Ask shows the dots with a per-step status line. *(Part 7.)*
      *Evidence:* `chat/ChatMessage.tsx:115-116` (`data-sending`, `data-rise-in`),
      `assistant/usePinToBottom.ts:64` (smooth, instant under reduced motion),
      `assistant/Transcript.tsx:440,491` (dots, newest step's label). Seen red: PR 605's red-first
      (six rows). CI run 40399697104 on `92894be8`.
- [x] **The small moments:** trip cards lift and a deleted card leaves (and returns on a failed
      delete), the rack and its caret animate, river blocks settle, SaveLight has its "saved" beat,
      wizard steps and landing cells cross-fade. *(Part 8.)*
      *Evidence:* `home/TripCard.tsx:324-328` (`data-motion="sink"`), `trip/UnscheduledRack.tsx:247`,
      `board/RiverBlock.tsx:284` (`data-settling`), `SaveLight.tsx:98`,
      `home/NewTripWizard.tsx:860`, `front/LandingSeaCells.tsx:337`. Wizard steps fade in and the
      settle is same-day only, both recorded above (*Part 8's deviations*). Seen red: PR 606's
      red-first. CI run 40400563433 on `5ed08fda`.
- [ ] **The touched e2e specs pass on CI** for every part, with no new waits on an animation.
      *Not ticked:* every part's e2e is green on CI (runs 40396393631, 40396395181, 40398956031,
      40399175369, 40399350035, 40399533359, 40399697104, 40400563433), but part 5 added a
      suite-wide wait on the welcome splash: `apps/web/e2e/fixtures/test.ts` installs a locator
      handler on every page that waits up to 5 s for `welcome-moment` to hide before any action,
      so every spec that signs in waits out the ~1.6 s splash. The splash blocks taps by design,
      so this needs Mitchell's ruling, not a fix.
- [ ] **[walk]** On the parts' previews, Mitchell finds it calm and quick, not noisy: the welcome
      moment on a phone and desktop, a dialog, a tab switch, an Ask turn, and reduced motion
      turned on.
- [ ] A retro is appended at gate close.
