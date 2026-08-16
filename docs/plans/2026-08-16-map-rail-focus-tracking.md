# Map Rail Focus Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map rail's scroll-driven day focus actually work in a real browser — advancing through every day one at a time — and make landing on a specific day easy by gearing the rail's scroll.

**Architecture:** Replace `IntersectionObserver` (which cannot report continuous position, and delivers nothing at all in a hidden tab) with synchronous offset measurement cached in a ref and refreshed by a `ResizeObserver`. Extract day selection into a pure function over plain numbers so it is testable without DOM mocking. Add scroll gearing via one native scroll container with a tall invisible spacer and a sticky, transformed track. Isolate all feel constants in a live-tunable module.

**Tech Stack:** React 19, Next 15 (App Router), TypeScript, Tailwind v4, Vitest + @testing-library/react (jsdom), Playwright, maplibre-gl.

**Spec:** `docs/specs/2026-08-16-map-rail-focus-tracking-design.md`. Read it first — it carries the full root-cause analysis and the tuning guide.

## Global Constraints

- Package manager is **pnpm**. All commands run from `apps/web/`.
- Unit tests: `pnpm test` (config `vitest.unit.config.ts`). E2E: `pnpm test:e2e`.
- Lint: `pnpm lint`. Types: `pnpm typecheck`. Both must pass before every commit.
- The rail must remain **pixel-identical** to today. No visual change is in scope.
- **No new dependencies.** The spec rejects `react-intersection-observer`, scrollspy libraries, and `@tanstack/react-virtual` with reasons — do not add any of them.
- `apps/web/eslint.config.mjs` forbids raw CSS values via `no-restricted-syntax`. Every inline `style` needs an `// eslint-disable-next-line no-restricted-syntax --` comment giving the reason, matching the existing pattern in `MapRail.tsx`.
- Do **not** change `MapLens.tsx`. `fitBounds({ animate: false })` stays as-is by explicit decision.
- Do **not** add a "scroll the focused day into view" effect — it would feed back into scroll tracking.
- Preserve these reviewed invariants: leading+trailing throttle (not a debounce), no `onFocus` emitted on mount, no re-emit while the same day stays focused.
- Commit after every task. Conventional Commits, scope `web`.

---

### Task 1: Tuning module

The single home for every "feel" constant, live-adjustable from the browser console so the sweet spot can be found without a rebuild.

**Files:**
- Create: `apps/web/src/components/lenses/mapRailTuning.ts`
- Test: `apps/web/src/components/lenses/mapRailTuning.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type MapRailTuning`, `MAP_RAIL_TUNING_DEFAULTS`, `readMapRailTuning(): MapRailTuning`, `setMapRailTuning(next: Partial<MapRailTuning> | null): MapRailTuning`, `onMapRailTuningChange(fn: () => void): () => void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/lenses/mapRailTuning.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAP_RAIL_TUNING_DEFAULTS,
  onMapRailTuningChange,
  readMapRailTuning,
  setMapRailTuning,
} from "./mapRailTuning";

afterEach(() => {
  setMapRailTuning(null);
});

describe("mapRailTuning", () => {
  it("reads the defaults when nothing is overridden", () => {
    expect(readMapRailTuning()).toEqual(MAP_RAIL_TUNING_DEFAULTS);
  });

  it("merges a partial override over the defaults", () => {
    setMapRailTuning({ scrollPxPerDay: 320 });

    expect(readMapRailTuning().scrollPxPerDay).toBe(320);
    expect(readMapRailTuning().scrollThrottleMs).toBe(MAP_RAIL_TUNING_DEFAULTS.scrollThrottleMs);
  });

  it("resets to the defaults when passed null", () => {
    setMapRailTuning({ scrollPxPerDay: 320 });
    setMapRailTuning(null);

    expect(readMapRailTuning()).toEqual(MAP_RAIL_TUNING_DEFAULTS);
  });

  it("notifies subscribers on change, and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onMapRailTuningChange(listener);

    setMapRailTuning({ scrollPxPerDay: 320 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setMapRailTuning({ scrollPxPerDay: 400 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("defaults the focus line to a full sweep, which is what reaches every day", () => {
    expect(MAP_RAIL_TUNING_DEFAULTS.focusLineStart).toBe(0);
    expect(MAP_RAIL_TUNING_DEFAULTS.focusLineEnd).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mapRailTuning`
Expected: FAIL — `Failed to resolve import "./mapRailTuning"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/lenses/mapRailTuning.ts`:

```ts
// Every "feel" constant for the map rail's scroll-driven focus lives here, in
// one place, so the UX sweet spot can be found by turning knobs rather than by
// editing selection logic. Which knob to turn for which symptom is documented
// in docs/specs/2026-08-16-map-rail-focus-tracking-design.md ("Tuning").
export type MapRailTuning = {
  /** Pixels of scroll travel per day of focus change. The primary feel knob. */
  scrollPxPerDay: number;
  /**
   * Where the focus line sits within the rail's viewport at each end of the
   * scroll, as a 0..1 fraction (0 = rail top, 1 = rail bottom). The line sweeps
   * between them as scrolling progresses.
   *
   * A *fixed* line (start === end) cannot reach every day: with 14 x 95px
   * buttons in a 600px rail there is only 730px of natural travel but a day
   * change costs 95px of it, so a fixed centre line reaches days 4-11 and
   * silently skips the rest. Sweeping 0 -> 1 makes the line traverse the whole
   * content, giving every day an equal share. See the spec's "Defect 4".
   */
  focusLineStart: number;
  focusLineEnd: number;
  /** How often scroll-driven focus re-evaluates, in ms. */
  scrollThrottleMs: number;
  /** Tolerance for "scrolled to the very top/bottom", in px. */
  boundaryEpsilonPx: number;
};

export const MAP_RAIL_TUNING_DEFAULTS: MapRailTuning = {
  scrollPxPerDay: 240,
  focusLineStart: 0,
  focusLineEnd: 1,
  scrollThrottleMs: 50,
  boundaryEpsilonPx: 4,
};

let override: Partial<MapRailTuning> | null = null;
const listeners = new Set<() => void>();

export function readMapRailTuning(): MapRailTuning {
  return override === null ? MAP_RAIL_TUNING_DEFAULTS : { ...MAP_RAIL_TUNING_DEFAULTS, ...override };
}

export function setMapRailTuning(next: Partial<MapRailTuning> | null): MapRailTuning {
  override = next;
  for (const listener of listeners) listener();
  return readMapRailTuning();
}

/** Subscribe to live tuning changes. Returns an unsubscribe function. */
export function onMapRailTuningChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

declare global {
  // eslint-disable-next-line no-var -- a `var` declaration is how TS augments globalThis
  var __tuneMapRail: ((next?: Partial<MapRailTuning> | null) => MapRailTuning) | undefined;
}

// Dev-only console handle, so tuning is a one-liner with no rebuild:
//   __tuneMapRail({ scrollPxPerDay: 320 })  -> merge and apply immediately
//   __tuneMapRail()                         -> print the current values
//   __tuneMapRail(null)                     -> reset to defaults
// Stripped from production builds by the NODE_ENV guard.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  globalThis.__tuneMapRail = (next) => {
    if (next === undefined) return readMapRailTuning();
    return setMapRailTuning(next === null ? null : { ...override, ...next });
  };
}
```

- [ ] **Step 4: Run tests, lint and types**

Run: `pnpm test mapRailTuning && pnpm lint && pnpm typecheck`
Expected: 5 tests PASS, no lint errors, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lenses/mapRailTuning.ts apps/web/src/components/lenses/mapRailTuning.test.ts
git commit -m "feat(web): live-tunable map rail feel constants"
```

---

### Task 2: Pure focus selection

The selection logic as a pure function over plain numbers — no DOM, no observers, no mocks. This is the piece that was previously untestable, and it carries the regression test for the day-skipping defect.

**Files:**
- Create: `apps/web/src/components/lenses/mapRailFocus.ts`
- Test: `apps/web/src/components/lenses/mapRailFocus.test.ts`

**Interfaces:**
- Consumes: `MapRailTuning`, `MAP_RAIL_TUNING_DEFAULTS` from Task 1.
- Produces: `type RailItem = { index: number; offsetTop: number; height: number }`, `type RailGeometry`, `gearedTravel(dayCount: number, scrollPxPerDay: number): number`, `railScrollGeometry(input): { offset: number; progress: number }`, `pickFocusedDay(g: RailGeometry, t: MapRailTuning): number | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/lenses/mapRailFocus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAP_RAIL_TUNING_DEFAULTS } from "./mapRailTuning";
import { gearedTravel, pickFocusedDay, railScrollGeometry, type RailGeometry, type RailItem } from "./mapRailFocus";

// Real measured values from the live rail: ~95px buttons in a ~600px viewport.
const DAY_HEIGHT = 95;
const VIEWPORT = 600;
const T = MAP_RAIL_TUNING_DEFAULTS;

const items = (count: number): RailItem[] =>
  Array.from({ length: count }, (_, i) => ({ index: i, offsetTop: i * DAY_HEIGHT, height: DAY_HEIGHT }));

/** The rail at a given fraction of its scroll range. */
const at = (count: number, progress: number): RailGeometry => {
  const contentHeight = count * DAY_HEIGHT;
  return {
    items: items(count),
    viewportHeight: VIEWPORT,
    contentHeight,
    offset: Math.max(0, contentHeight - VIEWPORT) * progress,
    progress,
  };
};

const sweepAll = (count: number, tuning = T): number[] => {
  const seen: number[] = [];
  for (let i = 0; i <= 2000; i++) {
    const picked = pickFocusedDay(at(count, i / 2000), tuning);
    if (picked !== null && picked !== seen[seen.length - 1]) seen.push(picked);
  }
  return seen;
};

describe("pickFocusedDay", () => {
  // The regression test for the defect that a fixed centre line cannot reach
  // every day. This is the whole reason the focus line sweeps.
  it("reaches every day, one at a time, across the full scroll range", () => {
    expect(sweepAll(14)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("reaches every day for short and long trips alike", () => {
    expect(sweepAll(8)).toHaveLength(8);
    expect(sweepAll(30)).toHaveLength(30);
  });

  // Characterisation of the behaviour this design replaces. If this ever starts
  // reaching all 14, the sweep is no longer doing anything and the test above
  // has stopped proving something.
  it("skips days when the focus line is pinned instead of sweeping", () => {
    const fixed = { ...T, focusLineStart: 0.5, focusLineEnd: 0.5 };

    const reached = sweepAll(14, fixed);

    expect(new Set(reached).size).toBeLessThan(14);
  });

  it("focuses the first day at the top of the scroll range", () => {
    expect(pickFocusedDay(at(14, 0), T)).toBe(0);
  });

  it("focuses the last day at the bottom of the scroll range", () => {
    expect(pickFocusedDay(at(14, 1), T)).toBe(13);
  });

  it("returns null when there are no days", () => {
    expect(pickFocusedDay({ ...at(0, 0), items: [] }, T)).toBeNull();
  });

  it("focuses the only day when the rail does not overflow", () => {
    expect(pickFocusedDay(at(3, 0), T)).toBe(0);
  });

  it("never focuses a day scrolled out of the visible band", () => {
    const geometry = at(14, 0.5);

    const picked = pickFocusedDay(geometry, T)!;
    const item = geometry.items[picked]!;

    expect(item.offsetTop + item.height).toBeGreaterThan(geometry.offset);
    expect(item.offsetTop).toBeLessThan(geometry.offset + geometry.viewportHeight);
  });

  it("resolves a tie to the lower day index", () => {
    // Two items equidistant from the focus line; the earlier one wins.
    const geometry: RailGeometry = {
      items: [
        { index: 0, offsetTop: 0, height: 100 },
        { index: 1, offsetTop: 100, height: 100 },
      ],
      viewportHeight: 200,
      contentHeight: 200,
      offset: 0,
      progress: 0.5,
    };

    expect(pickFocusedDay(geometry, { ...T, focusLineStart: 0.5, focusLineEnd: 0.5 })).toBe(0);
  });
});

describe("gearedTravel", () => {
  it("gives one scrollPxPerDay of travel per day change", () => {
    expect(gearedTravel(14, 240)).toBe(13 * 240);
  });

  it("is zero for a single day, which has nothing to scroll to", () => {
    expect(gearedTravel(1, 240)).toBe(0);
    expect(gearedTravel(0, 240)).toBe(0);
  });
});

describe("railScrollGeometry", () => {
  it("maps geared scroll travel onto the natural content offset", () => {
    const geometry = railScrollGeometry({
      scrollTop: 1560, // half of 13 * 240
      viewportHeight: VIEWPORT,
      contentHeight: 14 * DAY_HEIGHT,
      gearedTravel: gearedTravel(14, 240),
    });

    expect(geometry.progress).toBeCloseTo(0.5);
    expect(geometry.offset).toBeCloseTo((14 * DAY_HEIGHT - VIEWPORT) / 2);
  });

  it("clamps past either end of the range", () => {
    const base = { viewportHeight: VIEWPORT, contentHeight: 14 * DAY_HEIGHT, gearedTravel: gearedTravel(14, 240) };

    expect(railScrollGeometry({ ...base, scrollTop: -50 }).progress).toBe(0);
    expect(railScrollGeometry({ ...base, scrollTop: 999_999 }).progress).toBe(1);
  });

  it("falls back to natural travel when gearing is off", () => {
    const geometry = railScrollGeometry({
      scrollTop: 365,
      viewportHeight: VIEWPORT,
      contentHeight: 14 * DAY_HEIGHT,
      gearedTravel: 0,
    });

    expect(geometry.offset).toBeCloseTo(365);
  });

  it("reports no travel when the content fits the viewport", () => {
    expect(
      railScrollGeometry({ scrollTop: 0, viewportHeight: VIEWPORT, contentHeight: 200, gearedTravel: 0 }),
    ).toEqual({ offset: 0, progress: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mapRailFocus`
Expected: FAIL — `Failed to resolve import "./mapRailFocus"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/lenses/mapRailFocus.ts`:

```ts
import type { MapRailTuning } from "./mapRailTuning";

/**
 * One rail day button, measured in the track's own coordinate space (i.e.
 * ignoring how far the rail is currently scrolled).
 */
export type RailItem = { index: number; offsetTop: number; height: number };

export type RailGeometry = {
  /** Ascending by offsetTop. Ties resolve to the earlier entry. */
  items: RailItem[];
  /** The rail's own visible height. */
  viewportHeight: number;
  /** Natural height of all buttons stacked, ignoring any scroll gearing. */
  contentHeight: number;
  /** How far the track is scrolled, in natural (ungeared) pixels. */
  offset: number;
  /** How far through the scroll range we are, 0..1. */
  progress: number;
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Scroll travel to manufacture for a geared rail. `dayCount - 1` (not
 * `dayCount`) so that focus advances exactly one day per `scrollPxPerDay`
 * pixels — which is what makes the constant mean what its name says.
 */
export function gearedTravel(dayCount: number, scrollPxPerDay: number): number {
  return Math.max(0, (dayCount - 1) * scrollPxPerDay);
}

/**
 * Translate the container's raw scrollTop into the natural-space offset the
 * track is rendered at, plus overall progress. When `gearedTravel` is 0 this
 * degenerates to a plain 1:1 scroll.
 */
export function railScrollGeometry(input: {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  gearedTravel: number;
}): { offset: number; progress: number } {
  const naturalTravel = Math.max(0, input.contentHeight - input.viewportHeight);
  const travel = input.gearedTravel > 0 ? input.gearedTravel : naturalTravel;
  if (travel <= 0) return { offset: 0, progress: 0 };
  const progress = clamp(input.scrollTop / travel, 0, 1);
  return { offset: progress * naturalTravel, progress };
}

/**
 * Which day the rail is currently focusing, or null if there are no days.
 *
 * The focus line sweeps from `focusLineStart` to `focusLineEnd` of the rail's
 * viewport as scrolling progresses, rather than sitting at a fixed position.
 * At the defaults (0 -> 1) the line traverses the entire content, so every day
 * gets an equal share of the scroll range; a fixed line would leave days
 * permanently unreachable (see mapRailTuning.ts and the spec's "Defect 4").
 *
 * The boundary branches are consequently a no-op safety net at the defaults —
 * the sweep already selects the first and last day at the extremes. They earn
 * their keep only if the focus-line knobs get narrowed during tuning.
 */
export function pickFocusedDay(g: RailGeometry, t: MapRailTuning): number | null {
  const first = g.items[0];
  const last = g.items[g.items.length - 1];
  if (first === undefined || last === undefined) return null;

  const maxOffset = Math.max(0, g.contentHeight - g.viewportHeight);
  if (maxOffset > 0) {
    if (g.offset >= maxOffset - t.boundaryEpsilonPx) return last.index;
    if (g.offset <= t.boundaryEpsilonPx) return first.index;
  }

  const focusLine =
    g.offset + g.viewportHeight * lerp(t.focusLineStart, t.focusLineEnd, clamp(g.progress, 0, 1));

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of g.items) {
    // A day scrolled off either edge is never a candidate, however near its
    // centre happens to be to the line.
    if (item.offsetTop + item.height <= g.offset) continue;
    if (item.offsetTop >= g.offset + g.viewportHeight) continue;
    const distance = Math.abs(item.offsetTop + item.height / 2 - focusLine);
    // Strictly-less keeps the earlier (lower-index) item on a tie.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item.index;
    }
  }
  return best ?? first.index;
}
```

- [ ] **Step 4: Run tests, lint and types**

Run: `pnpm test mapRailFocus && pnpm lint && pnpm typecheck`
Expected: 16 tests PASS. In particular `reaches every day, one at a time` must pass — if it fails, the sweep math is wrong, and nothing downstream is worth building until it is green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lenses/mapRailFocus.ts apps/web/src/components/lenses/mapRailFocus.test.ts
git commit -m "feat(web): pure map rail focus selection with sweeping focus line"
```

---

### Task 3: Test harness — real layout, triggerable resize

`MapRail` is about to read real geometry off the DOM. jsdom reports `0` for every layout property and ships no `ResizeObserver`, so tests need to (a) install a static, believable layout and (b) tell the component to measure it.

This replaces the `triggerIntersection` fixture, which fabricated *fresh position data per scroll event* — something a real browser never delivers, which is exactly why the suite stayed green while the feature was broken. `triggerResize` is honest by comparison: it only says "sizes changed, re-measure now", which a real `ResizeObserver` genuinely does, and the geometry it re-measures is a fixed layout that behaves like real layout.

**Files:**
- Modify: `apps/web/vitest.setup.ts:46-56` (replace the inert `ResizeObserver` stub)
- Test: covered by Task 4's rewritten `MapRail.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `triggerResize(): void` exported from `apps/web/vitest.setup.ts`. The existing `setViewportMatches` export is untouched.

- [ ] **Step 1: Replace the ResizeObserver stub**

In `apps/web/vitest.setup.ts`, replace the whole existing block (the comment beginning `// jsdom ships no ResizeObserver` through the closing `}` of the class assignment) with:

```ts
// jsdom ships no ResizeObserver. Two components need one: MapLens.tsx (to
// re-trigger maplibre's tile cover once the container's real size settles) and
// MapRail.tsx (to re-measure its day buttons' offsets when layout changes).
//
// MapLens only needs the constructor not to throw. MapRail needs a test to be
// able to say "layout changed, measure again" — so this is a real, if minimal,
// polyfill plus a small test-control surface, the same shape as
// setViewportMatches above.
//
// Note what triggerResize deliberately is NOT: it does not hand the component
// any geometry. It only prompts a re-measure, exactly as a real ResizeObserver
// does; the component then reads the (test-installed, static) layout itself.
// The IntersectionObserver fixture this replaces did the opposite — it fed
// fabricated per-scroll positions that no real browser ever delivers, which is
// why the suite passed while the feature was broken. Do not reintroduce that.
const activeResizeObservers = new Set<{ callback: () => void; elements: Set<Element> }>();

export function triggerResize(): void {
  for (const observer of activeResizeObservers) {
    if (observer.elements.size > 0) observer.callback();
  }
}

if (typeof window !== "undefined" && typeof window.ResizeObserver !== "function") {
  class ResizeObserverPolyfill {
    callback: () => void;
    elements = new Set<Element>();

    constructor(callback: () => void) {
      this.callback = callback;
      activeResizeObservers.add(this);
    }
    observe(el: Element): void {
      this.elements.add(el);
    }
    unobserve(el: Element): void {
      this.elements.delete(el);
    }
    disconnect(): void {
      activeResizeObservers.delete(this);
      this.elements.clear();
    }
  }
  window.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 2: Verify nothing regressed**

Run: `pnpm test && pnpm typecheck`
Expected: the whole existing unit suite still PASSES. `MapLens.test.tsx` in particular must be unaffected — it only needs the constructor not to throw.

- [ ] **Step 3: Commit**

```bash
git add apps/web/vitest.setup.ts
git commit -m "test(web): triggerable ResizeObserver polyfill for rail measurement"
```

---

### Task 4: Rewrite MapRail — measurement and gearing

The core task. Drops `IntersectionObserver`, measures synchronously, and adds the geared scroll structure.

**Files:**
- Modify: `apps/web/src/components/lenses/MapRail.tsx` (rewrite the effect and the wrapper DOM; leave the button JSX untouched)
- Modify: `apps/web/src/components/lenses/MapRail.test.tsx` (rewrite the `scroll-driven focus` describe block; leave the other tests untouched)
- Modify: `apps/web/vitest.setup.ts` (delete the now-unused `IntersectionObserver` polyfill)

**Interfaces:**
- Consumes: `readMapRailTuning`, `onMapRailTuningChange` (Task 1); `gearedTravel`, `railScrollGeometry`, `pickFocusedDay`, `RailItem` (Task 2); `triggerResize` (Task 3).
- Produces: `MapRail` keeps its exact existing props — `{ days: MapDay[]; focusedDay: number | null; onFocus: (index: number) => void }`. `MapLens.tsx` needs no change.

**DOM structure.** Four nested elements, each with one job:

```
container  overflow-y:auto, fixed inset      the only scroll container
  spacer   height = viewportHeight + travel  manufactures real scroll travel
    clip   sticky top:0, height:viewport,    pins to the rail viewport and
           overflow:hidden                   clips, so nothing leaks into the
                                             container's own scroll range
      track  transform: translateY(-offset)  the geared movement
        button x N                           unchanged
```

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/lenses/MapRail.test.tsx`, replace the entire `describe("scroll-driven focus", ...)` block with the following, and update the imports at the top of the file — change `import { triggerIntersection } from "../../../vitest.setup";` to `import { triggerResize } from "../../../vitest.setup";`.

```ts
  describe("scroll-driven focus", () => {
    const DAY_HEIGHT = 95;
    const VIEWPORT = 600;

    const manyDays = (count: number): MapDay[] =>
      Array.from({ length: count }, (_, i) =>
        day({ index: i, dayId: `d${i + 1}`, label: `Day ${i + 1}` }),
      );

    /**
     * jsdom performs no layout — every offset and rect reads 0. Install a
     * static, believable one: uniform DAY_HEIGHT buttons stacked in a
     * VIEWPORT-tall rail. This stays fixed for the life of the test, the way
     * real layout does; only the scrollTop moves.
     */
    const installLayout = (count: number) => {
      const rail = screen.getByLabelText("Days");
      const track = rail.querySelector("[data-rail-track]") as HTMLElement;
      const buttons = screen.getAllByRole("button");

      Object.defineProperty(rail, "clientHeight", { value: VIEWPORT, configurable: true });
      track.getBoundingClientRect = () => ({ top: 0, height: count * DAY_HEIGHT }) as DOMRect;
      buttons.forEach((button, i) => {
        button.getBoundingClientRect = () =>
          ({ top: i * DAY_HEIGHT, height: DAY_HEIGHT }) as DOMRect;
      });

      triggerResize();
      return rail;
    };

    const scrollTo = (rail: HTMLElement, scrollTop: number) => {
      Object.defineProperty(rail, "scrollTop", { value: scrollTop, configurable: true });
      fireEvent.scroll(rail);
    };

    it("focuses a later day as the rail scrolls, promptly and without waiting for scrolling to stop", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      // Half way through the geared range. The very first scroll event reacts
      // (leading-edge throttle, not a trailing debounce).
      scrollTo(rail, (13 * 240) / 2);

      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onFocus.mock.calls[0]![0]).toBeGreaterThan(0);
    });

    it("reaches every day across the full scroll range, never skipping one", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      const travel = 13 * 240;
      for (let i = 1; i <= 400; i++) {
        scrollTo(rail, (travel * i) / 400);
        vi.advanceTimersByTime(50);
      }

      expect(onFocus.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    });

    it("focuses the last day at the bottom of the scroll range", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      scrollTo(rail, 13 * 240);

      expect(onFocus).toHaveBeenLastCalledWith(13);
    });

    it("gears the scroll so one day costs scrollPxPerDay of travel", () => {
      vi.useFakeTimers();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={vi.fn()} />);
      const rail = installLayout(14);
      const spacer = rail.querySelector("[data-rail-spacer]") as HTMLElement;

      // viewport + (14 - 1) days * 240px each
      expect(spacer.style.height).toBe(`${VIEWPORT + 13 * 240}px`);
    });

    it("does not manufacture scroll travel when every day already fits", () => {
      vi.useFakeTimers();
      render(<MapRail days={manyDays(3)} focusedDay={0} onFocus={vi.fn()} />);
      const rail = installLayout(3);
      const spacer = rail.querySelector("[data-rail-spacer]") as HTMLElement;

      expect(spacer.style.height).toBe(`${VIEWPORT}px`);
    });

    it("coalesces a burst of scroll events instead of firing for every one", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      scrollTo(rail, 300);
      expect(onFocus).toHaveBeenCalledTimes(1);

      scrollTo(rail, 700);
      scrollTo(rail, 1100);
      scrollTo(rail, 1500);
      expect(onFocus).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(50);
      expect(onFocus).toHaveBeenCalledTimes(2);
    });

    it("does not re-emit the same day while it stays focused", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      scrollTo(rail, 1560);
      vi.advanceTimersByTime(300);
      const callsAfterFirst = onFocus.mock.calls.length;

      scrollTo(rail, 1562);
      vi.advanceTimersByTime(300);

      expect(onFocus).toHaveBeenCalledTimes(callsAfterFirst);
    });

    it("does not call onFocus just from mounting — only an actual scroll can", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);

      installLayout(14);
      vi.advanceTimersByTime(500);

      expect(onFocus).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test MapRail`
Expected: FAIL — `triggerResize` is imported but the component has no `data-rail-track` / `data-rail-spacer` elements yet, so `installLayout` throws on the null `track`.

- [ ] **Step 3: Rewrite the effect and wrapper DOM**

In `apps/web/src/components/lenses/MapRail.tsx`:

**(a)** Replace the import block at the top of the file:

```tsx
import { useEffect, useRef } from "react";
import type { AccentFamily } from "@/lib/dayAccent";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";
import type { MapDay } from "./mapRailData";
import { gearedTravel, pickFocusedDay, railScrollGeometry, type RailItem } from "./mapRailFocus";
import { onMapRailTuningChange, readMapRailTuning } from "./mapRailTuning";
```

**(b)** Delete the `SCROLL_THROTTLE_MS` and `BOUNDARY_EPSILON_PX` constants and their comment blocks — both now live in `mapRailTuning.ts`. Keep `TINT_BG` and `SOLID_BG` exactly as they are.

**(c)** Replace the entire `useEffect` (the block from the long `// Scroll-driven focus:` comment through its closing `}, [days.map((d) => d.dayId).join(",")]);`) with:

```tsx
  const clipRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Scroll-driven focus: as the user scrolls the rail, whichever day the focus
  // line is over becomes focused, via the same onFocus callback a click uses.
  //
  // Position comes from measuring the buttons directly, cached and refreshed by
  // a ResizeObserver. It deliberately does NOT come from an IntersectionObserver:
  // IO delivers entries only on ratio-threshold crossings, so a button sitting
  // at ratio 1.0 (five or six do at once here) never refreshes its
  // boundingClientRect while its real position keeps changing, and IO delivers
  // nothing whatsoever in a backgrounded tab. Both failure modes put focus on
  // stale or absent data; a synchronous read of cached offsets has neither.
  //
  // The rail is also geared: the spacer manufactures far more scroll travel
  // than the content needs, and the track moves at the reduced rate, so landing
  // on a specific day takes a deliberate scroll rather than a flick. Gearing
  // rides on a real native scroll container — never wheel interception, which
  // would cost trackpad momentum, touch drag, keyboard paging and the scrollbar.
  useEffect(() => {
    const container = containerRef.current;
    const clip = clipRef.current;
    const spacer = spacerRef.current;
    const track = trackRef.current;
    if (!container || !clip || !spacer || !track) return;

    const geometry = { items: [] as RailItem[], viewportHeight: 0, contentHeight: 0 };

    const travelFor = (scrollPxPerDay: number) =>
      geometry.contentHeight > geometry.viewportHeight ? gearedTravel(days.length, scrollPxPerDay) : 0;

    const currentScroll = (scrollPxPerDay: number) =>
      railScrollGeometry({
        scrollTop: container.scrollTop,
        viewportHeight: geometry.viewportHeight,
        contentHeight: geometry.contentHeight,
        gearedTravel: travelFor(scrollPxPerDay),
      });

    const paint = () => {
      const { offset } = currentScroll(readMapRailTuning().scrollPxPerDay);
      track.style.transform = `translateY(${-offset}px)`;
    };

    const measure = () => {
      const tuning = readMapRailTuning();
      // Offsets are taken relative to the track rather than from offsetTop, so
      // they stay correct whatever the current transform is — both rects move
      // together, so the difference between them does not.
      const trackTop = track.getBoundingClientRect().top;
      const items: RailItem[] = [];
      for (const day of days) {
        const el = buttonsRef.current.get(day.index);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        items.push({ index: day.index, offsetTop: rect.top - trackTop, height: rect.height });
      }
      items.sort((a, b) => a.offsetTop - b.offsetTop);
      const last = items[items.length - 1];

      geometry.items = items;
      geometry.viewportHeight = container.clientHeight;
      geometry.contentHeight = last ? last.offsetTop + last.height : 0;

      clip.style.height = `${geometry.viewportHeight}px`;
      spacer.style.height = `${geometry.viewportHeight + travelFor(tuning.scrollPxPerDay)}px`;
      paint();
    };

    const evaluate = () => {
      const tuning = readMapRailTuning();
      const { offset, progress } = currentScroll(tuning.scrollPxPerDay);
      const next = pickFocusedDay({ ...geometry, offset, progress }, tuning);
      if (next !== null && next !== lastEmittedRef.current) {
        lastEmittedRef.current = next;
        onFocusRef.current(next);
      }
    };

    // A light leading+trailing throttle: the first scroll event of a burst
    // reacts immediately (focus jumps live as the user scrolls), and further
    // events inside the window collapse into one trailing evaluation instead of
    // firing per pixel. Explicitly not a "settle after scrolling stops"
    // debounce — that was tried and rejected as sluggish.
    let lastRun = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;

    const handleScroll = () => {
      // The transform is the only per-frame work, coalesced into one rAF.
      // Focus evaluation stays off rAF on purpose: rAF is suspended in a
      // backgrounded tab, and routing focus through it would reintroduce
      // exactly the "no updates in a hidden tab" failure this rewrite removes.
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          paint();
        });
      }

      const throttleMs = readMapRailTuning().scrollThrottleMs;
      const now = Date.now();
      if (now - lastRun >= throttleMs) {
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = undefined;
        }
        lastRun = now;
        evaluate();
      } else if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = undefined;
          lastRun = Date.now();
          evaluate();
        }, throttleMs - (now - lastRun));
      }
    };

    // Catches the initial layout, font loading, day content changing, and the
    // assistant rail toggling. Measuring never emits focus — only a real scroll
    // does, so mounting never overrides the focus the caller started with.
    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(container);
    resizeObserver.observe(track);
    measure();

    const unsubscribeTuning = onMapRailTuningChange(measure);
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      unsubscribeTuning();
      container.removeEventListener("scroll", handleScroll);
      if (trailingTimer) clearTimeout(trailingTimer);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measuring on day identity change only; onFocus/focusedDay are read via refs above
  }, [days.map((d) => d.dayId).join(",")]);
```

**(d)** Wrap the existing `{days.map(...)}` in the spacer/clip/track elements. The container `<div>` and the whole `<button>` JSX inside `days.map` stay **exactly** as they are — only these three wrapper elements are new:

```tsx
    <div
      ref={containerRef}
      aria-label="Days"
      className="absolute overflow-y-auto rounded-2xl border border-hairline bg-surface shadow-overlay"
      // eslint-disable-next-line no-restricted-syntax -- 268px rail width + 16px inset + z-index 4 have no token equivalent, matching AssistantRail's computed-geometry pattern
      style={{ left: "16px", top: "16px", bottom: "16px", width: "268px", zIndex: 4 }}
    >
      {/* Manufactures the geared scroll travel. Height is set in the effect
          above; `auto` is the pre-measure fallback, which renders as a plain
          ungeared list rather than as a collapsed one. */}
      <div ref={spacerRef} data-rail-spacer style={{ height: "auto" }}>
        {/* Sticky, so the compositor pins the day list to the rail's viewport
            as the spacer scrolls past — the only per-frame JS write is the
            track transform below. overflow:hidden matters: without it the
            overflowing buttons would extend the container's own scrollable
            area and corrupt the gearing math. */}
        {/* eslint-disable-next-line no-restricted-syntax -- height is measured geometry, set from the effect above */}
        <div ref={clipRef} className="sticky top-0 overflow-hidden" style={{ height: "auto" }}>
          {/* eslint-disable-next-line no-restricted-syntax -- transform is the geared scroll offset, not a themeable value */}
          <div ref={trackRef} data-rail-track style={{ willChange: "transform" }}>
            {/*
              KEEP THE EXISTING `days.map((day) => { ... })` EXPRESSION HERE
              VERBATIM — the whole block from `{days.map((day) => {` through its
              closing `})}`, including the `<button>`, its two eslint-disable
              comments, the accent spine style, the label/date/city/totals rows,
              the bars row and the flag row. It moves inward by three levels of
              indentation and changes in no other way. Re-indenting it is the
              only edit; do not retype it from memory.
            */}
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test MapRail`
Expected: all PASS, including `reaches every day across the full scroll range, never skipping one`.

If `reaches every day` fails with a *shorter* list than 1–13, the throttle is swallowing intermediate days — raise the loop count in that test, not the throttle. If it fails with a list containing a jump (e.g. `[1,2,4]`), the sweep math is wrong; re-check Task 2 is green before debugging here.

- [ ] **Step 5: Delete the IntersectionObserver polyfill**

`MapRail.tsx` was its only consumer. In `apps/web/vitest.setup.ts`, delete the entire `IntersectionObserver` block — the comment beginning `// jsdom ships no IntersectionObserver`, the `FakeRect` / `FakeIntersectionEntry` / `IntersectionCallback` types, `activeIntersectionObservers`, the exported `triggerIntersection` function, and the `IntersectionObserverPolyfill` class with its assignment.

- [ ] **Step 6: Verify the whole suite, lint and types**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: the full unit suite PASSES. Then confirm the old API is fully gone:

Run: `grep -rn "IntersectionObserver\|triggerIntersection" apps/web/src apps/web/vitest.setup.ts`
Expected: **no output.**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/lenses/MapRail.tsx apps/web/src/components/lenses/MapRail.test.tsx apps/web/vitest.setup.ts
git commit -m "fix(web): measure rail geometry directly instead of via IntersectionObserver"
```

---

### Task 5: Browser-level regression test

The primary gate. Unit tests cannot catch what broke this twice — only a real browser doing real layout and real scrolling can.

**Files:**
- Modify: `apps/web/e2e/helpers.ts` (add a fixture builder)
- Create: `apps/web/e2e/m10-map-rail.spec.ts`

**Interfaces:**
- Consumes: `signInAsDevUser` from `./helpers`.
- Produces: `createMappedTrip(page: Page, name: string, dayCount: number): Promise<string>` exported from `./helpers`, returning the new trip's id.

**Why an API fixture.** The rail only gears once its content overflows, which needs ~8+ days each carrying a located stop. Building that through the UI would take hundreds of interactions. `page.request` inherits the browser context's session cookie, so the spec can drive the same command API `scripts/db-seed.mjs` uses.

- [ ] **Step 1: Add the fixture builder**

Append to `apps/web/e2e/helpers.ts`:

```ts
/**
 * Creates a trip with `dayCount` days, each carrying one located activity, via
 * the app's own command API. `page.request` shares the browser context's
 * cookies, so this runs as the already-signed-in dev user.
 *
 * The map rail only gears once its content overflows its viewport, which needs
 * more days than are practical to build through the UI. Same command shapes as
 * scripts/db-seed.mjs.
 */
export async function createMappedTrip(page: Page, name: string, dayCount: number): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const response = await page.request.post(path, { data: body });
    if (!response.ok()) {
      throw new Error(`POST ${path} -> ${response.status()}: ${await response.text()}`);
    }
    return response.json();
  };

  const { tripId } = await post("/api/trips", { name });
  const cmd = (command: Record<string, unknown>) => post(`/api/trips/${tripId}/commands`, { ...command, tripId });

  const start = new Date();
  start.setDate(start.getDate() + 10);
  const end = new Date(start);
  end.setDate(end.getDate() + dayCount - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const newDayIds = Array.from({ length: dayCount }, () => crypto.randomUUID());
  const { detail } = await cmd({
    type: "SetTripDates",
    startDate: iso(start),
    endDate: iso(end),
    newDayIds,
  });

  for (const [i, day] of detail.days.entries()) {
    const activityId = crypto.randomUUID();
    await cmd({
      type: "AddActivity",
      activityId,
      title: `Stop on day ${i + 1}`,
      timeWindow: { start: "09:00", end: "10:00" },
      // Spread apart so each day's fitBounds lands somewhere distinct.
      location: { name: `Place ${i + 1}`, city: `City ${i + 1}`, lat: 35 + i * 0.4, lng: 139 + i * 0.4, countryCode: "JP" },
    });
    await cmd({ type: "MoveActivity", activityId, toDayId: day.dayId, position: 0 });
  }

  return tripId as string;
}
```

- [ ] **Step 2: Write the failing spec**

Create `apps/web/e2e/m10-map-rail.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { createMappedTrip, signInAsDevUser } from "./helpers";

const DAY_COUNT = 14;

/** Which day the rail currently marks focused, by its 1-based label. */
async function focusedDayLabel(page: Page): Promise<string> {
  return page.locator('[aria-label="Days"] button[aria-current="true"]').innerText();
}

async function scrollRailBy(page: Page, delta: number): Promise<void> {
  await page.evaluate((by) => {
    document.querySelector('[aria-label="Days"]')!.scrollTop += by;
  }, delta);
  // One frame for the scroll handler's leading edge plus its trailing timer.
  await page.waitForTimeout(120);
}

test("map rail: scrolling tracks focus through every day", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share a DB.
  const tripName = `MapRail ${Date.now()}`;
  await signInAsDevUser(page, "alice");
  const tripId = await createMappedTrip(page, tripName, DAY_COUNT);

  await page.goto(`/trips/${tripId}?lens=Map`);
  const rail = page.locator('[aria-label="Days"]');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button")).toHaveCount(DAY_COUNT);

  // -- the rail is geared: its scroll range far exceeds its content --
  const { scrollHeight, clientHeight } = await rail.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight * 3);

  // -- scrolling from top to bottom visits every day, in order, none skipped --
  // This is the regression test for the two defects that made this feature
  // fail: focus that stuck on Day 1 mid-scroll, and a fixed focus line that
  // could never reach days near either end.
  await page.evaluate(() => {
    document.querySelector('[aria-label="Days"]')!.scrollTop = 0;
  });
  await page.waitForTimeout(120);

  const step = Math.ceil((scrollHeight - clientHeight) / 200);
  const seen: string[] = [await focusedDayLabel(page)];
  for (let i = 0; i < 200; i++) {
    await scrollRailBy(page, step);
    const label = await focusedDayLabel(page);
    if (label !== seen[seen.length - 1]) seen.push(label);
  }

  const dayNumbers = seen.map((label) => Number(label.match(/Day (\d+)/)![1]));
  expect(dayNumbers).toEqual(Array.from({ length: DAY_COUNT }, (_, i) => i + 1));

  // -- the last day is reached at the bottom boundary --
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Days"]')!;
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(120);
  expect(await focusedDayLabel(page)).toContain(`Day ${DAY_COUNT}`);

  // -- and the first day at the top --
  await page.evaluate(() => {
    document.querySelector('[aria-label="Days"]')!.scrollTop = 0;
  });
  await page.waitForTimeout(120);
  expect(await focusedDayLabel(page)).toContain("Day 1");

  // -- clicking still focuses directly, unchanged by any of the above --
  await rail.getByRole("button").nth(6).click();
  expect(await focusedDayLabel(page)).toContain("Day 7");
});
```

- [ ] **Step 3: Run the spec**

Run: `pnpm test:e2e m10-map-rail`
Expected: PASS.

If the day-sequence assertion fails with gaps, the sweep is not reaching every day at real measured button heights — re-read the spec's *Defect 4* and check `focusLineStart`/`focusLineEnd` are still `0`/`1`. If it fails because focus never changes at all, check the rail actually overflows: `scrollHeight > clientHeight` must hold, which needs the trip to have enough days to overflow at the browser's real button height.

- [ ] **Step 4: Verify the full e2e suite still passes**

Run: `pnpm test:e2e`
Expected: all specs PASS. `m10-map-rail` is additive; nothing else touches the rail.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/m10-map-rail.spec.ts
git commit -m "test(web): browser-level map rail scroll focus regression spec"
```

---

### Task 6: Live tuning pass

`scrollPxPerDay: 240` is arithmetic, not a judgement. Settle it by feel against the real fixture.

**Files:**
- Modify: `apps/web/src/components/lenses/mapRailTuning.ts` (the settled default only)
- Modify: `docs/specs/2026-08-16-map-rail-focus-tracking-design.md` (record what was settled and whether sticky held)

- [ ] **Step 1: Seed the fixture and open the rail**

```bash
pnpm --filter web db:reseed
```

Start the dev server and open the seeded trip *Japan: Tokyo → Kyoto → Osaka* (14 days, 68 stops) on the Map lens.

- [ ] **Step 2: Confirm the sticky track holds**

The spec flags this as the one thing not to assume. In DevTools, scroll the rail and confirm the day list stays pinned inside the rail's bounds — it must not drift, tear, or scroll out of the rail's rounded border.

If it misbehaves, apply the documented fallback: give `clipRef`'s div `className="absolute inset-x-0 top-0 overflow-hidden"` instead of `sticky top-0`, and change `paint()` to cancel the container's own scroll in JS:

```ts
    const paint = () => {
      const { offset } = currentScroll(readMapRailTuning().scrollPxPerDay);
      track.style.transform = `translateY(${container.scrollTop - offset}px)`;
    };
```

Record which one shipped in the spec's *Sticky verification* section.

- [ ] **Step 3: Tune scrollPxPerDay by feel**

Scroll the rail at a natural pace. Adjust from the console — no rebuild:

```js
__tuneMapRail({ scrollPxPerDay: 320 })
```

Target: landing on a specific day is easy, without the rail feeling slow to cross. Tune this knob **alone**; leave the focus-line knobs at `0`/`1`. Sane range is 120–500.

After each change, re-check coverage: scroll slowly end to end and confirm `aria-current` visits every day. A rail that skips days still feels responsive — the failure is invisible unless looked for.

- [ ] **Step 4: Commit the settled value**

Update `MAP_RAIL_TUNING_DEFAULTS.scrollPxPerDay` in `mapRailTuning.ts` to the settled number, and update the spec's *Tuning* section to record it as validated rather than calculated.

```bash
git add apps/web/src/components/lenses/mapRailTuning.ts docs/specs/2026-08-16-map-rail-focus-tracking-design.md
git commit -m "feat(web): settle map rail scroll gearing against the Japan fixture"
```

- [ ] **Step 5: Final verification**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm test:e2e`
Expected: everything PASSES.

Then walk the spec's *Definition of done* and confirm each line by observation, not inference — especially "all 14 days of the fixture are reachable by scrolling."

---

## Definition of done

- [ ] Scrolling the rail mid-range advances focus through consecutive days in a real browser.
- [ ] All 14 days of the Japan fixture are reachable by scrolling, none skipped.
- [ ] Top and bottom boundaries reach the first and last day.
- [ ] `scrollPxPerDay` tuned live and the settled value committed as the default.
- [ ] Sticky pinning confirmed live, or the absolute fallback adopted and recorded in the spec.
- [ ] `grep -rn "IntersectionObserver" apps/web/src` returns nothing.
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e` all pass.
- [ ] The rail is visually unchanged from before this work.
