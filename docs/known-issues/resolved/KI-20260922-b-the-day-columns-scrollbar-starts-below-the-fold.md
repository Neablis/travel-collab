### KI-2026-09-22-b — the day-columns row scrolls horizontally, but its scrollbar starts ~200px below the fold — RESOLVED

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

- **STILL UNCONFIRMED after the thread was resolved.** Mitchell resolved the
  Vercel feedback thread on 2026-09-22 **without answering the question above**.
  A resolved thread is not a confirmed diagnosis: it clears the
  `Vercel Preview Comments` check and says he is done with the report, and it
  says nothing about whether the scrollbar is what he was missing. The question
  is still the cheapest way to settle this, and it is still unanswered.

- **Found by:** Mitchell on PR #201's preview, 2026-09-22; investigated in a
  browser the same day.
- **First noted:** 2026-09-22.
- **Reproduction (2026-09-25, before the fix):** a Playwright walk at
  1920×919 on a 14-day trip with 6 stops a day measured the Day columns box at
  `top 437.7, bottom 1217.8` in a 919px viewport, with `scrollWidth 4196 >
  clientWidth 1880`, `overflow-x auto`, and a 39px unscheduled rack fixed along
  the bottom edge. The row's own scrollbar was 299px below the fold on load:
  `Expected: <= 919, Received: 1217.84375`.
- **Fix (2026-09-25):** a stand-in scrollbar pinned to the viewport bottom.
  `Board.tsx` renders an empty `overflow-x: auto` div (`day-columns-scrollbar`,
  `aria-hidden`, `tabIndex={-1}`) directly under the row, the same width, with a
  spacer that a `ResizeObserver` keeps as wide as the row's `scrollWidth`. The
  two mirror `scrollLeft` both ways. An `echoes` counter makes the bar ignore
  the scroll events its own mirrored writes raise, so a smooth day-sync
  `scrollIntoView` on the row is not pulled back a frame. `globals.css` hides
  the row's native bar (`.day-columns-row`) and makes the stand-in
  `position: sticky; bottom: var(--rack-height)`. It stays above the rack
  while the row runs past the fold and settles directly under the row once
  the row's bottom is on screen. The stand-in is not rendered on the phone's
  one-day board (`oneDay`), so nothing changes below `md`.
- **Proof:** new e2e `m10-growth.spec.ts` › "the day columns' scrollbar is on
  screen on load, even when the columns run past the fold". It uses the
  reproduction's shape, asserts the row's bottom really is past the fold, then
  checks that the bar's bottom edge sits above the rack, the bar's scroll range
  equals the row's, a bar scroll moves the row (page `scrollY` stays 0), and a
  row scroll moves the bar. Red-checked twice. Without `position: sticky` it
  failed with `the scrollbar's bottom edge is above the rack — Expected: <=
  880.3125, Received: 1218.84375`. Without the bar-to-row write it failed with
  `Expected: 900, Received: 0`. Restored, it passed. Checks: `pnpm --filter
  web exec tsc --noEmit`, `eslint` on the two changed TS files, the colour wall,
  `board.test.tsx` + `TripBoardScreen.test.tsx` (94/94), and
  `pnpm test:e2e:ci-like e2e/m10-growth.spec.ts e2e/m1-board.spec.ts` from
  `apps/web`, 9/9 passed. The second spec covers drag-and-drop and
  scroll-to-either-end in the same row.
- **Decision (2026-09-25 overnight sweep):** a sticky stand-in scrollbar. The
  owner's one confirming question, whether the bar at the row's bottom is what
  he was missing, is still unanswered. The fix is justified by the measured
  geometry alone, since a pointer affordance that starts 299px below the fold
  is a defect either way. Rejected:
  (a) **Capping the row's height to the viewport**, so the columns scroll
  vertically inside it. That turns every vertical wheel over the board into
  a nested scroll. It also needs a measured top offset (the chrome above
  varies with banners and the tag-focus line), and it breaks drag-and-drop to
  a card below the cap. `autoScrollWindowForElements` scrolls only the
  window, so that would also need an element auto-scroller. It also changes
  what `m10-growth`'s "lands at the top of the columns" measures.
  (b) **On-hover edge arrows.** New visible chrome and a design call, not a
  fix to an existing affordance.
  (c) **Remapping a vertical wheel over the row to horizontal scroll.** That
  hijacks the page's primary scroll gesture over most of the screen, and a
  reader could no longer scroll down to see a long day.
  **Known limit:** where scrollbars are overlay (macOS, headless Chromium),
  the stand-in is as invisible as the native bar was. Those platforms have
  a horizontal trackpad gesture anyway, and a real Windows mouse is the case
  this is for. It is still unverified by eye on Windows; a preview check there
  is the remaining confirmation.
- **Review follow-up (2026-09-25, PR #234: "replace `echoes` with a driver model"), NOT REPRODUCIBLE in Chromium, so the counter was kept.** The finding said the row's scroll event lands a frame after the bar's, so it pulls the thumb back and uses up the next real bar event as an echo. Logged in the ci-like lane, every row event fired in the same frame and dispatch pass as the bar event that caused it (`f63 bar-scroll row=600 bar=60` / `f63 row-scroll row=60 bar=60`), so `echoes` goes back to 0 each frame. That held for per-frame writes, a pointer-driven drag with 20 `mouse.move` steps, `mouse.wheel` over the bar and the row, smooth `scrollIntoView` and "Add a day" ×3. None stepped back or lost a step. The counter is still needed, for a different reason than the old comment gave. With it removed, a smooth `scrollIntoView` stopped at `scrollLeft` 3 of 2316. The bar's write-back cancels the animation, even at the same value. `Board.tsx`'s comment now says so. New e2e `m10-growth.spec.ts` › "dragging the day columns' scrollbar moves the columns with it, never back a frame" samples a held-button bar drag every frame. It asserts neither side moves backwards and both end where the drag stopped. Red-checked by delaying the row-to-bar mirror by one frame, the finding's own mechanism: `both end where the drag let go — Expected {bar: 960, row: 960}, Received {bar: 900, row: 900}`. Restored, it passed. The mechanism may be real in a browser that sends scroll events raised during dispatch in the next frame. Firefox on Windows also draws classic scrollbars. No Playwright project here runs Firefox, so that is unverified.
