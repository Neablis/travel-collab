# M54 — The motion pass: press, pending, enter and exit, everywhere

**Status:** **Closed 2026-10-27, gate 13 of 13**, by `pnpm milestone close M54 --confirm` on part 0
(PR 593). **Scoped 2026-10-26 with Mitchell**, placed ahead of M43 on his word. The design is `docs/specs/2026-10-25-motion-pass-design.md` (approved 2026-10-25), whose
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
- **The trip lens fades in; it does not cross-fade (Mitchell, 2026-10-27, at the close).** Part 3
  (PR 600) shipped an enter-only fade of the incoming lens (`globals.css:2819-2825`). Mitchell:
  *"Just record as a ki"*. It is KI-2026-10-27-b.

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
- [x] **A pending control keeps its box.** Every one of the ~20 label swaps uses `Button`'s
      `pending` state, sets `aria-busy`, cannot be submitted twice, and keeps its accessible
      "…ing…" name. An e2e test measures a pending button's bounding box before and during pending,
      and was seen red with the width held off. *(Parts 1–2.)*
      *(Ticked 2026-10-27 **on a substitute Mitchell accepted**: the e2e was never seen red.)*
      The code and the e2e are on main (`button.tsx:124-138`;
      `apps/web/e2e/m54-motion.spec.ts:174`; no `cond ? "…ing…" : label` button swap left in
      `apps/web/src`; PR 595's red-first table for the conversions). No red is recorded for
      the **e2e** with the width held off: PR 594's red-first shows only the unit test
      (`primitives.test.tsx`, "width-keeping removed" → `expected '' to contain 'Ask'`).
      Asked whether to prove the e2e red, Mitchell declined on 2026-10-27, about 02:00Z, in
      Claude session `session_01C7zMQXoqjodDnxEKii244m`: *"No that's too much, it's good without doing that"*.
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
- [x] **Every tab style slides its indicator**, and it sits under the active tab after a switch and
      after a resize (a test, seen red). Lenses cross-fade on the trip page. *(Part 3.)*
      *(Ticked 2026-10-27 on Mitchell's ruling for the lens half; the indicator half on
      evidence.)* The indicator half is met (`useIndicator` in `tab-strip.tsx`,
      `underline-tabs.tsx`, `segmented-control.tsx`, `nav/PhoneTabBar.tsx`;
      `m54-motion.spec.ts:247,263`, seen red in PR 600's red-first with `ResizeObserver` removed
      and with the wrong value passed; CI run 40398955833 on `1c89f404`). The lens is an enter-only
      fade of the incoming lens, not a cross-fade (`globals.css:2819-2825`, "the outgoing one is
      already gone"). Mitchell, 2026-10-27, about 02:00Z, in Claude session `session_01C7zMQXoqjodDnxEKii244m`: *"Just
      record as a ki"*. Recorded as a decision above and filed as **KI-2026-10-27-b**.
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
- [x] **Sign-in has its cheer.** Continue with Google and dev login cannot be double-submitted, the
      invite code sits behind *Have an invite code?*, and the welcome moment plays after every
      sign-in (a full-screen splash, then the page, on every viewport, per decision 4 as amended;
      "Welcome, {name}" after signup and sign-in) and on every PWA cold launch, with iOS startup images.
      A test proves the splash leaves within the name-wait cap and the page is usable after it.
      *(Part 5.)*
      *(Ticked 2026-10-27; the installed-app cold launch on an iPhone **waived by Mitchell**.)*
      Everything else is on main. The iOS startup images **are** there: 20 `public/icons/startup-*.png` linked by
      `app/layout.tsx:40-76`, held by `layout.test.ts` (seen red in PR 607). The launch path is
      `LAUNCH_SCRIPT` plus `LaunchOverlay` (`WelcomeMoment.test.tsx:80,346`, jsdom only). The rest:
      `AuthScreen.tsx:211-251` (`inFlight`), `authCopy.ts:47`, `WelcomeMoment.test.tsx:154`
      ("leaves within the name-wait cap"), `apps/web/e2e/m54-welcome.spec.ts:78` (splash, then a
      usable page, at each width). PR 607's red-first; CI run 40399350035 on `f8d1d7b2`.
      *On a device:* Mitchell's walk of `main` at `e9a46b0f` (2026-10-27, 01:51Z, from Android,
      Claude session `session_01H7zo2roVmxAkUKCbEFmyFZ`: "I confirmed all those things in a
      walkthrough") saw a full-screen splash after sign-in and after signup, "Welcome, {name}" or
      "Welcome!", for about 1.6 s, then the page; a plain reload showed no splash.
      Still not seen: an installed-app (PWA) cold launch on a device. Mitchell, 2026-10-27,
      about 02:00Z, in Claude session `session_01C7zMQXoqjodDnxEKii244m`: *"I don't have a iPhone so I can't test"*. Waived;
      the unseen launch and startup images are **KI-2026-10-27-a**.
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
- [x] **The touched e2e specs pass on CI** for every part, with no new waits on an animation.
      *(Ticked 2026-10-27 on Mitchell's ruling; the splash wait is KI-2026-10-27-c.)* Every
      part's e2e is green on CI (runs 40396393631, 40396395181, 40398956031, 40399175369,
      40399350035, 40399533359, 40399697104, 40400563433). Part 5 added a wait on the welcome
      splash, and Mitchell asked on 2026-10-27, about 02:00Z, in Claude session `session_01C7zMQXoqjodDnxEKii244m`: *"I thought
      the test runner had a way to prevent this? Record as a ki if this isn't true"*. What the
      fixture does, read at `e9a46b0f`: it is a Playwright `addLocatorHandler` on
      `welcome-moment` installed on every page (`apps/web/e2e/fixtures/test.ts:26-32`, wired at
      :68), which runs **only when the splash is visible** before an action or auto-waiting
      assertion and then waits up to 5 s (:12) for it to hide; on a page with no splash it does
      nothing. The splash shows in e2e **only after a form sign-in**, since only `recordSignIn`
      sets `tc_welcome` (`server/users.ts:392-401`); specs that start from the shared storage
      state never see it, because `WelcomeMoment.tsx:174` spends the cookie at hydration before
      `auth.setup.ts` saves the state. **No flag, cookie or storage key suppresses it in
      tests**: reduced motion (`playwright.config.ts:88`) skips only a cue-less launch
      (`WelcomeMoment.tsx:179`). So the runner waits only when it must, but every spec that
      signs in through the form still waits out the ~1.6 s splash (14 spec files call
      `signInAsDevUser` 20 times, plus 29 direct dev-login clicks). Filed as
      **KI-2026-10-27-c**, as he asked.
- [x] **[walk]** On the parts' previews, Mitchell finds it calm and quick, not noisy: the welcome
      moment on a phone and desktop, a dialog, a tab switch, an Ask turn, and reduced motion
      turned on.
      *Evidence so far:* on 2026-10-27 at 01:51Z, in Claude session
      `session_01H7zo2roVmxAkUKCbEFmyFZ` (from Android), Mitchell wrote "I confirmed all those
      things in a walkthrough" about the merged build on `main` (`e9a46b0f`). Those things were:
      (1) at phone width on a trip, Board↔Notebook keeps the Ask tab in place, greyed briefly;
      (2) after sign-in and after signup, a full-screen splash shows "Welcome, {name}" or
      "Welcome!" for about 1.6 s, then the page; (3) a plain reload shows no splash.
      *(Ticked 2026-10-27; a dialog, a tab switch, an Ask turn and reduced motion **waived by
      Mitchell**.)* His walk did not cover them, and on 2026-10-27, about 02:00Z, in
      Claude session `session_01C7zMQXoqjodDnxEKii244m`, he said: *"I didn't but I'm not gonna
      walk them now"*. What holds them is tests only: the overlay and indicator specs in
      `m54-motion.spec.ts` (boxes above), the suite's reduced-motion run (decision 20), and
      part 7's unit tests for the Ask turn.
- [x] A retro is appended at gate close.
      *Evidence:* *Retro*, below (2026-10-27).

## Retro — written 2026-10-27 (13 of 13 boxes ticked)

Written at the close on part 0 (PR 593). Five boxes are ticked on Mitchell's word of 2026-10-27,
about 02:00Z, each quoted in its box: two waived (the rest of the [walk]; the iPhone cold launch
under *Sign-in has its cheer*), one on an accepted substitute (the pending-button e2e never seen
red), and two on his ruling to record a known issue (the lens fade, KI-2026-10-27-b; the e2e
splash wait, KI-2026-10-27-c).

### What went well

- **Eight parts reached `main` together**: PRs 594, 595, 600, 601, 607, 604, 605 and 606 merged
  between 21:39:30Z and 21:39:37Z on 2026-10-26, and the stack landed as `e9a46b0f`. Every part's
  `ci` run was green on its final head (runs 40396393631, 40396395181, 40398956031, 40399175369,
  40399350035, 40399533359, 40399697104, 40400563433). No migration.
- **Red evidence for the gate's tests is in the PR bodies**: PR 594 (the exit left interactive,
  3 failed; width-keeping removed in the unit test), PR 600 (`ResizeObserver` removed, the wrong
  value passed), PR 601, PR 604, PR 605 (six rows), PR 606, and PR 607 (`layout.test.ts` over the
  20 startup images).
- **Motion has one home**: every new duration and easing is an `@theme` token
  (`globals.css:218-237`), and the diff adds no bracket duration, easing or animation class.
- **The orchestrator was woken by GitHub 0 times** in either session with a block (see *Spend*).
- **Mitchell's phone walk of `main` passed its three checks** (2026-10-27, 01:51Z): the Ask tab
  holds through Board↔Notebook, the splash after sign-in and signup, and no splash on a reload.

### What could be better

- **The welcome splash was built three times.** Part 5 (PR 607) first built the spec's small
  desktop moment over the page. Mitchell's walk found it read as a glitch (*"almost looks like a
  flash of unstyled content"*), so decision 4 was amended to a full-screen splash everywhere, and
  then amended again for the named/unnamed wording and a fixed ~1.6 s. The part 5 rebuild cost
  1.17M units and its review fixes 726k, together 18.6% of the build session's block. The change:
  `plan-a-milestone`'s interaction sketch for a moment like this should show it at desktop width
  over an already-loaded page, which is where the first version failed, before part 1 starts.
- **Rebasing a fixed part conflicted the part above it.** In the unattended stack, a review fix
  on part K was rebased in, and part K+1, built on the old commits, then conflicted, which is the
  squash case `stacked-prs.md` §4 describes. Two of M54's five sessions are named for that
  repair (`session_014sssd9…`, "finish the stack"; `session_01H7zo2r…`, "stack fix and walk"). The
  change: in a stack, land a lower part's fix as a new commit and merge the lower branch up into
  each part above; never rewrite a part that has a part on top of it.
- **A unit race took repeat runs to find.** PR 601's three test files failed about one run in
  ten under load, at a different test each time, because they read state that a passive effect
  wrote a task later (commit `ab6af0f`). Moving the phone Ask's registration and decline to
  `useLayoutEffect` closed it. The assistant rail's three focus moves are still passive effects,
  and their tests wait for focus instead (KI-2026-10-27-d, confirmed by reading
  `AssistantRail.tsx:721-769`).
- **No part had a `phase-verifier` walk.** Neither spend block has a `phase-verifier` agent (M49
  had one). The only walk was Mitchell's, after the merge, on three checks; the dialog, a tab
  switch, an Ask turn and reduced motion were never walked and he waived them. The pending-button
  e2e was never seen red either; he accepted it. A UI-heavy milestone should have at least its
  riskiest part (here part 5) walked by a `phase-verifier` before review.
- **Off-theme spend.** The m17 clock-test fix (KI-2026-10-26-pm, PR 610) cost 695k units, the
  build's third-costliest agent, for a test that failed while its username held "pm".
- **Three of the five sessions left no spend block**, the M52 finding again: only the last build
  session and the close ran `session-metrics` (*Spend*).
- **Targets missed:** dollars per 1,000 lines ($41.0) and the orchestrator's share (20.4%). Both
  are explained under *Spend against the last milestone*.

### Leftovers

- **KI-2026-10-27-a**: the iOS home-screen cold launch and its startup images, never seen on a
  device (waived, no iPhone).
- **KI-2026-10-27-b**: the trip lens fades in; no cross-fade.
- **KI-2026-10-27-c**: every e2e spec that signs in through the form waits out the splash;
  nothing in the suite can switch it off.
- **KI-2026-10-27-d**: the assistant rail's focus moves run in passive effects.
- **KI-2026-10-13-a** is narrowed, not resolved: Mitchell saw the tab-switch half hold on a
  device (part 4), and the first-load gap stays open.
- **Filed during the build:** KI-2026-10-26-t (Tab during a modal's exit snaps back), -u (the
  phone trip header's `⋯` is replaced after load), -x (m49 cover-reposition e2e flakes), -y (m38
  personas times out on a first attempt); -pm is resolved (PR 610).
- **The waived [walk] items** (a dialog, a tab switch, an Ask turn, reduced motion): Mitchell's
  call if he wants them walked later.
- **From the plan, kept here because the plan is deleted:** status text that is not a button was
  deliberately left as text, not `pending`: `SaveLight.tsx`, `Transcript.tsx`'s status line,
  `InviteLookScreen.tsx`, `InviteLandingScreen.tsx`, `SharedTripScreen.tsx`, `DemoTripScreen.tsx`,
  `SharedDayScreen.tsx`, `newTripScript.ts` and `SharedDayMap.tsx`. The plan's other content is
  built, and its mechanisms are in ADR-082.

## Spend
<!-- session-metrics:milestone v1 -->

Five sessions worked on M54. Two have a block: the last build session (`session_01H7zo2r…`,
"stack fix and walk"), whose block was carried in its hand-off and is used here verbatim because
its transcript went with its container, and this close (`session_01C7zMQX…`), generated below.
The three earlier sessions ran no `session-metrics` and their transcripts are gone; only their
recorded usage survives. Recorded dollars and units are `list_sessions` →
`external_metadata.usage` (units = input + 1.25 × cache write + 0.1 × cache read), read
2026-10-27 at about 02:00Z.

| Session | Block | Agents | Calls | Units (block) | Recorded units | Recorded $ |
|---|---|---|---|---|---|---|
| 1 `session_01HGfVfR…` (scoping, part 0) | none | – | – | – | 12.98M | $45.43 |
| 2 `session_01H3P9xw…` (parts 1–8) | none | – | – | – | 24.94M | $91.56 |
| 3 `session_014sssd9…` (finish the stack) | none | – | – | – | 14.88M | $56.24 |
| 4 `session_01H7zo2r…` (stack fix and walk) | carried | 20 | 822 | 10.22M | 11.10M | $40.45 |
| 5 `session_01C7zMQX…` (the close) | generated | 4 | 95 | 1.65M | 1.66M | $5.86 (at its run) |
| **Total** | | **24** | **917** | **11.87M** (sessions 4–5) | **65.56M** | **$239.54** |

Session 4's block was generated before that session's last calls, which is why its recorded
units are higher than its block's.

**By agent type, sessions 4 and 5 summed**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `phase-implementer` | 9 | – | – | – | 4.75M | 40.0% |
| `general-purpose` | 9 | – | – | – | 3.05M | 25.7% |
| `orchestrator` | 2 | 123 | 168k | 244k | 2.42M | 20.4% |
| `part-reviewer` | 4 | – | – | – | 1.66M | 14.0% |

Session 4, as carried: 20 agents, 822 API calls, 10.22M units. `phase-implementer` 9 agents /
4.75M (46.5%); orchestrator 105 calls, average 177k and peak 244k context, 2.06M (20.2%);
`general-purpose` 6 / 1.76M; `part-reviewer` 4 / 1.66M. Costliest: the part 5 splash rebuild
(1.17M), the part 5 review fixes (726k) and the m17 clock-test fix (695k). Its calls per type
other than the orchestrator's were not carried.

Session 5, generated by `pnpm -s session-metrics --milestone <this session's transcript> --parts 8
--lines-added 5847 --cost-usd 5.86`, pasted unchanged below. It ran mid-close, so it misses the
close's last calls:

4 agents, 95 API calls, 1.65M units, $5.86 recorded. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | ≈ $ | Share |
|---|---|---|---|---|---|---|---|
| `general-purpose` | 3 | 77 | 113k | 155k | 1.29M | $4.58 | 78.2% |
| `orchestrator` | 1 | 18 | 116k | 139k | 359k | $1.28 | 21.8% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units | ≈ $ |
|---|---|---|---|---|---|---|
| M54 part 0: merge main, tick gate | `general-purpose` | 44 | 118k | 155k | 696k | $2.48 |
| Close M54 gate on part 0 | `general-purpose` | 29 | 111k | 131k | 471k | $1.68 |
| Record M54 walk evidence on part 0 | `general-purpose` | 4 | 75k | 78k | 120k | $0.43 |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | ≈ $ | Share of orchestrator | Idle |
|---|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | $0.00 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 2 | 25k | $0.09 | 7.0% | – |
| Subagent finished | 4 | 170k | $0.60 | 47.3% | – |
| Harness | 1 | 0 | $0.00 | 0.0% | – |
| Human | 4 | 164k | $0.58 | 45.6% | – |
| Other (unrecognised frame) | 0 | 0 | $0.00 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

None recorded.

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 21.8% |
| No phase-implementer averaging > 250k context | not measurable | no phase-implementer transcripts |
| GitHub wakes per merged part < 5 | met | 0 / 8 = 0.0 |
| Dollars per 1k lines added < 20 | met | $1.00 |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

M49 is the last closed milestone. Lines added for M54, by the guideline's rule (the merged diffs
of PRs 594, 595, 600, 601, 607, 604, 605 and 606 by GitHub's per-file count, without `docs/`,
`*.generated.json` and `pnpm-lock.yaml`): 5,847, with no migration snapshot.

- **Dollars per 1,000 lines added (under 20):** missed, $41.0 ($239.54 / 5.8k); M49 $9.1. The
  splash was built three times and the stack was repaired across two sessions (*What could be
  better*); five sessions' re-orientation added to it.
- **Orchestrator's share (under 15%):** missed, 20.4% over sessions 4 and 5 (2.42M of 11.87M);
  not measurable for sessions 1–3; M49 28.4%. Session 4's orchestrator ran at a 177k average
  context through the stack repair and the walk.
- **A builder's average context (none over 250k):** not measurable; session 4's block carried no
  per-builder average, and the close had no builder. M49 met (worst 119k).
- **GitHub wakes per merged part (under 5):** met, 0 in the close; session 4's figure was not
  carried. M49 0 in its close.
- **Cache re-writes after a coordinator message (2 or fewer):** met in the close (0); not carried
  for session 4.
