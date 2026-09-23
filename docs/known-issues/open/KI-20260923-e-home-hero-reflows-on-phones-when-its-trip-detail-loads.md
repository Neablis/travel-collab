### KI-2026-09-23-e — Home's hero pushes *Other trips* down about 123px on a phone when its trip detail arrives

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
