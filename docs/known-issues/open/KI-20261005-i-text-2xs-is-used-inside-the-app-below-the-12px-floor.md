### KI-2026-10-05-i — `text-2xs` (11px) is used inside the app, below the 12px floor

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
    `PeopleSection.tsx` (group labels). Those are being fixed in that PR, and are not part of
    this entry.
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
