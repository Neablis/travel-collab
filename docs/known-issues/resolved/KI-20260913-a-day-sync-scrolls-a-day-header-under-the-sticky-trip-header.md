### KI-2026-09-13-a — picking a day from the chips row while the page is scrolled lands that day's header behind the sticky trip header — RESOLVED

- **Severity:** cosmetic, and narrow. Nothing is lost — the day's cards are on screen and the chip you just pressed is ringed — but the column's own title is the one line you cannot read.
- **Area:** `apps/web/src/components/trip/context/FocusProvider.tsx` (`jumpTo`'s `scrollIntoView`), reached from `apps/web/src/components/board/Board.tsx`'s `useFollowFocusedDay`. The occluding element is `apps/web/src/components/trip/TripHeader.tsx`'s `sticky top-14` header, with `AppHeader`'s `h-14` above it.
- **What is wrong:** `scrollIntoView` knows nothing about `position: sticky`. The scrollport's top edge is `y = 0`, not the bottom of whatever is pinned there, so aligning an element with the top of the scrollport puts it under the sticky stack. With the page scrolled down and a day picked in the chips row, the target day header is above the fold, `block: "nearest"` aligns its top edge with `y = 0`, and the two sticky bars (56px plus the trip header's own wrapped height) cover it.
- **How it came to light:** while fixing the arrival case Mitchell reported on the preview, 2026-09-13 (*"When you first switch to plan page, its half way scroll down the actual columns"*) — `e2e/m10-growth.spec.ts`'s "switching to Plan lands at the top of the columns". That fix changed the scroll target from the column to its header, which removes the page scroll on arrival entirely; this second case is the one the change leaves exactly as it was, so it is a pre-existing wart rather than a regression.
- **Why not fixed there:** the honest fix is `scroll-margin-top` on the scroll target equal to the height of the sticky stack, and that height is not a constant — `TripHeader` wraps at narrow widths, and `AppHeader` is absent on `/demo` (`isDemoTripId` swaps `top-14` for `top-0`). Making it right means publishing the measured height as a custom property from a `ResizeObserver`, which is real machinery and touches every sticky-adjacent surface, not just the day columns. That is a decision about the app's scroll geometry, not a line in this fix.
- **Scope:** measure the sticky stack once (header ref + `ResizeObserver`), expose it as a custom property on the document element, and set `scroll-margin-top` from it on the day-sync scroll targets (`[data-day-header]`, the calendar's cells). Then extend the walk above: pick a day from the chips row with the page scrolled down, and assert the day's name clears the sticky header's bottom edge — the same assertion that walk already makes on arrival.
- **First noted:** 2026-09-13, fixing the Plan-arrival scroll.
- **Reproduced (2026-09-25),** production build, 1280×720, ten days of six
  stops, Day 8 picked, page scrolled to `scrollY` 400, Right pressed on the
  focused chip: `a day picked with the page scrolled lands below the sticky
  header — Expected: >= 243.984375, Received: 60.671875`. The page did not
  move at all. That is a second mechanism the entry did not predict: at 400px
  the header sits *in* the scrollport but under the stack, where `nearest` is
  already satisfied and moves nothing. Scrolled to the bottom (header above
  the fold) it was aligned with `y = 0` as described, with the name at y=22.
- **Why `scroll-margin-top` alone did not fix it.** With the margin published
  and applied (computed `scroll-margin-top: 243.984px` on the header), the
  same test gave the same 60.67. Chromium clips the target's rect to each
  inner scroller's visible box before passing it to the next scroller out.
  The day columns row is a scroll container (it scrolls sideways, so
  `overflow-y` computes to `auto`), so the margin is cut off before the window
  sees it. Measured in the page: `block: "start"` put the header at y=12, not
  244.
- **Fix (2026-09-25):** the Scope's plan, plus the step the clipping needs.
  (1) `TripHeader` publishes `--sticky-stack-height` on the document element
  from a callback ref + `ResizeObserver`: its resolved `top` (56px, or 0 on
  `/demo` and an invite's look) plus its own height, removed on unmount.
  (2) `.day-sync-target { scroll-margin-top: var(--sticky-stack-height, 0px) }`
  in `globals.css`, on `Column`'s `[data-day-header]` and the calendar's
  in-trip cells. (3) `jumpTo` (`FocusProvider.tsx`, `clearStickyStack`)
  finishes the job on the page axis: after `scrollIntoView`, a target whose top
  is still inside its own `scroll-margin-top` is scrolled clear of it with
  `window.scrollBy`, only upwards and only by the overlap. Targets without the
  class (chips row, map strip) read a 0 margin and are untouched. Six code
  comments in `components/assistant/` and `home/NewTripWizard.tsx` that called
  this entry "an open bug" now say it was one.
- **Proof:** `e2e/m10-growth.spec.ts` "switching to Plan lands at the top of the
  columns" now continues with the scrolled-then-chip pick at two depths (400px,
  under the stack; the bottom, above the fold). Red with `clearStickyStack`
  removed from `jumpTo`, each depth run first: `400px down: … Received:
  60.671875` and `at the bottom: … Received: 22.671875`, both against `>=
  243.984375`. Green restored. `pnpm --filter web test:e2e:ci-like
  e2e/m10-growth.spec.ts` gave 7 passed. Probed on the same build: `/demo`
  publishes 155px (`top: 0` plus its header) and a pick from the bottom lands
  the header at y=155; a 411px phone publishes 305px, arrival and a chip at the
  top leave `scrollY` at 0, and a pick from 500px down lands the header at
  y=305.
- **Decision (2026-09-25 overnight sweep):** measure `TripHeader` alone rather
  than put a ref on each sticky bar. Its computed `top` already *is* the part
  of the stack above it, so one observer covers `/demo`, the invite look and
  the app. Complete the margin in `jumpTo` with a window scroll rather than
  (a) making the columns row not a vertical scroll container, which CSS does
  not allow while it scrolls sideways, or (b) a two-step jump (row sideways,
  then page vertically to a proxy element), which would split the one
  lock-guarded jump the contract relies on. The margin CSS stays, since it is
  what a browser honours natively where no inner scroller intervenes.
- **Resolved:** 2026-09-25.
