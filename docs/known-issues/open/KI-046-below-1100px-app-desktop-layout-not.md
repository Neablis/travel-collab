### KI-46 — Below ~1100px the app is the desktop layout, not the designed mobile companion

- **Severity:** cosmetic (unusable rather than wrong — nothing is lost, but the
  trip header alone exceeds the viewport)
- **Area:** `apps/web/src/components/trip/TripHeader.tsx`,
- **Re-measured 2026-09-24 (production build of `0c45caf`, 390/820/1024px) — the claims below no longer reproduce; keep open only until a real-phone walk confirms, then resolve.** At 390px Plan shows one day at full width, stop Edit/Remove are 44×44, only 3 of 44 phone Plan controls are under 44px, and no page scrolls sideways at any width. The one broken thing the check found — the stop editor wider than its sheet, Save off-screen — was fixed the same day (`.activity-editor-grid` stacks below 768px; `m26-phone-plan.spec.ts` *"fits the stop editor inside the phone, with Save on screen"*). What remains is filed separately and is not this entry's claim: KI-2026-09-24-i (phone header height), -j (tablets get the desktop layout with mouse-sized targets — the 768–1100px band this entry called fine), -k (Calendar clips), -l (tab bar marks Plan on Overview), -m (20px tag chips).
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

- **RE-MEASURED AND ADDRESSED 2026-09-20 at 390x844** (M26 link 13), through
  Playwright against a production build. **The surviving symptom is gone, and
  its cause had already moved once before this link touched it.**

  | | 2026-09-05 (412px) | 2026-09-20, before | 2026-09-20, after |
  |---|---|---|---|
  | Card width | 364px | 241px | **315px** |
  | Text column | **82px** | 141px | **215px** |
  | That title's card height | 121px | 131px | **91px** |
  | A stop's row controls | 42x28 / 43x28 | 32x32 | **44x44** |

  *The 92px time gutter was already gone, and nobody did it.* It went out with
  the Timeline lens (SPEC §24 deletes it), which took the text column from 82px
  to 141px as a side effect. This entry's "cards without the 92px time gutter"
  point was satisfied by a deletion made for another reason.

  *What was left was a DESKTOP constant leaking through a breakpoint nobody
  drew.* `DAY_COLUMN_WIDTH_PX` is a fixed 268px at every width, inside a
  horizontally scrolling row, so a 390px phone was showing one and a bit day
  columns side by side and the card had shrunk to 241px. The card was narrow
  because of a layout constant, not because the screen is.

  *The fix is SPEC §13.4, which the build already had every piece of:* "a phone
  can hold one day at a time; the rail is how you change which". Plan now
  renders the focused day alone at full width — same `Column`, same cards, same
  drag logic, a count of one. `DayChips` was already that rail and
  `FocusProvider` already held the selection across Plan, Map and Notebook.

  *And the 44px half is no longer 91%.* A stop's own Edit and Remove were 32x32,
  under §13.1's floor — M26 link 14's pass covered chrome and these live inside
  a card, so it never reached them. `PHONE_TOUCH` was widened to both axes
  (it was height-only, which is exactly half a target for an icon-only control)
  and applied here.

  *And the 44px census, taken the same way.* KI-046's **191 of 211 (91%)** was
  one trip screen at 412px. Re-taken across seven phone routes at 411x852:
  **48 of 91 (53%) before the sweep, 4 of 91 (4%) after.** The denominators are
  not comparable — this entry says the same of its own two figures — but both
  say the same thing, and the four that remain are MapLibre's own legally
  required attribution, which the library styles.

  The sweep reached them through three primitives rather than N call sites:
  `buttonVariants`' base and `Input`'s base carry §13.1's floor with
  `md:min-h-0` releasing it at the same 768px line every other phone rule in
  this app draws, and `PHONE_TOUCH` covers the elements styled like controls
  without being them — a segmented option, a nav link, a row link.

  **This entry can close** once somebody walks a phone: everything it still
  claimed is now measured otherwise, and two specs keep measuring it
  (`e2e/m26-phone-plan.spec.ts`, `e2e/m26-phone-targets.spec.ts`). Left open
  pending that walk rather than closed on numbers I took myself.

- **Cross-reference:** KI-19 (the 1180px blind spot the `narrow` Playwright
  project exists to cover — it runs at 1100px, above this).
- **First noted:** 2026-08-26 (design-sync UI audit, C2).
