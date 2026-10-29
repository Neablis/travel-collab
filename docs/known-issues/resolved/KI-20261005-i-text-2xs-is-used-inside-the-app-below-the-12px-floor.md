### KI-2026-10-05-i — `text-2xs` (11px) is used inside the app, below the 12px floor — RESOLVED

- **Severity:** design-system drift. Small text across the signed-in app is harder to read, and
  nothing stops it from spreading.
- **Area:** `apps/web/src/components/**`, outside `components/front/` and the invite landing.
  `docs/guidelines/design-system.md` (the type scale, ~:28-50).
- **Symptom / What happens:** the design system gives `text-2xs` (11px) as **"Front door only"**:
  micro-labels in marketing illustrations. It says "12px stays the floor for anything a user reads
  rather than glances at." The front door is `app/(front)/**` and `components/front/**`. Yet
  33 uses sit in signed-in screens (`app/(app)/**`, which includes playbooks):
  - `components/ui/settings-card.tsx:40`
  - `components/ui/day-grid.tsx:236`
  - `components/lenses/OverviewLens.tsx:369`
  - `components/lenses/OverviewLens.tsx:373`
  - `components/trip/KeepDayDialog.tsx:202`
  - `components/trip/KeepDayDialog.tsx:214`
  - `components/trip/KeepDayDialog.tsx:477`
  - `components/assistant/ProposalCard.tsx:179`
  - `components/nav/PhoneTabBar.tsx:255`
  - `components/playbooks/SharedDayScreen.tsx:581`
  - `components/playbooks/SharedDayScreen.tsx:633`
  - `components/playbooks/SharedDayScreen.tsx:642`
  - `components/playbooks/SharedDayScreen.tsx:666`
  - `components/playbooks/PlaceSearch.tsx:79`
  - `components/playbooks/DiscoverCard.tsx:110`
  - `components/playbooks/DiscoverCard.tsx:144`
  - `components/playbooks/DiscoverCard.tsx:228`
  - `components/playbooks/SharedDayMap.tsx:377`
  - `components/playbooks/SharedDayMap.tsx:459`
  - `components/playbooks/DiscoverScreen.tsx:431`
  - `components/playbooks/DiscoverScreen.tsx:545`
  - `components/playbooks/DiscoverScreen.tsx:573`
  - `components/playbooks/ReviewsSection.tsx:160`
  - `components/playbooks/ReviewsSection.tsx:221`
  - `components/playbooks/ReviewRail.tsx:47`
  - `components/playbooks/ReviewRail.tsx:57`
  - `components/pages/editor/RepeatNodeView.tsx:96`
  - `components/pages/blocks/CityDetailBlock.tsx:52`
  - `components/pages/blocks/ItineraryTripBlock.tsx:75`
  - `components/pages/blocks/ItineraryTripBlock.tsx:86`
  - `components/pages/WidgetPicker.tsx:397`
  - `components/pages/WidgetPicker.tsx:472`
  - `components/pages/WidgetPicker.tsx:480`
  - PR #335 added two more, in `components/trip/people/PersonRow.tsx` (the "You" chip) and
    `PeopleSection.tsx` (group labels). Both were fixed in that PR (946835b): the chip is a
    `Badge`, the labels `text-xs`. They are not part of this entry.
  - Two more under the floor that do not use the token, so a grep for `text-2xs` misses them.
    Both are hand-rolled initials in an inline `style`, and both predate PR #335:
    - `components/home/TripCard.tsx:217`: 9px initials.
    - `components/home/NextTripHero.tsx:258`: 11px initials in a 30px circle.

    Each could adopt the `Avatar` primitive, which holds its initials at 12px below `lg`.
- **Why it happened:** no lint enforces the rule. `scripts/check-color-wall.mjs` checks colour and
  text-size tokens exist, not where the front-door-only ones are used. Each use copied a nearby one.
- **Fix:**
  1. Move each use to `text-xs` (12px), or to a real component (`Badge`, `Text`) where one fits.
     Check the layout at 390px afterwards: some of these are tight chips and tab labels
     (`PhoneTabBar`, `day-grid`).
  2. Add a wall: refuse `text-3xs`/`text-2xs` outside `components/front/**`, `app/(front)/**`
     and an explicit allowlist (the invite landing), so the floor is checked rather than remembered.
     Today `text-3xs` has no in-app uses, so the wall can cover both sizes from the start.
- **Cross-reference:** `docs/guidelines/design-system.md` type scale. Found by the M35 conventions
  audit (PR #335).
- **First noted:** 2026-10-05.
- **Resolved 2026-10-29 (KI sweep, UI focus) — every in-app use moved to 12px, and a wall keeps it there.**
  The list had drifted to 37 uses (re-grepped; `admin/AccountPage`, `admin/TierPanel` and
  `lenses/LensSkeletons` had joined). Each is `text-xs` now, or drops the class where a
  primitive already carries 12px (`DataText size="xs"`, `Badge`). The two inline-style
  initials the entry named (`TripCard`, `NextTripHero`) are no longer in the tree.
  - **Not moved, on purpose.** `DiscoverCard` is drawn by the front door's sea as well as by
    Discover: its chips and stop times keep `text-2xs` on the sea's branch only (`sea !== null`),
    which `m42-demo-trips.spec.ts`'s screenshots pin. The invite landing (`InviteLandingScreen`,
    `InvitePlanCard`, `InviteLookScreen`) is front door. **Still under the floor:** five
    `var(--text-2xs)` rules in `globals.css` for the notebook widget tables (`.tc-widget-*`),
    left for a change that walks those tables, since `globals.css` is outside this entry's area.
  - **Wall.** `scripts/check-type-floor.mjs`, in `pnpm lint`: `text-2xs`/`text-3xs` in a string
    literal anywhere in `apps/web/src` outside `app/(front)/**`, `components/front/**` and the
    files it names fails. Seen red on one reintroduced use (`PhoneTabBar.tsx:262: text-2xs`,
    `TYPE FLOOR WALL BREACHED: 1 use(s)`); against `origin/main`'s tree it reports all 37. Its
    test (`scripts/__tests__/check-type-floor.test.mjs`) seen red by dropping the invite landing
    from the allowlist. `design-system.md`, Enforcement item 5.
  - **PR 633 review.** The wall now also catches the custom property (`var(--text-2xs)`,
    `text-(length:--text-2xs)`) and inline `fontSize` under 12px, and holds `DiscoverCard` to its
    `sea !== null` branch rather than exempting the file. That found more in-app sizes under the
    floor: `Preview`'s 10px chip and `MapLegend`'s 11px text moved to `text-xs`; 15 inline
    handoff labels in seven map, calendar, chip and rack files are named in the wall as
    grandfathered (design-system.md, Enforcement 5), since 12px there needs a layout walk.
  - **Proof of layout.** Unit tests of the 14 touched components that have them: 439 passed.
    `m37-playbook-cover` (chips on a 390px card), `m42-demo-trips` (screenshots), `m14`,
    `responsive` and the other specs run with them on the built app: 126 passed.
