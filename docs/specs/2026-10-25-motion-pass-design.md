# The motion pass: press, pending, enter and exit, everywhere

**Status:** Design, 2026-10-25. Approved by Mitchell in the session that wrote it. **Minted as M54 and scoped 2026-10-26**
(`docs/milestones/M54-the-motion-pass.md`, plan `docs/plans/2026-10-26-M54-the-motion-pass.md`, ADR-082).

Mitchell's ask:

> I find theres a lot of places in the app that the interactions with the page feel really
> "static", theres no click animation, no loading animations, no subtle hover animations. I dont
> want to go overboard and make the site really nosey and too much movement but a design pass
> over the site to give it more subtle animations will help a perceived performance and add more
> delight to the app.

He named sign-in and signup ("really sterile and boring and has no cheer"), the invite code, the
PWA launch logo ("maybe a spin like a key lock unlocking"), the assistant's static "Thinking…",
avatar stacks, the account menu, tabs ("shift the underline to the next tab"), and Ask and chat
("new messages slide in from the bottom"). He chose from interactive mockups in the session that
wrote this.

**How far to trust section 1.** It comes from three read-only subagent audits of `main` at
`fc07b468`. The plan session verifies every cited file and line before relying on it. Paths are
under `apps/web/src/`.

---

## 1. Where things stand

**There is no shared motion layer.** Motion today is about eight one-off named animations in
`app/globals.css`, each with its own `prefers-reduced-motion` block:

| Keyframe | Line | Used by |
|---|---|---|
| `om-rise-in` | 1499 | `.map-hover-card` (140ms, fade + 4px rise) |
| `om-sk` | 1540 | `[data-sk]` skeleton breathe (`ui/skeleton.tsx`) |
| `om-save-pulse`, `om-save-breathe` | 1574, 1600 | `.sync-halo`, `.save-light-breathing` (SaveLight, toast) |
| `om-share-lift` | 1635 | pennant share arrow |
| `om-flag-*` | 1673–1820 | keep-a-day celebration |
| `sea-*` | 2089–2110 | landing cells |
| `tc-dot` | 2566 | `[data-typing-dot]`, chat-look typing dots only |

- **No motion tokens.** `@theme` has no durations or easings. Every duration is a literal.
- **The colour wall bans `animate-[…]` and other bracket values**, so motion is named classes or
  `data-*` selectors in `globals.css`. There are no `motion-safe:`/`motion-reduce:` utilities.
- **Nothing uses Radix `data-[state=open|closed]` for motion.** `ui/dialog.tsx:37,55`,
  `ui/sheet.tsx:96,110-124` (its comment at `:24` claims a slide that does not exist),
  `ui/popover.tsx:88`, `ui/menu.tsx:66` and `ui/toast.tsx:74-95` all mount and unmount instantly.
  So does the command palette, which uses `Dialog`.
- **Buttons** (`ui/button.tsx:70-77`): `transition-colors` with default timing, and
  `active:bg-brand-pressed` on primary only. No variant moves on press. Focus outline and
  `disabled:opacity-50` snap.
- **Pending is a local boolean**, plus `disabled`, plus sometimes a label swap ("Ask" → "Asking…",
  "Join" → "Joining…"). There is no `useFormStatus`, `useTransition` or spinner. Some actions have
  no pending state at all: Continue with Google, dev login, chat send, invite Retry, and every
  `Link` styled as a button.
- **Loading:** one `loading.tsx` (`app/(app)/trips/[tripId]/(board)/loading.tsx`). `/home`,
  `/plans`, `/account` and the front door have none, so the previous page freezes until the
  server HTML arrives. There is no `template.tsx` and no View Transitions use.
- **Sign-in** (`components/front/AuthScreen.tsx`): "Continue with Google" (`:317-325`) has no
  pending state and can be clicked twice. On `/signup` it first awaits `storeAdmissionCode`,
  then does a full redirect to Google and back to `/home`. The invite field (`:300-312`) is
  always on screen. Its error banners pop.
- **PWA:** the launch logo Mitchell sees is the OS splash drawn from `app/manifest.ts`, which an
  app cannot animate. iOS has no `apple-touch-startup-image` links, so it shows a blank screen.
  There is no in-app boot screen. `public/sw.js` has no fetch handler.
- **Assistant:** the Ledger look's "Thinking…" / "Still writing…" is static text
  (`assistant/Transcript.tsx:440-445`). Trip chat's "Assistant is thinking…" is static too
  (`chat/ChatPanel.tsx:243-244`). Turns, tool steps, proposals and chat messages all pop in.
  `usePinToBottom.ts:33` jumps rather than glides. `scrollIntoView` is banned there, on purpose.
- **Avatars:** five hand-rolled facepiles and no shared component. Only `TripHeader.tsx:835-893`
  caps the count with "+N". None spreads on hover. Tooltips are native `title`, where present.
- **Tabs:** three live styles, each drawing its active state per trigger: `ui/tab-strip.tsx`
  (trip lens tabs and three others), `ui/underline-tabs.tsx` (Ask rail, Account, Discover) and
  `ui/segmented-control.tsx`. `nav/PhoneTabBar.tsx:403-420` draws its own pill.
  `ui/tabs.tsx` (Radix) is imported nowhere.
- **Elsewhere:**
  - `TripCard` has no hover or press state, and a deleted card vanishes.
  - River blocks' hover shadow snaps on and their moves jump.
  - The rack opens instantly and its caret is swapped, not rotated.
  - Cover images paint in.
  - The checkbox tick snaps.
  - SaveLight stops breathing with no "saved" beat.
  - Playbook screens use `animate-pulse` filled placeholders, against `ui/skeleton.tsx`'s
    outline rule.
- **Motion that exists on purpose:** the phone day slide (`board/dayTransition.ts`, 180ms) and
  the flag celebration. The map's `fitBounds(..., { animate: false })` is deliberate
  (`lenses/MapLens.tsx:782-815`): an animated camera "read as slow and disorienting".

## 2. Decisions (Mitchell's, 2026-10-25)

1. **Character: calm and quick.** About 120–240ms, ease-out, no bounce or overshoot. Delight is
   saved for a few moments: the welcome/launch moment and the existing flag celebration.
2. **No spinners.** The house rule ("not a spinner that lies") holds. Pending is the typing dots.
   **No element may change size because its text changed.** Mitchell: *"nothing like 'Press me'
   -> 'pressed .......' so that the button gets bigger when pressed"*. A pending button's box
   is identical before, during and after:
   - **With an icon**, the label stays and the icon slot shows the dots.
   - **Label-only** (Ask, Send, Save, Join), the label fades out but keeps its space, and the
     dots sit centred where it was. The accessible name and a status line still say what is
     happening ("Asking…").

   This replaces today's label swaps: "Asking…", "Joining…", "Sending…", "Saving…" and the
   rest, about 11 sites, including `AssistantRail.tsx:1284`, `InviteLookScreen.tsx:159`,
   `InviteLandingScreen.tsx:288`, `ReportDialog.tsx:107` and `ChatMessage.tsx:181,323`. Tests
   that read that visible text move to the accessible name or status.
3. **Loading screens wherever a page freezes, built on `<Suspense>`**, plus **cross-fades
   between routes**.
4. **One welcome moment, shared by the PWA and sign-in.** It is one component in two sizes. It
   is also where signup gets its cheer, alongside friendlier signup wording that Mitchell sees
   before it ships.
   - **Full-screen** on a PWA cold launch, and after any sign-in in a phone browser.
   - **Small** after any sign-in on desktop: the mark centred over the page does the unlock and
     fades out in about a second. It **never blocks input**: no focus trap, and it does not
     intercept pointer events.
   - It plays after every sign-in, not just signup. **After signup only**, it adds a line,
     "Welcome, {name}".
   - *Amended 2026-10-26, see `docs/milestones/M54-the-motion-pass.md`.* The welcome moment is now
     a full-screen splash on an opaque surface, then the page: the page's reveal waits behind it.
     It is the same on every viewport (phone, installed app and desktop), plays after both signup
     and sign-in, shows "Welcome, {name}" after both, and lasts about 1.2–1.6s, capped by the
     name-wait cap. Under reduced motion there is no animation. This supersedes the two sizes
     above and in §4, area 4.
5. **The invite code is not checked live** (Mitchell: it invites a security flaw). Instead it
   stops taking up so much of the screen, *"since it wont be the common path"*: it sits behind a
   small "Have an invite code?" disclosure.
6. **The launch overlay always paints first, on every cold launch**, and leaves as soon as the
   page is ready. It matches the OS splash (same background colour, same mark size and
   position), so a fast launch reads as the splash itself ending.
   - If the page is ready within about 300ms, the overlay simply fades.
   - Otherwise it plays the full unlock (decision 8).

   It is never hidden-then-shown, because that would show a blank frame on slow launches. The
   exact threshold is the builder's.
7. **iOS gets startup images**, so the OS splash hands off to the in-app moment without a blank
   frame.
8. **The launch animation is option A: the two strokes part and the tile opens.** The mark
   breathes (the existing `om-save-breathe`) while loading. On ready, the strokes slide apart
   and fade, and the tile scales up slightly and fades to reveal the app. Option B, a quarter
   turn like a key, was liked too and is the fallback if A does not read well at full screen.
9. **Avatars: one shared stack component** with a "+N" cap everywhere (trip cards included).
   On hover the faces spread apart and each shows its name (with role or online status where
   the site already knows it). On touch, tapping keeps doing what it does today (the trip
   header opens the people sheet).
10. **The account menu keeps its shape** (a popover off the avatar) and gets the same fade and
    4px rise as every other popover and menu.
11. **Tabs: one sliding indicator** in each of the three tab styles and in the phone tab bar's
    pill. **Switching lenses on the trip page cross-fades.**
12. **The map camera stays unanimated.**
13. **Chat and Ask:** messages rise in from the bottom. Your own message lands at once in a
    faded "sending" state and firms up when saved. Tool steps, proposal cards and suggested
    notes ease in. The list glides to the bottom rather than jumping.
    - **In Ask**, the assistant shows the dots plus a status line that changes per tool step.
      Ask's turn streams, and `Transcript.tsx` already has `turn.tools` mid-turn.
    - **In trip chat**, the assistant gets the dots only, replacing the static "Assistant is
      thinking…". Its `@assistant` reply lands whole (M52 decision 18), so the page never sees
      a step. Live progress there is a recorded candidate (`docs/candidates.md`, *Live
      assistant progress in trip chat*).
14. **"X is typing" is not in this pass.** It is a separate follow-up (section 7).
15. **CSS only, with no animation library**, plus a few small hooks where CSS cannot do it alone
    (measuring a tab's position, delaying an unmount for an exit).
16. **It is its own milestone.**

**Calls made in the design session (Mitchell can overrule):**
- The dots are the single "working" signal everywhere: buttons, the assistant and chat.
- The press feedback is `scale(.97)` on every button variant. Primary keeps its pressed colour
  as well.

## 3. Constraints that hold throughout

- **Reduced motion is total.** Every new animation and transition has a
  `prefers-reduced-motion: reduce` path that keeps the end state with no movement. Opacity
  cross-fades may remain if short. The welcome moment then simply appears and leaves.
- **Named classes or `data-*` selectors in `globals.css`**, never bracket values (the colour
  wall). Durations and easings come from new `@theme` tokens, not literals.
- **No layout shift from motion.** Animate `transform` and `opacity` only. No width or height
  changes from state, except an explicit disclosure open/close. A pending control's box is
  identical before, during and after.
- **Exit animations must not hold up the app.** An exiting element is inert (no pointer events,
  not focusable). Focus moves as it does today, without waiting for the exit to finish. Radix
  overlays only wait for an exit through CSS `animation` (its Presence listens for
  `animationend`), not `transition`.
- **No `scrollIntoView`** in the assistant (the existing ban stands). Smooth scrolling is only
  for programmatic pin-to-bottom, and is instant under reduced motion.
- **Accessibility does not regress.** Pending controls set `aria-busy`. Status text the dots
  stand next to stays readable by screen readers (existing `role="status"`/sr-only lines stay).
- **Performance:** no scroll-linked JS added. The welcome overlay must not delay
  first-contentful-paint of the real page behind it, and must never block input once the page
  is ready.

## 4. The build, by area

These are suggested parts. The plan session sets the final cut and order. Part 1 comes first
because every other part reads its tokens and primitives.

**1. Foundation.**
- Motion tokens in `@theme` (for example fast 120ms, base 160ms, slow 240ms, and one ease-out
  curve).
- Button press on all variants, plus transitioned focus and disabled states.
- A `pending` state on `Button` that keeps width and shows the dots (built on `tc-dot`, which
  is generalised from `[data-typing-dot]`).
- Enter and exit for Dialog, Sheet (an actual slide, matching its comment), Popover, Menu,
  Toast and the command palette. The basis is `om-rise-in` plus a matching exit keyframe.
- Checkbox tick transition.

**2. Tabs.**
- A sliding indicator in `TabStrip`, `UnderlineTabs`, `SegmentedControl` and `PhoneTabBar`,
  keyed off the active trigger's measured offset. It stays correct on resize and font load.
- Lens cross-fade on the trip page.
- `ui/tabs.tsx` is dead. Deleting it is the builder's call.

**3. Loading and route transitions.**
- `loading.tsx` or `<Suspense>` boundaries for `/home`, `/plans`, `/account` and the front-door
  routes, using the existing `Skeleton`.
- Skeleton-to-content fade.
- Route cross-fade. The mechanism (React `<ViewTransition>` / Next's view-transition support,
  or a CSS-only fallback) is the plan session's to settle against the installed Next version.
- Cover images fade in on load.
- Playbook screens move to `Skeleton`.

**4. Sign-in and the welcome moment.**
- Continue with Google and dev login get the pending state, and cannot be double-submitted.
- The invite field moves behind the "Have an invite code?" disclosure. It opens on its own
  when a code is already present (from a link, or from an earlier failed attempt).
- The error banners rise in.
- The welcome moment (option A), sized per decision 4:
  - On a PWA cold launch it is full-screen, and it is in the server HTML so it covers the
    first paint (decision 6).
  - After any sign-in it is full-screen on a phone browser, and small and non-blocking on
    desktop.
  - After signup only, it adds the "Welcome, {name}" line.
- iOS startup images.
- Friendlier signup wording, shown to Mitchell before it ships.

**5. Avatars.**
- One shared stack component replaces the five hand-rolled facepiles: `TripHeader`,
  `TripCard`, `NextTripHero`, `TripPeopleBlock` and `RiverBlock`. `RiverBlock` stays
  non-interactive.
- It has the "+N" cap, spreads on hover and shows a name tip per face.

**6. Chat and Ask.**
- Messages rise in, and the sending state fades.
- Smooth pin-to-bottom.
- In Ask's Ledger look, dots plus a per-step status line, labelled from `turn.tools`. In the
  chat look and in trip chat, dots only.
- Tool steps, proposals and notes ease in.
- The tool-step disclosure animates open and closed.
- Proposal "applied" gets a check that settles in, without a label-width change.

**7. Lists and small moments.**
- Trip card hover lift and press, and a deleted card animates out (a failed delete animates
  back in).
- New trips animate in.
- The rack animates open and closed, and its caret rotates.
- River block hover shadow transitions. A moved block settles into its new place rather than
  jumping.
- SaveLight gets a brief "saved" beat when breathing stops.
- New-trip wizard steps cross-fade.
- Landing lit cells transition rather than snap.

## 5. Testing

Per `docs/guidelines/testing.md`. Motion itself is verified by eye on the PR's preview; tests pin
the behaviour that motion could break:

- Pending controls set `aria-busy`, are not re-submittable, and **keep their width**. An e2e
  test measures the bounding box before and during pending.
- Under emulated reduced motion, overlays still open and close and the welcome overlay still
  leaves. No test waits on an animation to finish.
- Exit animations do not trap focus or leave an invisible element intercepting clicks.
- The sliding indicator sits under the active tab after a switch and after a resize.
- Existing e2e specs that click through dialogs and menus do not get slower or flakier. CI runs
  of the touched specs are compared before and after the foundation part.

## 6. Not in this pass

- **"X is typing" in trip chat**, and **live assistant progress in trip chat.** Both are
  recorded in `docs/candidates.md`. They are real features, not motion. Both need live data
  the events poll serves poorly (ADR-049, ADR-073 §6), so they likely share one transport
  decision.
- Animating the map camera.
- An animation library.
- Changing the account menu into a sheet or a hamburger.

## 7. What the plan session must settle

- The route cross-fade mechanism against the installed versions (Next 16.4, React 19.3), and
  its browser fallback.
- How "ready" is detected for the launch overlay's exit (hydration of the page, or first
  content), and how the post-sign-in moment knows it follows a sign-in, and a signup.
- Whether the existing dialog- and menu-heavy e2e specs need waits for exit animations, and how
  to avoid adding any.
