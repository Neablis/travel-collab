"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityTag } from "@tc/contracts";

/**
 * ── The day-sync contract ────────────────────────────────────────────────────
 *
 * Mitchell, 2026-09-01, walking the preview on a phone at 411px, in two
 * toolbar comments that are one request. On `/demo`, on the day-chips row:
 * *"scrolling here should also change the selected date below and sync the
 * scrolling between the two. Clicking a day selects and scrolls to that day in
 * both containers. Changing the tab jumps to the selected day. **This is the
 * modus operandi for every tab that can scroll and a day is selectable**"*, and
 * on `/demo?lens=Map`, on the phone day strip: *"scrolling here on mobile
 * should change the selected day"*.
 *
 * So it is a general rule, not two patches, and it is written down here — above
 * every lens and every day control — rather than in any one of them:
 *
 * 1. **Scrolling a day container moves the selection** to the day nearest that
 *    container's reading line (`centralDay.ts`).
 * 2. **Selecting a day scrolls it into view in every day container on screen**,
 *    not only the one it was picked in.
 * 3. **Switching lenses scrolls the newly-shown one to the selected day.**
 *
 * A *day container* is any surface that scrolls AND lets you select a day: the
 * chips row, the day columns, the timeline, the phone map strip. The calendar
 * is deliberately only DRIVEN — see `DayContainer` below.
 *
 * ── Why this needs a lock, and not just `FocusOrigin` ────────────────────────
 *
 * Clauses 1 and 2 make every container both a driver and a follower, which is
 * a loop by construction: A scrolls → the selection moves → B scrolls to
 * follow → B's own spy reads that scroll as the user's → the selection moves
 * again → A scrolls to follow. At the ends of a trip it does not even converge:
 * select day 1 in the chips row, the columns row is already at scrollLeft 0 and
 * cannot centre day 1, so its spy honestly reports day 2 — and the two rows
 * trade the selection back and forth forever.
 *
 * `focusOrigin` cannot fix that, and the distinction matters: **origin says who
 * set the value; the lock says "a scroll happening right now is mine, ignore
 * it"**. Origin was enough while exactly one container (the timeline) scrolled
 * itself; with four, a follower's own programmatic scroll is indistinguishable
 * from the user's without one.
 *
 * The design solved this first (`Trip Planner Redesign.dc.html`: `jump()` at
 * ~4847 sets `this._jumpLock`, `_watchScroll` at ~3660 returns early while it
 * is held) and this follows it rather than inventing a second answer.
 *
 * Two deliberate differences from the design's version:
 *
 * - **It is keyed by container, not global.** A single flag would mean that
 *   following the chips row's scroll (which sets the lock) also deafens the
 *   chips row's own spy, so the selection would freeze one frame into a drag —
 *   clause 1 broken to satisfy clause 2. The lock has to mean "*this* box's
 *   current scrolling is mine", which is per box. The key is a closed union
 *   rather than a free string because a typo in a key is a silent infinite
 *   loop, and the set of day containers is small and known.
 * - **It is a deadline, not a boolean plus a timer.** Two containers begin a
 *   jump in the same tick; with `setTimeout` the second's `clearTimeout` would
 *   have to know about the first (the design carries a `clearTimeout(this._jumpT)`
 *   for exactly that reason), and an unmount has a timer to clean up. A
 *   `Date.now()` deadline extends instead of racing and has nothing to cancel.
 */
export type DayContainer =
  | "chips"
  /** The Board lens's horizontally scrolling day columns. */
  | "columns"
  /** The Timeline lens. It scrolls the WINDOW, not a box of its own. */
  | "timeline"
  /** The phone-only map day strip (`MapDayStrip`). The desktop `MapRail` is
      not here: its focus is already scroll-driven through its own geared
      machinery, it is the only day container on its lens, and giving it a
      second scroll spy would be two mechanisms fighting over one box. */
  | "map-strip"
  /**
   * The Calendar lens — **driven only, never driving**, and that is a decision
   * rather than an omission of Mitchell's "every tab that can scroll" rule.
   * The calendar scrolls on two axes and neither of them is the trip-day axis:
   * sideways moves through the days of ONE week (x is a weekday), downwards
   * moves through weeks and months (y is a week). A reading line on either
   * names a weekday or a week, not a day of the trip, so there is no honest
   * answer for a spy to report. Selecting a day still scrolls its cell into
   * view here, which is clauses 2 and 3.
   */
  | "calendar";

/**
 * How long after a programmatic scroll a container ignores its own scroll
 * events.
 *
 * 300ms, which is only ~18 frames, and that is enough **because every sync
 * scroll is instant** (`behavior: "auto"` in `jumpTo` below). An instant scroll
 * lands within the frame; the lock only has to outlast the scroll events the
 * browser dispatches for it, which arrive in the next frame or two.
 *
 * The design uses 900ms because its jumps are smooth. Smooth was tried here and
 * rejected on three counts: a smooth scroll's duration is browser-defined and
 * grows with distance (arrowing from day 1 to day 12 in the chips row is a long
 * way), so a lock that must outlast it is a guess that gets longer as trips
 * get longer; a lock that long is a dead zone where the user's OWN scrolling is
 * discarded, which on a phone is exactly the gesture Mitchell was making when
 * he filed this; and `prefers-reduced-motion` would need a second, instant code
 * path anyway, which `globals.css` consistently avoids by dropping motion for
 * everyone rather than freezing it for some. Instant is also what the design's
 * `jump()` actually does — `sc.scrollLeft = el.offsetLeft - 24` is an
 * assignment, not an animation.
 */
const DAY_JUMP_LOCK_MS = 300;

/**
 * How the current `focusedDay` came to be focused.
 *
 * `"explicit"` — somebody picked it: a day chip, a day column's title, the map
 * rail, or the timeline appending a day and scrolling to it.
 * `"scroll"` — they scrolled or arrowed past it and the header followed.
 *
 * The coarse view of `focusSource` (null means explicit): who set the value,
 * for consumers that care whether it was a pick without caring which surface it
 * came from.
 */
export type FocusOrigin = "explicit" | "scroll";

/**
 * One day container's half of the contract above. Handed to the surfaces that
 * are props-only by design (`DayChips`, `Board`, `MapDayStrip`, whose own tests
 * render them with no provider) and taken from `useDaySync` by the ones that
 * already live under the provider.
 */
export type DaySync = {
  /**
   * True when this container must scroll `focusedDay` into view — i.e. the
   * current selection did NOT come from this container's own scrolling. Read it
   * through `useFollowFocusedDay`, which also covers clause 3.
   */
  shouldFollow: boolean;
  /** True while this container's own scrolling is ours rather than the user's. */
  isOwnScroll: () => boolean;
  /** Clause 1: the day on this container's reading line. A no-op while `isOwnScroll()`. */
  reportScrolled: (index: number) => void;
  /**
   * Clauses 2 and 3: scroll `element` into view without that scroll being read
   * back as the user's. Returns whether there was an element to scroll — which
   * a day already in view still counts as, since the container is then already
   * showing what the contract asks it to show.
   */
  jumpTo: (element: Element | null | undefined, options?: ScrollIntoViewOptions) => boolean;
};

type FocusCtx = {
  focusedDay: number | null;
  setFocusedDay: (i: number | null) => void;
  /**
   * The reading position, as scrolling or arrowing reports it.
   *
   * Mitchell, 2026-09-01: *"Scrolling down the timeline or Left/Right in the
   * days column should change the selected day in the header bar."* It is the
   * same state the chips already ring rather than a second, softer indicator —
   * the request was for the selection to move, not for a second marker beside
   * it — so this is `setFocusedDay` with a different origin, not a different
   * value.
   *
   * The design's own model splits these in two (`focus` for the indicator,
   * `focused` for the scope, `dc.html:3630-3666`, where scrolling CLEARS the
   * scope). Deliberately not adopted: two day states would mean every surface
   * deciding which one it means, and the assistant's "Looking at Day 3" is
   * arguably more right following the day you are reading than pinned to one
   * you picked and scrolled away from.
   *
   * Takes the container that scrolled, because the contract's clause 2 is
   * "scroll it into view in every OTHER container" — which is a question only
   * the source can answer. Prefer `useDaySync(...).reportScrolled`, which
   * carries the jump-lock guard with it.
   */
  setScrolledDay: (i: number, from: DayContainer) => void;
  /** Where `focusedDay`'s current value came from. See `FocusOrigin`. */
  focusOrigin: FocusOrigin;
  /** Which container's scrolling set `focusedDay`, or null when it was picked. */
  focusSource: DayContainer | null;
  /** Starts `container`'s jump lock. See the contract above; use `useDaySync`. */
  beginDayJump: (container: DayContainer) => void;
  /** Drops `container`'s jump lock now rather than at its deadline. */
  endDayJump: (container: DayContainer) => void;
  /** True while `container`'s jump lock is held. */
  isDayJumping: (container: DayContainer) => boolean;
  /**
   * SPEC §11's tag focus: the one tag every lens dims against, or null.
   *
   * It lives here, beside `focusedDay`, because both are "what the viewer is
   * currently narrowing to" and both must outlive a lens switch — this
   * provider is mounted above `LensRouter` on the trip page and on `/demo`,
   * so the state survives switching tabs by construction rather than by a URL
   * round-trip. They are deliberately NOT one value: a day focus and a tag
   * focus are independently settable and independently clearable (M18b's exit
   * gate: "Focus survives a lens switch, and is not confused with day focus"),
   * and folding them into one `focus: {kind, value}` union would make picking
   * a day silently drop a tag the viewer never cleared.
   */
  focusedTag: ActivityTag | null;
  /** Sets the tag, or clears it when it is already the focused one. */
  toggleFocusedTag: (tag: ActivityTag) => void;
  clearFocusedTag: () => void;
};
const Ctx = createContext<FocusCtx | null>(null);

export function useFocus(): FocusCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFocus outside FocusProvider");
  return v;
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [day, setDay] = useState<{ index: number | null; source: DayContainer | null }>({
    index: null,
    source: null,
  });
  const focusedDay = day.index;
  const focusSource = day.source;
  const focusOrigin: FocusOrigin = focusSource === null ? "explicit" : "scroll";
  const [focusedTag, setFocusedTag] = useState<ActivityTag | null>(null);

  // One deadline per container, in a ref rather than state: nothing renders
  // differently while a jump is in flight, and a re-render per jump would be a
  // re-render per scrolled day.
  const jumpUntil = useRef<Partial<Record<DayContainer, number>>>({});
  const beginDayJump = useCallback((container: DayContainer) => {
    jumpUntil.current[container] = Date.now() + DAY_JUMP_LOCK_MS;
  }, []);
  const endDayJump = useCallback((container: DayContainer) => {
    delete jumpUntil.current[container];
  }, []);
  const isDayJumping = useCallback(
    (container: DayContainer) => (jumpUntil.current[container] ?? 0) > Date.now(),
    [],
  );

  const setFocusedDay = useCallback((index: number | null) => {
    setDay({ index, source: null });
  }, []);

  // Functional, and the bail-out is inside it: a scroll spy fires on every
  // frame of a scroll, and returning the SAME object for an unchanged index is
  // what keeps this from re-rendering the whole board sixty times a second.
  // Comparing outside the updater would read a stale `day` from the closure the
  // handler was registered with.
  const setScrolledDay = useCallback((index: number, from: DayContainer) => {
    setDay((current) =>
      current.index === index && current.source === from ? current : { index, source: from },
    );
  }, []);

  // Single focus, one tag at a time (SPEC §11 — "multi-select was the part
  // that earned its keep least"), expressed as a toggle rather than a plain
  // setter so the "clicking the same chip clears it" rule lives in ONE place
  // instead of at every chip. The functional update is what makes that true
  // for two chips clicked in the same tick.
  const toggleFocusedTag = useCallback((tag: ActivityTag) => {
    setFocusedTag((current) => (current === tag ? null : tag));
  }, []);
  const clearFocusedTag = useCallback(() => setFocusedTag(null), []);

  const value = useMemo(
    () => ({
      focusedDay,
      setFocusedDay,
      setScrolledDay,
      focusOrigin,
      focusSource,
      beginDayJump,
      endDayJump,
      isDayJumping,
      focusedTag,
      toggleFocusedTag,
      clearFocusedTag,
    }),
    [
      focusedDay,
      setFocusedDay,
      setScrolledDay,
      focusOrigin,
      focusSource,
      beginDayJump,
      endDayJump,
      isDayJumping,
      focusedTag,
      toggleFocusedTag,
      clearFocusedTag,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * One container's handle on the contract. Called by whoever sits under the
 * provider — the lens itself, or the screen that renders a props-only day
 * control and passes the handle down.
 */
/**
 * Every scroll offset a `scrollIntoView` on `element` could possibly change:
 * the element's own, each ancestor's, and the document's.
 *
 * Read before and after the jump so `jumpTo` can tell a scroll that moved
 * something from one that had nothing to do — see there for why that matters.
 * The walk is bounded by DOM depth (tens of property reads) and is nothing
 * beside the forced layout `scrollIntoView` itself costs.
 */
function scrollOffsets(element: Element): number[] {
  const offsets: number[] = [];
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    offsets.push(node.scrollTop, node.scrollLeft);
  }
  // Truthy rather than `!== null`: the DOM types promise `Element | null`, and
  // jsdom hands back `undefined` — which a null check waves through and the
  // next line then throws on, taking a lens down in tests over a scroll offset.
  const root = element.ownerDocument.scrollingElement as Element | null | undefined;
  if (root) offsets.push(root.scrollTop, root.scrollLeft);
  return offsets;
}

export function useDaySync(container: DayContainer): DaySync {
  const { focusSource, setScrolledDay, beginDayJump, endDayJump, isDayJumping } = useFocus();

  const isOwnScroll = useCallback(() => isDayJumping(container), [isDayJumping, container]);

  const reportScrolled = useCallback(
    (index: number) => {
      // Guarded here as well as at the event (`useDayScrollSpy`): the event-time
      // check is an optimisation that skips a rect-per-day measurement, this one
      // is the rule. A direct caller that measures its own way still cannot feed
      // our own scroll back into the selection.
      if (isDayJumping(container)) return;
      setScrolledDay(index, container);
    },
    [isDayJumping, setScrolledDay, container],
  );

  const jumpTo = useCallback(
    (element: Element | null | undefined, options?: ScrollIntoViewOptions) => {
      // Feature-detected: jsdom implements no `scrollIntoView` at all, and the
      // jsdom lane has no layout for it to act on anyway. Throwing here would
      // take a whole lens down in tests for the sake of a scroll position.
      if (!element || typeof element.scrollIntoView !== "function") return false;
      const before = scrollOffsets(element);
      beginDayJump(container);
      element.scrollIntoView({
        // See DAY_JUMP_LOCK_MS for why every sync scroll is instant.
        behavior: "auto",
        // `block: "nearest"` is load-bearing on the horizontal rows, not a
        // default: the chips row lives inside a STICKY header, and
        // `scrollIntoView` scrolls every scrollable ancestor — with `"center"`
        // it would drag the whole PAGE vertically to centre a chip that was
        // never off-screen. `"nearest"` moves nothing on an axis that already
        // shows the element. The callers that genuinely want a page scroll (the
        // timeline, the calendar) pass their own `block`.
        block: "nearest",
        inline: "center",
        ...options,
      });
      // Nothing moved — the day was already in view — so there is no scroll
      // event coming and the lock has nothing to swallow but the user's own
      // next gesture. Dropped immediately rather than left to lapse, because
      // the commonest case of a jump that moves nothing is a container's
      // first-run follow on arrival (clause 3), and holding a dead lock there
      // would discard the first 300ms of the very flick Mitchell filed this
      // about. Safe to compare synchronously: `behavior: "auto"` scrolls before
      // this line runs, which is the other half of why the jumps are instant.
      if (scrollOffsets(element).every((offset, i) => offset === before[i])) endDayJump(container);
      return true;
    },
    [beginDayJump, endDayJump, container],
  );

  const shouldFollow = focusSource !== container;

  return useMemo(
    () => ({ shouldFollow, isOwnScroll, reportScrolled, jumpTo }),
    [shouldFollow, isOwnScroll, reportScrolled, jumpTo],
  );
}

/**
 * Contract clauses 2 and 3, for one container.
 *
 * Scrolls `focusedDay` into view whenever the selection changed and did not
 * come from this container's own scrolling — **and on mount**, which is clause
 * 3: a lens that has just been switched to has never scrolled itself, so it
 * jumps to whatever day was already selected.
 *
 * "On mount" is the whole of the exception, and getting that wrong is not
 * subtle. An earlier version latched on the first jump that actually happened
 * instead, so a container that mounted with NOTHING selected spent its
 * exception on the first day its OWN scrolling selected — the timeline then
 * scrolled the window back to the day you had just scrolled past, took the jump
 * lock, and swallowed the next 300ms of scrolling, which left the selection
 * stuck on the day where you first paused. Caught by
 * `e2e/m10-growth.spec.ts`'s existing scroll test, which is the only lane that
 * could catch it.
 *
 * `dayCount` is in the dependency list because the element may not exist yet
 * when the index does: `TimelineLens` focuses the day it is about to append,
 * whose header ref only attaches on the render that actually brings the day in.
 * That re-run is covered by `shouldFollow` (appending focuses explicitly), not
 * by the mount exception.
 */
export function useFollowFocusedDay(
  sync: DaySync | undefined,
  focusedDay: number | null,
  dayCount: number,
  resolve: (index: number) => Element | null | undefined,
  options?: ScrollIntoViewOptions,
): void {
  // Read through refs so the effect's deps stay the three things that decide
  // WHETHER to scroll; `resolve` is a fresh closure on every render and
  // `options` is usually a fresh object literal.
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mounted = useRef(false);

  const shouldFollow = sync?.shouldFollow ?? false;
  const jumpTo = sync?.jumpTo;

  useEffect(() => {
    // Latched before the early returns, so "this container has mounted" is
    // true even when it mounted with no day selected — see above.
    const first = !mounted.current;
    mounted.current = true;
    if (focusedDay === null || jumpTo === undefined) return;
    if (!first && !shouldFollow) return;
    jumpTo(resolveRef.current(focusedDay), optionsRef.current);
  }, [focusedDay, dayCount, shouldFollow, jumpTo]);
}

/**
 * Contract clause 1, for one container: the scroll handler to attach.
 *
 * `measure` returns the day on this container's reading line, or null — that is
 * the only part worth writing twice, and the arithmetic under it is pure and
 * separately tested (`centralDay.ts`). Attachment is left to the caller because
 * it differs: the rows listen on their own box, the timeline listens on
 * `document` in the capture phase (scroll events do not bubble, but they do
 * capture, and the timeline scrolls the window or any ancestor scrollport).
 *
 * Coalesced to one measurement per frame: `scroll` fires far more often than
 * the browser paints, and each pass reads a rect per day (a forced layout).
 * Same shape as the design's own `_cRAF` guard (`dc.html:3634`).
 */
export function useDayScrollSpy(sync: DaySync | undefined, measure: () => number | null): () => void {
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const report = sync?.reportScrolled;
  const isOwnScroll = sync?.isOwnScroll;

  return useCallback(() => {
    if (report === undefined) return;
    // Checked at the event rather than inside the frame: this is the scroll we
    // started ourselves, and skipping it here skips the measurement too.
    if (isOwnScroll?.()) return;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const index = measureRef.current();
      if (index !== null) report(index);
    });
  }, [report, isOwnScroll]);
}
