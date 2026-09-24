### KI-2026-09-23-e — Home's hero pushes *Other trips* down about 123px on a phone when its trip detail arrives — RESOLVED

- **Severity:** cosmetic. It is a layout jump rather than wrong data, but it
  lands under the thumb on the page every session opens on.
- **Area:** `apps/web/src/components/home/NextTripHero.tsx:314` (the sparkline's
  `sparkline.status === "loading"` branch) and the action line beneath it.

- **Symptom:** while the hero's `TripDetail` is loading, the sparkline slot
  holds a `Loading…` string in a fixed 96px box. The real sparkline is 188.6px
  tall, and the one actionable line appears only once the detail lands. At a
  390px viewport, *Other trips* moves from y=761.4 to y=884.1 (**122.75px**) when
  it arrives. At 1440px it moves 0.19px, because the left column sets the card's
  height there, so this happens on phones only.
- **How it was found:** M27 link 10's follow-up, 2026-09-23, measuring the
  notebooks-menu placeholder fix across the other surfaces M27 touched.
  Screenshots `home-hero-sparkline{,-390}-{loading,ready}.png` were in that
  session's scratchpad and are not kept.
- **Why it was not fixed with the notebooks menu:** that fix sized placeholder
  rows to a known row height. The hero's real height is not fixed: the
  city-pill row wraps with the trip's city count, and the action line exists
  only for some trips. That makes this a reserved-height change of the
  KI-28/KI-56 kind, which is wider than a placeholder swap.
- **Fix path:** reserve the sparkline's real height (188.6px at the phone
  breakpoint) for the loading state, instead of 96px. Give the action line a
  one-line reserved slot while loading. Leave the pill-row wrap as the one
  remaining shift, or reserve it from the trip summary's city count, which Home
  already has before the detail loads. Measure with the same 390px probe
  before and after.
- **Cross-reference:** `KI-2026-09-20-e` (bare `Loading…` strings),
  `docs/milestones/M27-simplify-pass.md` (§35.2, the hero).
- **First noted:** 2026-09-23.
- **Resolved:** 2026-09-24. The 122.75px was two jumps. **The sparkline:** the
  real `Sparkline` is the 96px well + 6 + a 16.2px day-number row + 12 + one
  26.2px city-pill row (156.4px), and the seeded trip wraps a second pill row
  (+32.2 = 188.6). The loading box was the well alone. It is now
  `SparklineSkeleton` (`HomeSkeletons.tsx`), which is the Sparkline's own
  stack: the well with the artboard's bars, a reserved day-number row, and
  one row of pill bones. **The action line:** on a phone, "N not booked yet"
  wrapped under *Open trip* after the detail landed (12 + 18.2 = 30.2px).
  Below `md`, the actionable line now gets its own full-width slot at the 44px
  phone floor, and holds a bone while the detail loads. A trip with nothing to
  do gives that slot back once it knows. From `md` up the line is unchanged.
  **Not reserved, on purpose:** a second pill row. `TripSummary` carries no
  city data at all, which corrects this entry's fix path. The
  wrap also depends on how long the city names are, so it cannot be predicted
  before the detail lands. The same goes for the error and "No days yet"
  states, which settle 60px shorter.
  Reproduced first with a new e2e test, `e2e/responsive.spec.ts`, *the hero
  keeps its height when its trip detail lands at 390px*. It uses a fresh
  account so the hero is the test's own trip. It holds `GET
  /api/trips/:id`, measures the hero, releases the request, and measures again.
  Against the unfixed hero: `Received: 90.5625` (60.4 sparkline + 30.2 action
  line; this trip has one pill row). Against the fix it passes (< 1px) in
  `test:e2e:ci-like --project=narrow -g KI-`, 7/7 alongside KI-56's hero and
  card reservations. It goes red on each half alone: `60.375` with only the
  old sparkline box put back, and `56.375` with only the action-line
  reservation removed.
