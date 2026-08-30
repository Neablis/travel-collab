### KI-46 — Below ~1100px the app is the desktop layout, not the designed mobile companion

- **Severity:** cosmetic (unusable rather than wrong — nothing is lost, but the
  trip header alone exceeds the viewport)
- **Area:** `apps/web/src/components/trip/TripHeader.tsx`,
  `TripMetaPill.tsx`, `lenses/TimelineLens.tsx`, `AppHeader.tsx`
- **Symptom (measured at 402×844):** the trip header consumes ~1130px of an
  844px viewport before any plan content — the meta pill wraps
  `Sat, Sep 5 – Fri, Sep 18` across five lines inside its rounded pill, and the
  title wraps to two lines at unreduced desktop size. Stop cards collapse: the
  title wraps, the right-hand cost column crushes into it, and `Ask`/`Edit`
  overlap the note box. All four lenses are still offered. At **1100×800 the
  app is fine** — the header cluster reflows to a single row and the timeline
  reads well — so the gap is entirely between those two widths.
- **Scope note:** the handoff's `Trip Planner Mobile.dc.html` + SPEC §10 design
  a *different* product (two lenses not four, a pinned day-rail spine, a bottom
  tab bar, a tag filter row, 44px targets, cards without the 92px time gutter).
  **Building that is a milestone, not a fix.** This entry is only the narrower
  claim that the current small-screen rendering is broken enough to be worth
  recording independently of whether the designed companion ever gets built.
- **Cross-reference:** KI-19 (the 1180px blind spot the `narrow` Playwright
  project exists to cover — it runs at 1100px, above this).
- **First noted:** 2026-08-26 (design-sync UI audit, C2).
