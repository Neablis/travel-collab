# M54 plan — The motion pass

Staged while M54 is in flight; deleted in the gate-close commit. Decisions: the milestone file and
the spec (`docs/specs/2026-10-25-motion-pass-design.md`, §2–§3 bind every part). Mechanisms:
ADR-082. Paths are relative to the repo root; `web/` means `apps/web/src/`, `ui/` means
`web/components/ui/`, and a bare component path is under `web/components/`.

**Order: an unattended stack** (Mitchell, 2026-10-26). Part 1 branches from `main`. Part K+1
branches from part K's head, and its PR targets part K's branch and says which PR it waits on.
Mitchell merges them in order; after each merge the next PR is retargeted to `main`
(`stacked-prs.md` §4). Part 0 (`ccr-3f23dccb-mljaxu`, prose only) merges last.

| Part | Branch | Theme | Stacks on |
|---|---|---|---|
| 1 | `claude/m54-part1-motion-foundation` | Tokens, button press and `pending`, overlay enter/exit, checkbox, e2e reduced motion | `main` |
| 2 | `claude/m54-part2-pending-everywhere` | The ~20 label swaps move to `pending` | 1 |
| 3 | `claude/m54-part3-sliding-tabs` | One sliding indicator per tab style, lens cross-fade | 2 |
| 4 | `claude/m54-part4-loading-and-routes` | Skeleton routes, route cross-fade, cover fade, playbook skeletons | 3 |
| 5 | `claude/m54-part5-welcome-moment` | Sign-in pending, invite disclosure, the welcome moment, iOS startup images | 4 |
| 6 | `claude/m54-part6-avatar-stack` | One avatar stack | 5 |
| 7 | `claude/m54-part7-chat-and-ask` | Messages rise in, glide to bottom, dots and step status | 6 |
| 8 | `claude/m54-part8-small-moments` | Trip cards, rack, river blocks, SaveLight, wizard, landing cells | 7 |

**Every part:** motion is `transform` and `opacity` only. Durations and easings come from part 1's
tokens. Each new animation has a reduced-motion path. Use named classes or `data-*` selectors in
`globals.css`, never bracket values. No test waits on an animation. Each PR body says what to look
at on its preview, at 390 and 1440 wide, with reduced motion off and then on.

## Part 1 — the foundation

Tokens in the `@theme` block (`web/app/globals.css:35`). Tailwind 4.3.3 generates utilities only
from `--transition-duration-*` (→ `duration-*`), `--ease-*` (→ `ease-*`) and `--animate-*`
(→ `animate-*`); a `--duration-*` token generates nothing. Suggested: fast 120ms, base 160ms,
slow 240ms, and one ease-out. `tc-dot` (:2566) is generalised from `[data-typing-dot]`
(:2579-2595) into a `TypingDots` primitive. `om-rise-in` (:1499) gets a matching exit keyframe.
Radix waits on `animationend`, so exits are CSS `animation`, not `transition`. Under reduced
motion, overlays have `animation: none`.

| File | Entry point | Test |
|---|---|---|
| `web/app/globals.css` | `@theme` tokens; `tc-dot`; enter/exit keyframes; `[data-state]` overlay rules; checkbox tick | colour wall; e2e below |
| `ui/button.tsx` | `buttonVariants` (:47, base :70, variants :73-77): press `scale(.97)` on every variant, transitioned focus and disabled; `Button` (:116) gains `pending` (icon slot shows the dots, or the label fades but keeps its space; `aria-busy`; no re-submit) | `ui/primitives.test.tsx` (seen red: width held off, `aria-busy` missing) |
| `ui/typing-dots.tsx` (new) | `TypingDots` | `ui/primitives.test.tsx` |
| `ui/dialog.tsx` | Overlay (:37), Content (:54) | `ui/overlays.test.tsx`, `ui/composites.test.tsx` |
| `ui/sheet.tsx` | Overlay (:96), Content (:97), size classes (:119-123); a real slide, as its comment at :24 claims | `ui/overlays.test.tsx` |
| `ui/popover.tsx` | Content (:81); the account menu inherits it | `ui/popover.test.tsx`, `AccountMenu.test.tsx` |
| `ui/menu.tsx` | `MenuContent` (:53, Content :62) | `ui/menu.test.tsx` |
| `ui/toast.tsx` | `Toast` (:22, root :74); not Radix, so it uses the new hook for its exit | `ui/toast.test.tsx` |
| `web/lib/useExitPresence.ts` (new) | delays an unmount for an exit; the exiting node is `inert` at once | `useExitPresence.test.tsx` |
| `palette/CommandPalette.tsx` | rides `Dialog` | `palette/CommandPalette.test.tsx`; e2e `m41-command-palette` |
| `ui/checkbox.tsx` | `Checkbox` (:23) tick | `ui/checkbox.test.tsx` (new; there is none) |
| `apps/web/playwright.config.ts` | `use.reducedMotion: "reduce"` (decision 20) | — |
| `apps/web/e2e/m54-motion.spec.ts` (new) | `test.use({ reducedMotion: "no-preference" })`: open and close a dialog and a menu; an exiting overlay takes no click and holds no focus; a pending button's box is the same before and during pending | the spec, on `test:e2e:ci-like` |

**CI to compare before and after:** `m8-make-it-real`, `m39-installable`, `m29-time-river`,
`m26-phone-surfaces`, `m41-command-palette`, `m14-mobile-notebook`, `m20-entitlements`.

**Preview:** press any button and see it give. Open the account menu, a dialog, a phone sheet and
⌘K: each fades and rises in, and leaves the same way. Tick a checkbox.

## Part 2 — pending everywhere

Each site below moves from a label swap to `<Button pending>`. The accessible name keeps the
"…ing…" wording (an `aria-label` or sr-only text), so tests that query by role name keep passing.
The two tests that read `textContent` move to the accessible name or the status line.

| File | Swap | Test that reads it |
|---|---|---|
| `assistant/AssistantRail.tsx:1284` | Asking… / Ask | `AssistantRail.test.tsx:157` (role name) |
| `access/InviteLookScreen.tsx:159` | Joining… / Join the trip | — |
| `access/InviteLandingScreen.tsx:288` | Joining… / joinLabel | — |
| `report/ReportDialog.tsx:107` | Sending… / Send | — |
| `chat/ChatMessage.tsx:323` | Saving… / Save | — |
| `board/SuggestionsChip.tsx:98` | Accepting… / Accept all | `board/suggestions.test.tsx:561,577` |
| `assistant/SuggestedNote.tsx:82` | Accepting… / Accept all | — |
| `assistant/ProposalCard.tsx:185,245` | Applying… / Make the change; Accepting… / Accept | `ProposalCard.test.tsx:146` |
| `lenses/MapOfflineState.tsx:65` | Trying… / Try again | `MapOfflineState.test.tsx:50` (**textContent**: moves) |
| `account/TokensSection.tsx:724` | Creating… / Create token | — |
| `playbooks/AddToTripDialog.tsx:243` | Adding… / Add to trip | — |
| `playbooks/ReadStates.tsx:26` | Retrying… / Retry | `ReadStates.test.tsx:45` |
| `playbooks/ReviewsSection.tsx:192` | Posting… / Post | — |
| `home/ImportTripButton.tsx:140` | Importing… | — |
| `demo/DemoTripScreen.tsx:227` | Making it yours… | — |
| `AccountMenu.tsx:274` | Resetting… / Reset | `AccountMenu.test.tsx:178,183,198,221` |
| `plans/PlansScreen.tsx:794` | Working… / Pay $X with Stripe | — |
| `playbooks/SharedDayScreen.tsx:986` | Making your trip… | `SharedDayScreen.test.tsx:1534,1570,1583` |

Status text that is not a button stays as it is: `SaveLight.tsx:112`, `Transcript.tsx:131,442`,
`InviteLookScreen.tsx:78`, `InviteLandingScreen.tsx:85`, `SharedTripScreen.tsx:116`,
`DemoTripScreen.tsx:107`, `SharedDayScreen.tsx:618`, `newTripScript.ts:153`,
`SharedDayMap.tsx:353`. `ChatMessage.tsx:181`'s "Sending…" sits in the timestamp slot and is part
7's (the faded sending state); `ChatMessage.test.tsx:116-120` moves with it. Also give a pending
state to the actions that have none: invite Retry, and chat send (part 7 owns its look).

**Preview:** on a trip, Ask something, and the Ask button holds its width while the dots run. Join
a trip by invite. Accept a proposal. None of the buttons changes size.

## Part 3 — sliding tabs and the lens cross-fade

A new `web/lib/useIndicator.ts` measures the active trigger (a `ResizeObserver` plus
`document.fonts.ready`) and drives one indicator element per tab list with `transform`.

| File | Entry point | Test |
|---|---|---|
| `web/lib/useIndicator.ts` (new) | offset and width of the active trigger | `useIndicator.test.tsx` |
| `ui/tab-strip.tsx` | `TabStrip` (:8); users `TripViewTabs`, `admin/ConsoleTabs`, `admin/TierPanel`, `playbooks/SharedDayScreen` | `ui/navigation.test.tsx`, `trip/TripViewTabs.test.tsx` |
| `ui/underline-tabs.tsx` | `UnderlineTabs` (:32) | `ui/underline-tabs.test.tsx` |
| `ui/segmented-control.tsx` | `SegmentedControl` (:6) | `ui/segmented-control.test.tsx`, `ui/roving-radio.test.tsx` |
| `nav/PhoneTabBar.tsx` | `PhoneTabBarView` (:267), pill `phone-tab-pill` (:413-420) | `nav/PhoneTabBar.test.tsx`; e2e `m45-home-assistant`, `m39-installable:112-123` |
| `board/TripBoardScreen.tsx` | lens switch (:1648 Map, :1674 Plan, :1756 Overview, :1769 Calendar, :1951) cross-fades | `board/board.test.tsx`; e2e `m4-money-and-lenses`, `m10-map-rail` |
| `ui/tabs.tsx` | dead (no importer): delete | — |
| `apps/web/e2e/m54-motion.spec.ts` | the indicator sits under the active tab after a switch and after a resize | the spec |

**Preview:** switch lenses on a trip and see the underline slide while the lens cross-fades. Do the
same with the Account tabs, the Ask rail tabs and the phone tab bar's pill. Resize the window and
the indicator stays put under its tab.

## Part 4 — loading and route transitions

The loading wall (`scripts/check-loading-wall.mjs`) forbids visible "Loading…" text, so use
`Skeleton` (its label attribute is fine). For the route cross-fade (decision 18), wrap the children
in `AppShell` and in the root layout's front-door slot in `<ViewTransition>`. Give the header and
`PhoneTabBar` their own `view-transition-name` so they hold still. The CSS lives in `globals.css`,
and the fallback is a `template.tsx` fade under `@supports not (view-transition-name: none)`.

| File | Entry point | Test |
|---|---|---|
| `web/app/(app)/home/loading.tsx` (new) | reuses `home/HomeSkeletons.tsx` | `app/(app)/home/page.test.tsx` |
| `web/app/(app)/plans/loading.tsx`, `web/app/(app)/account/loading.tsx` (new) | `Skeleton` | colocated `loading.test.tsx` |
| `web/app/(front)/{signin,signup,invite/[token],s/[token],demo}/loading.tsx` (new) | `Skeleton` | one shared test over the set |
| `ui/skeleton.tsx` | `Skeleton` (:31), `SkeletonRegion` (:66): skeleton-to-content fade | `ui/skeleton.test.tsx` |
| `AppShell.tsx` | `AppShell` (:45) wraps children in `<ViewTransition>` | `AppShell.test.tsx` or `app/layout.test.ts` |
| `web/app/layout.tsx` | front-door slot (:121) | `app/layout.test.ts`; e2e `smoke`, `m15-front-door` |
| `web/app/template.tsx` (new, fallback) | CSS fade-in only where unsupported | — |
| `cover/CoverImage.tsx` | fades in on load (all its users follow) | `cover/CoverImage.test.tsx`; e2e `m37-trip-covers`, `m49-cover-reposition` |
| `playbooks/SharedDayMap.tsx:363`, `LeaderboardScreen.tsx:74`, `DiscoverScreen.tsx:850`, `ProfileScreen.tsx:65` | `animate-pulse` placeholders → `Skeleton` | their colocated tests |

**Preview:** go from Home to a trip, to Account and to Plans, and see a skeleton, never a frozen
page. The header holds still while the page cross-fades. Open Discover and watch a cover fade in.

## Part 5 — sign-in and the welcome moment

Decision 19: `recordSignIn` (`server/users.ts:403`, `returning` :414, new-account branch :486)
sets `tc_welcome=signin|signup` (short-lived, `SameSite=Lax`). A client component in the app shell
reads it once, clears it, and plays the moment. It is full-screen when
`matchMedia("(pointer: coarse)")` or standalone, and otherwise small and non-blocking: no focus
trap, `pointer-events: none`. The PWA cold-launch overlay is server HTML, shown by an inline
`<head>` script only in standalone mode (reuse `lib/installPrompt.ts:82,103`'s check). It matches
the OS splash (`app/manifest.ts:30-31` colours, the mark's size), and leaves on hydration
(`lib/useHydrated.ts`): a fade if the page is ready within ~300ms, otherwise option A's unlock.
The friendlier signup wording goes in the PR body for Mitchell to approve (`front/authCopy.ts` has
a "do not reword" comment, so the PR says what changed and why).

| File | Entry point | Test |
|---|---|---|
| `front/AuthScreen.tsx` | `continueWithGoogle` (:215), `startSignIn` (:223), Google button (:317-325) and dev-login submit (:336) get `pending` and refuse a second submit; the invite field (:275-313) goes behind *Have an invite code?*, open when a code is present; error banners rise in (:52, :270-272) | `front/AuthScreen.test.tsx`; e2e `m15-front-door`, `m11a-invite-gate`, `e2e/auth.setup.ts` (dev login must keep working for every spec) |
| `front/authCopy.ts` | signup wording | `front/AuthScreen.test.tsx` |
| `web/app/(front)/signup/page.tsx` | `storeAdmissionCode` (:65), `initialAdmissionCode` (:112) | — |
| `web/server/users.ts` | `recordSignIn` sets `tc_welcome` | `server/users.int.test.ts` (signin vs signup value, seen red) |
| `welcome/WelcomeMoment.tsx` (new) | one component, `size="full" \| "small"`, `name?` | `WelcomeMoment.test.tsx` (small never sets `inert`/focus trap and takes no pointer events, seen red) |
| `web/app/layout.tsx` | head (:94-108): standalone launch script + iOS `apple-touch-startup-image` links; body (:109-145): the launch overlay | `app/layout.test.ts`, `app/brandIcons.test.ts` |
| `web/app/manifest.ts` | unchanged unless the colours need matching | `app/manifest.test.ts`; e2e `m39-installable` |
| `apps/web/public/icons/startup-*.png` + `scripts/generate-og-assets.mjs` | iOS startup images per device size | `app/brandIcons.test.ts` |
| `web/app/globals.css` | the unlock keyframes (option A), reusing `om-save-breathe` | — |

**Preview:** sign out and sign in on desktop. The mark unlocks over the page and fades within about
a second, and you can click through it. Do it on a phone width and it is full-screen. Sign up with a
new account and see "Welcome, {name}". Add to the home screen on iOS and cold-launch it: the splash
hands off to the overlay with no blank frame.

## Part 6 — one avatar stack

| File | Entry point | Test |
|---|---|---|
| `ui/avatar-stack.tsx` (new) | `AvatarStack({ people, max, size, interactive })`, built on `ui/person-chip.tsx`: "+N" cap, spreads on hover, a name tip per face (role or online status where the caller passes it) | `ui/avatar-stack.test.tsx` (the "+N" count, seen red) |
| `trip/TripHeader.tsx` | `TravellerStack` (:846-906); a tap still opens the people sheet | `trip/TripHeader.test.tsx`; e2e `travellers`, `m46-whos-online` |
| `home/TripCard.tsx` | stack (:261-268) | `home/TripCard.test.tsx` |
| `home/NextTripHero.tsx` | stack (:301-308) | `home/NextTripHero.test.tsx` |
| `pages/blocks/TripPeopleBlock.tsx` | stack (:20-28) | `pages/blocks/TripPeopleBlock.test.tsx` |
| `board/RiverBlock.tsx` | stack (:541-544), `interactive={false}` | `board/board.test.tsx` |
| `home/HomeSkeletons.tsx` | skeleton facepile (:89, :214) matches the new shape | — |

**Preview:** hover the trip header's faces and they spread apart and name themselves. A trip with
more people than fit shows "+N" on its Home card and in the header.

## Part 7 — chat and Ask

| File | Entry point | Test |
|---|---|---|
| `assistant/usePinToBottom.ts` | `usePinToBottom` (:27, `scrollTop` :33): a smooth glide, instant under reduced motion, still no `scrollIntoView` | `assistant/usePinToBottom.test.tsx` |
| `assistant/Transcript.tsx` | `Transcript` (:259): turns rise in; `ToolSteps` (:163, disclosure :191) animates open and closed; Ledger look's "Thinking…" (:440-444) becomes dots plus a per-step status line from `turn.tools` (:131); the chat look gets dots only | `assistant/Transcript.test.tsx` |
| `chat/ChatPanel.tsx` | `THINKING_LINE` (:28) and the status (:243-244) become dots; messages rise in | `chat/ChatPanel.test.tsx`; e2e `m46-trip-chat` |
| `chat/ChatMessage.tsx` | your own message lands at once, faded while sending (:181), firm when saved | `chat/ChatMessage.test.tsx:116-120` (moves off `textContent`) |
| `chat/useTripChat.ts` | the sending state the fade reads | `chat/useTripChat.test.tsx` |
| `assistant/ProposalCard.tsx` | eases in; "applied" check settles in without a width change | `ProposalCard.test.tsx` |
| `assistant/SuggestedNote.tsx`, `board/SuggestionsChip.tsx` | ease in | their tests |
| `web/app/globals.css` | rise-in, disclosure and settle rules | — |

**Preview:** Ask a question on a trip. The dots run with a status line that changes per tool step,
the answer rises in, and the list glides down. Post in trip chat: your message lands faded and firms
up. `@assistant` shows dots, then its reply rises in.

## Part 8 — lists and small moments

| File | Entry point | Test |
|---|---|---|
| `home/TripCard.tsx` | hover lift and press | `home/TripCard.test.tsx` |
| `home/HomeScreen.tsx` | grid (:781): new trips animate in; optimistic delete (:369-410) animates out, and a failed delete animates back in | `home/HomeScreen.test.tsx`; e2e `m8-make-it-real` (delete menu :222-253) |
| `trip/UnscheduledRack.tsx` | opens and closes (:214); caret rotates instead of swapping (:139, :233-237) | `trip/UnscheduledRack.test.tsx`; e2e `m10-unscheduled-rack` |
| `board/RiverBlock.tsx` | hover shadow (:422) transitions; a moved block settles (FLIP) | `board/board.test.tsx`; e2e `m29-time-river`, `m41-plan-gestures`, `m41-calendar-drag` |
| `SaveLight.tsx` | a brief "saved" beat when breathing stops (`SaveLightMark` :92) | `SaveLight.test.tsx`; e2e `m6-unload-flush:186` |
| `home/NewTripWizard.tsx` | steps cross-fade (`NewTripWizard` :133) | `home/NewTripWizard.test.tsx`; e2e `m26-phone-surfaces`, `m25-trip-as-a-file` |
| `front/LandingSeaCells.tsx` + `globals.css` `sea-*` (:2069-2114) | lit cells transition rather than snap (`Cell` :290) | `front/LandingSea.test.tsx`; e2e `m42-demo-trips` (screenshots: check the baselines) |

**Preview:** hover and press a trip card on Home. Delete one and see it leave. Open and close the
unscheduled rack. Drag a stop on the river and see it settle. Make an edit and watch SaveLight
settle into "saved". Step through the new-trip wizard. Hover the landing's sea.

## Gate box → part

| Box | Part |
|---|---|
| Decisions 17–21 and ADR-082 | 0 |
| Motion has one home | 1 |
| A pending control keeps its box | 1 + 2 |
| Overlays enter and exit without holding the app up | 1 |
| Sliding indicators, lens cross-fade | 3 |
| No page freezes; route cross-fade; covers fade | 4 |
| Sign-in's cheer and the welcome moment | 5 |
| One avatar stack | 6 |
| Chat and Ask move | 7 |
| The small moments | 8 |
| Touched e2e specs pass on CI | every part |
| [walk] | Mitchell, on the parts' previews |
| Retro | 0 |
