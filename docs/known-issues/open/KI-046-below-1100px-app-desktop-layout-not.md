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
- **RE-MEASURED 2026-09-05 at 412×856** (branch
  `claude/caesura-phone-mobile-design-dcb4b9`, after PR #143 and the SPEC §23
  build, with the phone day-1 default in flight). **Two of the three symptoms
  above are gone; one is not, and the entry stays open for it.**

  *Gone — the trip header.* It measures **337px**, not the ~1130px recorded
  above. The meta pill no longer renders on a phone at all
  (`trip-meta-row` is `hidden … md:flex`, computed `display: none`), so the
  five-line date wrap it described cannot occur; SPEC §23 replaced it with a
  single-line range, measured at 20px tall — `Tue, Sep 15 – Mon, Sep 28`.

  *Gone — "all four lenses are still offered".* The lens strip is `hidden
  md:block` below 768px under SPEC §10's two-views rule (PR #143).

  *Not reproducible — the overlap.* "the right-hand cost column crushes into it,
  and `Ask`/`Edit` overlap the note box" was hit-tested across the first three
  Timeline cards: `Ask`↔`Edit`, `Edit`↔note, `Ask`↔note and title↔`Edit` all
  return **false**. Nothing overlaps.

  *Still true, and now the whole of this entry.* **The text column is starved.**
  On a 412px viewport the card spans ~364px, and the stop's title and note get
  **82px** of it (x 165→247) — the rest is the time gutter on the left and the
  `Ask`/`Edit` cluster on the right. A one-line note wraps to **121px tall** in
  that column. That is the design's "cards without the 92px time gutter" point
  in the scope note above, and it is a layout question, not a token question.
  Alongside it, **191 of 211 interactive controls are under 44px (91%)** —
  `Ask` and `Edit` are 42×28 and 43×28, `Add stop` and `History` 36px tall. The
  earlier 189-of-209 figure was taken at 412×893, so the two counts are not
  directly comparable; both say the same thing. `Button`'s `touch` size exists
  and is still essentially unused outside the §23 pill.

- **Cross-reference:** KI-19 (the 1180px blind spot the `narrow` Playwright
  project exists to cover — it runs at 1100px, above this).
- **First noted:** 2026-08-26 (design-sync UI audit, C2).
