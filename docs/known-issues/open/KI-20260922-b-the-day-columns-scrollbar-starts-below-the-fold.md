### KI-2026-09-22-b — the day-columns row scrolls horizontally, but its scrollbar starts ~200px below the fold

- **Severity:** usability defect on the desktop Plan surface. Nothing is broken
  in the code sense — the box scrolls correctly by every programmatic and
  keyboard route — but on a mouse-only desktop the one obvious pointer
  affordance for "scroll right" is off screen when the page loads.
- **Area:** `apps/web/src/components/board/Board.tsx` — the
  `[role="group"][aria-label="Day columns"]` box and everything that decides its
  height (`Column`'s content, the chrome above it). NOT `FocusProvider`'s
  day-sync machinery, which was suspected and cleared (below).

- **Symptom / What happens.** Mitchell, on PR #201's preview, 2026-09-22:
  *"I am no longer able to scroll right in the container with the actual day
  plans. I have to click in the above bar."* The "above bar" is `DayChips`.

- **Measured, 1920×919, dPR 1, a 14-day trip with 4–6 stops per day:**

  ```
  viewport height 919      document height 1181
  Day columns box : top 337  bottom 1117  height 780
                    scrollWidth 4476   clientWidth 1880   overflow-x auto
                    -> its scrollbar renders at y≈1117, 198px BELOW the fold
  Day chips rail  : top 243  bottom  312  height  69   fully on screen
                    scrollWidth 1880 == clientWidth 1880 (does not scroll at 1920px)
  ```

  The horizontal scrollbar sits at the bottom inside edge of a box that is
  taller than the remaining viewport, so it is only reachable after scrolling
  the page down ~262px. **It gets worse as day plans get longer** — the box's
  height is its tallest column, and the measurement above is of a deliberately
  thin trip.

  A plain vertical wheel over the box scrolls the *page* (`window.scrollY`
  0 → 262), which is the first gesture a reader makes. The routes that DO work
  are shift+wheel, the keyboard (the box is `tabIndex={0}`), and clicking a
  chip in the rail — which is exactly what Mitchell found, and note he said
  **click**, not scroll.

- **WHAT THIS IS NOT, so the next person does not re-run the investigation.**
  Driven in a real browser against the preview on 2026-09-22, ~100 measurements
  across six viewport/chrome configurations. All three standing hypotheses were
  tested and **all three are out**:

  1. **Not a scroll/selection feedback loop.** `useDayScrollSpy` and
     `useFollowFocusedDay` were suspected of fighting over the same box. They do
     not: a wheel moves `scrollLeft` once and it **stays** — sampled at 0/150/
     500/1000/2000 ms and out to 40 s (`0 → 900`, still 900 at t=40s, two scroll
     events total). Ten successive bursts step cleanly
     `300 600 900 1200 1500 1800 2100 2316 2316 2316`. The jump lock in
     `FocusProvider` is doing its job.
  2. **Not "the box is not scrollable".** `scrollWidth 4196 > clientWidth 1880`
     by 2316px, `overflow-x: auto` computed in every configuration measured.
  3. **Not an ancestor swallowing the event.** All nine ancestors up to `<html>`
     stayed at `scrollLeft: 0` with `overflow-x: visible`.

  **Also cleared: M13's polling.** `useTripBroadcast` refetching trip state on a
  remote change does not disturb the scroll position — verified locally with
  polling verifiably live (9 `/events` requests in 45s) across a remote
  `AddActivity`, `AddDay` (14→15 columns) and `RemoveDay` (15→14): `scrollLeft`
  held at 1200, 800 and 1700 respectively while the column count changed under
  it.

  **And it is not a regression from PR #201.** That was claimed on the PR and on
  the feedback thread and was **wrong**: it rested on `ffce992` (M26 link 13)
  and `7763913` (M23) not being on `origin/main`, which stopped being true when
  #200 merged and moved main to `62ab7bf`. PR #201's board diff is a deleted
  import, two deleted dead type members, and one conflict kind losing its
  dismiss button — nothing that moves a pixel of this layout.

- **NOT CONFIRMED, and this is the honest gap.** The geometry is measured; the
  *consequence* is inferred. Headless Chromium on Linux uses overlay scrollbars
  (`offsetHeight - clientHeight = 0`, and
  `--disable-features=OverlayScrollbar,FluentOverlayScrollbar,FluentScrollbar`
  did not change that), so the scrollbar itself could not be seen or dragged.
  Mitchell is on Windows Chrome with a mouse, where scrollbars are classic and
  a horizontal wheel does not exist.

  **The one question that settles it:** scroll the page down so the bottom edge
  of the day-plans block is visible — is there a horizontal scrollbar there, and
  does dragging it work? Yes ⇒ this entry. No ⇒ something trip-specific, and it
  needs a `?_vercel_share=` link for the reported trip, because nothing generic
  reproduces it.

- **Shape of a fix, once confirmed.** The box needs a scroll affordance that
  does not depend on its own bottom edge being on screen. Options, none costed:
  a sticky scrollbar; capping the box's height to the viewport and letting it
  scroll vertically too (careful — `overflow-x: auto` already forces `overflow-y`
  to compute as `auto`, and `Board.tsx`'s own comment records what that clipping
  cost the focus ring the last time); on-hover edge arrows; or making a plain
  vertical wheel over the box scroll it horizontally, which is what the reader
  appears to expect.

- **Prior art in the same file.** A near-identical report from Mitchell on
  2026-09-06 — *"impossible to scroll right all the way to day 14 … same with
  day 1"* — is what the `atStart`/`atEnd` slack in `Board.tsx`'s spy was added
  to fix. **That symptom is NOT back**: `scrollLeft = 0` names day 1 and
  `scrollLeft = max` names day 14, verified. Same words, different cause.

- **Found by:** Mitchell on PR #201's preview, 2026-09-22; investigated in a
  browser the same day.
- **First noted:** 2026-09-22.
