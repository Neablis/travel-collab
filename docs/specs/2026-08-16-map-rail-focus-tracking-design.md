# Map rail focus tracking — design

**Date:** 2026-08-16
**Branch:** `claude/trip-map-focus-tracking-0f3e75`
**Supersedes the scroll-focus mechanism added in** `d80ba9b` **and** `3b8e111`.

## Problem

`MapRail.tsx` drives which day the map lens focuses as the user scrolls the
rail. Live in the browser, scrolling through the middle of the rail keeps focus
pinned on Day 1; only the bottom scroll boundary correctly jumps to the last
day — and that path is separate `scrollTop` arithmetic, not the position
tracking. Two prior attempts fixed it against a green test suite and it stayed
broken.

## Root cause

Three defects, stacked, all of which have to be addressed or this regresses
again. A fourth — *Defect 4*, in the Design section — was found while checking
this spec's arithmetic; it is a flaw in the intended behaviour rather than in the
implementation, so it is documented where the corrected model is defined.

### 1. IntersectionObserver cannot report continuous position

`IntersectionObserver` delivers an entry **only when a ratio threshold is
crossed**. `entry.boundingClientRect` is a snapshot taken at that instant.
`MapRail.tsx:117` caches that snapshot into `geometryByIndex`; `evaluate()`
reads it later to compute center distance.

A button sitting at ratio 1.0 crosses no thresholds, so it receives no further
entries and its cached `centerY` freezes. With ~95px buttons in a ~600px rail,
five or six buttons are pinned at ratio 1.0 at any moment. **The distance math
compares positions the buttons held seconds earlier.** This is not a tuning
problem — the data source structurally cannot answer the question being asked
of it.

Staleness alone predicts focus sticking on whichever day was nearest the center
*at mount*, around Day 3 or 4.

### 2. IntersectionObserver does not deliver at all in a hidden tab

The exact reported symptom — Day 1, continuously — is what an **empty**
`geometryByIndex` produces: the candidate loop `continue`s on every day,
`closestIndex` stays `undefined`, and `MapRail.tsx:153` falls back to
`days[0]`. An empty map is what a tab reporting `visibilityState: "hidden"` /
`hasFocus: false` produces, because IO delivery is driven by the rendering
pipeline a hidden tab suspends.

Defects 1 and 2 are not competing explanations. #2 explains what was observed;
#1 means it would still be wrong once the tab was visible.

### 3. The test suite asserts the false assumption

Every scroll test in `MapRail.test.tsx` hand-feeds a fresh `boundingClientRect`
immediately before each `fireEvent.scroll`. That simulates the one thing a real
browser never does. The suite is green *because* it encodes the bug as correct
behavior. This is why two fixes shipped broken: the feedback loop was lying.

`IntersectionObserver` is used nowhere else in the app — only `MapRail.tsx`,
its test, and the `vitest.setup.ts` polyfill — so the whole fixture is deleted
with it rather than left as a trap.

## Non-goals

- **No third-party library.** `react-intersection-observer` wraps the same
  broken API. Scrollspy libraries assume `window` is the scroll root.
  `@tanstack/react-virtual` has the right measurement engine but brings
  virtualization the rail does not need, changing the DOM and breaking
  selectors. The math is ~30 lines; a library fixes neither root cause.
  Revisit `react-virtual` only if rails reach 50+ days.
- **No camera change.** `fitBounds({ animate: false })` stays, per Mitchell's
  standing decision that a focus change jumps rather than glides. Re-evaluate
  live once tracking works; do not pre-emptively change it.
- **No wheel hijacking.** `preventDefault` + `scrollTop += delta/n` destroys
  trackpad momentum, touch drag, keyboard PageUp/Down, and the scrollbar.
  Gearing must be built on a real native scroll container.
- **No scroll-into-view effect.** Would create a feedback loop with scroll
  tracking. Absent today; stays absent.

## Design

### Component structure

```
container   overflow-y:auto, height H          ← the only scroll container
  spacer    height S (geared travel)           ← invisible, creates scroll range
    track   position:sticky; top:0             ← compositor pins it to viewport
      button × N                               ← real buttons, natural flow
```

One native scroll container. The spacer manufactures real scroll travel; the
sticky track keeps the buttons pinned in the rail's viewport for free; the only
per-frame JS write is `transform: translateY(-v)` on the track.

Buttons live *inside* the scroller, so clicks, focus rings, and keyboard
navigation work untouched — this is the reason for one container rather than
two overlapping ones, where the invisible top layer would have to capture wheel
and touch while passing clicks through to the buttons behind it.

### Coordinate mapping

| Symbol  | Meaning                                            |
| ------- | -------------------------------------------------- |
| `H`     | `container.clientHeight` — rail viewport height     |
| `N`     | natural content height (sum of button heights)      |
| `T_in`  | `N - H` — natural scroll travel                     |
| `T_out` | `(days.length - 1) × scrollPxPerDay` — geared travel |
| `S`     | `H + T_out` — spacer height                         |
| `p`     | scroll progress: `clamp(scrollTop / T_out, 0, 1)`   |
| `v`     | natural-space offset: `p × T_in`                    |
| `L`     | focus line, natural-space: `v + H × lerp(start, end, p)` |

`T_out` uses `days.length - 1` deliberately: focus then advances **exactly one
day per `scrollPxPerDay` pixels of scroll**, so the constant means precisely
what its name says and tuning maps 1:1 to felt behavior.

### Defect 4: a fixed focus line cannot reach every day

Found while checking this spec's own arithmetic, and **independent of the three
root causes above** — it would survive a perfect fix to all of them.

With 14 × 95px buttons in a 600px rail there is only `1330 - 600 = 730px` of
natural travel, but a day change requires 95px of it. That affords ~8 day
changes to cover 14 days. Sweeping a *fixed* centre line across the full scroll
range visits only **days 4 through 11**; days 2, 3, 12 and 13 are unreachable at
any scroll position, and days 1 and 14 only appear because boundary forcing
hard-codes them. Verified numerically, not estimated.

Gearing does not help. Gearing changes how much user input maps to the travel,
not how many distinct focus states exist within it.

The fix is to let the focus line **sweep** the rail's viewport as scroll
progresses rather than sitting fixed at its centre. With `start = 0`, `end = 1`:

```
L = v + H×p = T_in×p + H×p = p × N
```

The line traverses the entire content, so every day gets an equal share of the
scroll range. It also stays geometrically honest throughout: at `p = 0` the line
sits at the rail's top, which is exactly where Day 1 is; at `p = 0.5` it is at
the centre; at `p = 1` it is at the bottom, where the last day is. The focused
day is always a day genuinely under the line on screen.

Boundary forcing consequently stops being load-bearing — at `p = 0` and `p = 1`
the sweep already selects the first and last day. It is retained only as a
cheap no-op safety net against sub-pixel error at the extremes.

**Degenerate case:** when `N <= H` the rail does not overflow naturally — every
day is already visible and there is nothing to scroll to. Gearing switches off
entirely and it renders as a plain list. No spacer, no transform, no
manufactured travel.

### Selection: a pure function

New `mapRailFocus.ts`:

```ts
export type RailItem = { index: number; offsetTop: number; height: number };
export type RailGeometry = {
  items: RailItem[];
  viewportHeight: number;  // H
  contentHeight: number;   // N
  offset: number;          // v, natural-space, clamped
  progress: number;        // p, 0..1, clamped
};
export function pickFocusedDay(g: RailGeometry, t: MapRailTuning): number | null;
```

Logic, in order:

1. No items → `null`.
2. `maxOffset = max(0, contentHeight - viewportHeight)`.
3. `maxOffset > 0 && offset >= maxOffset - boundaryEpsilonPx` → last item.
4. `maxOffset > 0 && offset <= boundaryEpsilonPx` → first item.
5. Otherwise sweep the focus line:
   `L = offset + viewportHeight × lerp(focusLineStart, focusLineEnd, progress)`.
   Among items overlapping the visible band (`offsetTop + height > offset` and
   `offsetTop < offset + viewportHeight`), pick the one minimising
   `|offsetTop + height/2 - L|`. Ties resolve to the lower index.

Steps 3–4 are a no-op safety net at the default `focusLineStart: 0` /
`focusLineEnd: 1`, where the sweep already selects the first and last day at the
extremes. They become load-bearing again only if those knobs are narrowed during
tuning — see *Defect 4* above and the Tuning section below.

The visible-band restriction still matters: it prevents an item from being
selected when the sweep line has run past the end of the rendered content.

Plain numbers in, index out. No DOM, no observers, no mocks — this is the piece
that was previously untestable.

### Measurement replaces observation

`MapRail` caches each button's `offsetTop`/`offsetHeight` and the container's
`clientHeight` in a ref, refreshed by a `ResizeObserver` on the container and
the track. That covers mount, font load, day-content change, and the assistant
rail toggling.

On each scroll event, throttled at `scrollThrottleMs` (leading + trailing,
unchanged semantics):

1. Read `container.scrollTop` **synchronously**.
2. Compute `v`, call `pickFocusedDay`, emit via `onFocus` if the index changed.

Separately, coalesced into one `requestAnimationFrame`, write the track
transform.

**The focus math stays off `requestAnimationFrame` deliberately.** rAF is
suspended in a hidden tab; routing focus through it would reintroduce defect #2.
Scroll events fire regardless of visibility, and both paths read the same
`scrollTop`, so they stay consistent.

Preserved invariants, all previously reviewed: leading+trailing throttle (not a
debounce — focus jumps live while scrolling), no emit on mount, no re-emit while
the same day stays dominant, no scroll-into-view feedback loop.

### Sticky verification

A zero-height `position: sticky` box whose children overflow it should pin at
the container's top and clip against the container. This is asserted nowhere and
**must be confirmed live**, not assumed.

Fallback if it misbehaves: `position: absolute` track with
`translateY(scrollTop - v)` — the `scrollTop` term cancels the container's own
scroll in JS rather than via the compositor. Definitely works, marginally more
jitter-prone because the pinning is no longer compositor-driven.

## Tuning

All knobs live in one module, `mapRailTuning.ts`, and are adjustable **live in
the browser without a rebuild**. Finding the UX sweet spot is expected to take
several passes; a rebuild between each would make that painful.

```ts
export type MapRailTuning = {
  scrollPxPerDay: number;    // 240 — scroll travel per day of focus change
  focusLineStart: number;    // 0   — focus line position at scroll start (0 = rail top)
  focusLineEnd: number;      // 1   — focus line position at scroll end (1 = rail bottom)
  scrollThrottleMs: number;  // 50  — how often focus re-evaluates
  boundaryEpsilonPx: number; // 4   — top/bottom boundary tolerance
};
```

`focusLineStart`/`focusLineEnd` are the sweep. Setting both to `0.5` recovers the
old fixed-centre behaviour — useful for seeing *Defect 4* directly in the
browser, and the reason the knob is a pair rather than a boolean. Narrowing them
(e.g. `0.15`/`0.85`) keeps the focus line away from the extreme edges at the cost
of making boundary forcing load-bearing again.

### Live override

In development only, guarded by `process.env.NODE_ENV !== "production"`:

```js
__tuneMapRail({ scrollPxPerDay: 320 })   // applies immediately — no reload
__tuneMapRail()                          // prints current values
__tuneMapRail(null)                      // reset to defaults
```

The setter stores the override, re-measures, and rewrites the spacer height and
transform in place. Values are read on each measure pass rather than captured in
a closure, so nothing is stale after a change. The pure function stays pure —
tuning is read at the component boundary and passed in as an argument.

### What to turn, and which way

| Symptom                                                        | Knob                | Direction |
| -------------------------------------------------------------- | ------------------- | --------- |
| Days blur past; hard to land on the one you want                | `scrollPxPerDay`    | ↑ raise   |
| Rail feels sluggish; too much scrolling to cross the trip       | `scrollPxPerDay`    | ↓ lower   |
| Some days can't be landed on at all                             | widen `focusLineStart`→`focusLineEnd` toward `0`/`1` |  |
| Focused day sits awkwardly near the rail's very top or bottom   | narrow toward `0.15`/`0.85` |  |
| Focus changes feel late — you're past a day before it activates | shift both down (e.g. `-0.1` each) |  |
| Focus changes feel early / anticipatory                         | shift both up       |           |
| Focus stutters between two days on a slow scroll                | `scrollThrottleMs`  | ↑ raise   |
| Focus lags visibly behind the scroll                            | `scrollThrottleMs`  | ↓ lower   |
| First or last day hard to reach at the extremes                 | `boundaryEpsilonPx` | ↑ raise   |

**Sane ranges.** `scrollPxPerDay` 120–500 (below ~120 defeats the purpose;
above ~500 a 14-day trip needs an unreasonable amount of scrolling).
`focusLineStart` 0–0.3, `focusLineEnd` 0.7–1.0, and **keep the span wide** —
`end - start` below ~0.6 starts making days unreachable again on a 14-day trip.
`scrollThrottleMs` 16–100. `boundaryEpsilonPx` 2–12.

**Coverage check while tuning.** After changing the focus-line knobs, confirm
every day is still reachable — scroll slowly end to end and watch that
`aria-current` visits each day in turn. This is the failure mode *Defect 4*
describes, and it is invisible unless specifically looked for: the rail still
feels responsive while quietly skipping days.

**Starting point:** `scrollPxPerDay: 240`, roughly 5× the current ~52px/day,
targeting the "1–2 seconds per day at a deliberate pace" Mitchell described.
This is a calculated starting point, **not a validated one** — tune it live
against the 14-day Japan fixture before treating it as settled.

**Procedure.** `pnpm db:reseed`, open the trip's map lens, scroll the rail at a
natural pace, and adjust with `__tuneMapRail` until landing on a specific day
feels easy without the rail feeling slow. Then commit the settled value as the
new default in `mapRailTuning.ts`.

Tune `scrollPxPerDay` **first and alone**, with the focus-line knobs left at
their `0`/`1` defaults. It is the knob that governs how the rail feels; the
others correct specific defects and should only be touched if one of the
symptoms in the table above actually shows up.

## Testing

Ordered by what each layer can actually catch.

**1. Playwright e2e — the primary gate.** New spec, real browser, real layout,
real scroll. This is the only layer that could have caught the original bug, and
its absence is why this shipped broken twice. Asserts:

- focus advances through **consecutive** days during a mid-rail scroll (the
  specific thing that failed — not merely "focus changed");
- **every day is reachable** — a slow scroll from top to bottom visits all 14
  days of the fixture, none skipped (guards *Defect 4*);
- the last day is reached at the bottom boundary;
- the first day is reached at the top boundary;
- gearing holds: scrolling `scrollPxPerDay` pixels advances focus by ~1 day.

**2. Pure-function unit tests** — `mapRailFocus.test.ts`, real numbers, no DOM:
sweep selection, both boundary branches, single day, no-overflow, exclusion of
non-overlapping items, tie resolution, and a **coverage property test** — for a
14×95px/600px rail, sweeping `progress` 0→1 must yield all 14 indices. That last
one is the regression test for *Defect 4* and would have failed the design as
originally approved. `fast-check` is already a dependency if a generative form is
preferred over a fixed sweep.

**3. Rewritten `MapRail.test.tsx`** — inject a static layout once via
`Object.defineProperty` (jsdom reports 0 for all layout), then `fireEvent.scroll`
at varying `scrollTop`. Truthful: a fixed layout scrolled through, rather than a
fresh rect hand-fed per event. Retains click-to-focus, accent/tint rendering, and
the no-emit-on-mount assertions unchanged.

**4. Deletions** — `triggerIntersection` and the `IntersectionObserver`
polyfill leave `vitest.setup.ts` entirely.

## Files

| File                        | Change                                              |
| --------------------------- | --------------------------------------------------- |
| `mapRailTuning.ts`          | new — knobs, types, dev live-override                |
| `mapRailFocus.ts`           | new — pure `pickFocusedDay`                          |
| `mapRailFocus.test.ts`      | new — pure unit tests                                |
| `MapRail.tsx`               | rewrite scroll effect; spacer + sticky track; drop IO |
| `MapRail.test.tsx`          | rewrite scroll tests; drop `triggerIntersection`     |
| `vitest.setup.ts`           | delete IO polyfill and `triggerIntersection`         |
| `e2e/m10-map-rail.spec.ts`  | new — real-browser scroll tracking                   |
| `MapLens.tsx`               | unchanged                                            |

## Definition of done

- Scrolling the rail mid-range advances focus through consecutive days in a real
  browser — verified by watching it, not only by a green suite.
- **All 14 days of the fixture are reachable by scrolling**, none skipped.
- Top and bottom boundaries reach first and last day.
- `scrollPxPerDay` tuned live against the 14-day Japan fixture and the settled
  value committed as the default.
- Sticky pinning confirmed live, or the absolute fallback adopted and the reason
  recorded here.
- Playwright spec passes against a production build; unit suites pass.
- `IntersectionObserver` no longer appears anywhere in `apps/web/src`.
