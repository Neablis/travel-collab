import { useEffect, useRef } from "react";
import type { AccentFamily } from "@/lib/dayAccent";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";
import type { MapDay } from "./mapRailData";
import { gearedTravel, pickFocusedDay, railScrollGeometry, type RailItem } from "./mapRailFocus";
import { onMapRailTuningChange, readMapRailTuning } from "./mapRailTuning";

// Tailwind's JIT can't see a template-interpolated `bg-${accent}-tint` —
// same static-Record pattern as DayChips.tsx's CHIP_BG.
const TINT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
};
const SOLID_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

// Handoff `current/…dc.html:630-668` "maprail": a floating day list, each
// button carrying its own accent's left spine at all times; only the focused
// day additionally gets that accent's tinted background. Inactive days keep
// full-strength text — the tint + spine are the only active-state signal
// (a deliberate removal of the old "grey out inactive" convention).
export function MapRail({
  days,
  focusedDay,
  onFocus,
}: {
  days: MapDay[];
  focusedDay: number | null;
  onFocus: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Map<number, HTMLButtonElement>>(new Map());
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const lastEmittedRef = useRef(focusedDay);
  lastEmittedRef.current = focusedDay;

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
      geometry.contentHeight > geometry.viewportHeight
        ? gearedTravel(geometry.items.length, scrollPxPerDay)
        : 0;

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

    // Tab-ing to a button the track's transform has scrolled outside the
    // visible band makes the browser natively scroll `container` to reveal
    // it (verified live) — but its heuristic assumes an ordinary linear
    // relationship between scrollTop and visual position, which gearing
    // breaks (a geared pixel of scrollTop moves the track by far less than
    // one visual pixel), so the browser's own attempt lands the button only
    // partially inside the band. This corrects it, deferred one tick so it
    // runs after — and so wins over — the browser's own attempt.
    //
    // Critically, this does NOT just "center the button in the viewport": an
    // earlier version did exactly that, and it disagreed with what
    // `pickFocusedDay` would then read back for most indices (the two are
    // different questions — centering asks "where should this button sit
    // on screen", pickFocusedDay asks "which button is the sweeping focus
    // line closest to"), so clicking a day could silently re-focus and
    // rescroll to a *different* day. This instead solves `pickFocusedDay`'s
    // own equation for the `scrollTop` that puts the sweep line exactly on
    // this item's center — i.e. the inverse of `focusLine = offset +
    // viewportHeight × lerp(focusLineStart, focusLineEnd, progress)` with
    // `offset = progress × naturalTravel` — so the button that receives
    // focus is *always* the one `pickFocusedDay` reports next, at any
    // tuning, not only the sweep's default 0/1 focus-line span.
    const focusRailButtonIntoView = (index: number) => {
      const item = geometry.items.find((i) => i.index === index);
      if (!item) return;
      const naturalTravel = Math.max(0, geometry.contentHeight - geometry.viewportHeight);
      const tuning = readMapRailTuning();
      const travel = travelFor(tuning.scrollPxPerDay);
      if (naturalTravel <= 0 || travel <= 0) return;
      const center = item.offsetTop + item.height / 2;
      const span = naturalTravel + geometry.viewportHeight * (tuning.focusLineEnd - tuning.focusLineStart);
      const progress = Math.min(Math.max(span > 0 ? (center - geometry.viewportHeight * tuning.focusLineStart) / span : 0, 0), 1);
      // The sweep line is a single point within the viewport band, not "the
      // item's center" — near either end of the range it can sit close
      // enough to an edge that the item's own height pokes past it (most
      // visible at the very first/last day). Nudge the offset just enough
      // to keep the whole item on screen; that nudge stays well inside this
      // item's own zone (sweep transitions are spaced a full button height
      // apart), so pickFocusedDay still reads back this same index after.
      const idealOffset = progress * naturalTravel;
      const offset = Math.min(
        Math.max(idealOffset, item.offsetTop + item.height - geometry.viewportHeight),
        item.offsetTop,
      );
      const clampedOffset = Math.min(Math.max(offset, 0), naturalTravel);
      container.scrollTop = (clampedOffset / naturalTravel) * travel;
    };
    let focusCorrectionTimer: ReturnType<typeof setTimeout> | undefined;
    const handleFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      for (const [index, el] of buttonsRef.current) {
        if (el === event.target) {
          if (focusCorrectionTimer) clearTimeout(focusCorrectionTimer);
          focusCorrectionTimer = setTimeout(() => {
            focusCorrectionTimer = undefined;
            focusRailButtonIntoView(index);
          }, 0);
          return;
        }
      }
    };
    container.addEventListener("focusin", handleFocusIn);

    return () => {
      resizeObserver.disconnect();
      unsubscribeTuning();
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("focusin", handleFocusIn);
      if (trailingTimer) clearTimeout(trailingTimer);
      if (focusCorrectionTimer) clearTimeout(focusCorrectionTimer);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measuring on day identity change only; onFocus/focusedDay are read via refs above
  }, [days.map((d) => d.dayId).join(",")]);

  return (
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
      {/* eslint-disable-next-line no-restricted-syntax -- height is measured geometry, set from the effect above */}
      <div ref={spacerRef} data-rail-spacer style={{ height: "auto" }}>
        {/* Sticky, so the compositor pins the day list to the rail's viewport
            as the spacer scrolls past — the only per-frame JS write is the
            track transform below. Clipping matters: without it the
            overflowing buttons would extend the container's own scrollable
            area and corrupt the gearing math. `overflow-clip`, not
            `overflow-hidden`: `hidden` still makes this box a scroll
            container the browser will natively scroll to bring a focused
            descendant into view (e.g. Tab-ing to a button the track's
            transform has scrolled outside the visible band), and since this
            box's own position is entirely the track's transform's job,
            that native scroll stacks a second, uncoordinated offset on top
            and leaves the focused button clipped out of view once anything
            corrects it back — a real, live-verified regression (confirmed
            with a focused Playwright reproduction: after 10 Tabs the
            focused button sat ~500px below the clip's visible band while
            holding focus). `overflow: clip` still constrains scrollable
            overflow for the gearing math (verified: container.scrollHeight
            unaffected) but creates no scrollport of its own, so there is
            nothing for the browser to scroll here — it scrolls the real
            container instead, which already flows through `handleScroll`
            above — but only partially: the browser's own scroll-into-view
            heuristic assumes an ordinary linear scrollTop-to-position
            relationship, which this rail's gearing breaks, so it lands the
            button only partially inside the band (confirmed live: tens to
            hundreds of pixels still clipped, worse near either end of the
            range and under rapid Tab bursts). The effect's
            `focusRailButtonIntoView` (see the `focusin` listener below)
            completes the reveal using the rail's actual gearing math. */}
        {/* eslint-disable-next-line no-restricted-syntax -- height is measured geometry, set from the effect above */}
        <div ref={clipRef} className="sticky top-0 overflow-clip" style={{ height: "auto" }}>
          {/* eslint-disable-next-line no-restricted-syntax -- transform is the geared scroll offset, not a themeable value */}
          <div ref={trackRef} data-rail-track style={{ willChange: "transform" }}>
            {days.map((day) => {
              const active = day.index === focusedDay;
              return (
                // eslint-disable-next-line no-restricted-syntax -- a rich custom list-item control, not a Button-variant action; Button's base classes always carry `disabled:opacity-50` in the string regardless of state, which would defeat the "inactive days don't grey out" contract this element's className is asserted against
                <button
                  key={day.dayId}
                  ref={(el) => {
                    if (el) buttonsRef.current.set(day.index, el);
                    else buttonsRef.current.delete(day.index);
                  }}
                  data-day-index={day.index}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onFocus(day.index)}
                  className={cn(
                    "block w-full cursor-pointer border-b border-hairline px-3.5 py-3 text-left text-ink transition-colors hover:bg-paper",
                    active ? TINT_BG[day.accent] : "bg-transparent",
                  )}
                  // eslint-disable-next-line no-restricted-syntax -- 3px left spine has no Tailwind border-width step (0/2/4/8), matching TimelineLens's computed-geometry pattern
                  style={{ borderLeftWidth: "3px", borderLeftColor: `var(--color-${day.accent})` }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="font-bold uppercase text-ink"
                      // eslint-disable-next-line no-restricted-syntax -- 11px day label has no token equivalent (between text-xs/12px and nothing smaller)
                      style={{ fontSize: "11px", letterSpacing: "0.05em" }}
                    >
                      {day.label}
                    </span>
                    {day.date !== null && (
                      <span
                        className="font-mono text-slate"
                        // eslint-disable-next-line no-restricted-syntax -- 11px date has no token equivalent
                        style={{ fontSize: "11px" }}
                      >
                        {formatTripDate(day.date)}
                      </span>
                    )}
                  </div>
                  {day.city !== null && <div className="text-sm font-semibold text-ink">{day.city}</div>}
                  <div
                    className="mt-1.5 font-mono text-slate"
                    // eslint-disable-next-line no-restricted-syntax -- 11px totals line has no token equivalent
                    style={{ fontSize: "11px", letterSpacing: "-0.01em" }}
                  >
                    {day.stops.length} stop{day.stops.length === 1 ? "" : "s"}
                    {day.totalKm !== null && ` · ${day.totalKm.toFixed(1)} km`}
                  </div>
                  {day.bars.length > 0 && (
                    <div
                      className="mt-2 flex gap-0.5"
                      // eslint-disable-next-line no-restricted-syntax -- 6px bar-row height has no token equivalent
                      style={{ height: "6px" }}
                    >
                      {day.bars.map((bar, i) => (
                        <div
                          key={i}
                          className={cn("h-full rounded-full", SOLID_BG[bar.color])}
                          // eslint-disable-next-line no-restricted-syntax -- each bar's grow is a per-leg distance share, not expressible as a token
                          style={{ flexGrow: bar.grow }}
                        />
                      ))}
                    </div>
                  )}
                  {day.flagText !== null && (
                    <div
                      className="mt-2 rounded-md bg-warning-tint px-2 py-1.5 text-warning-ink"
                      // eslint-disable-next-line no-restricted-syntax -- 11.5px flag text has no token equivalent
                      style={{ fontSize: "11.5px" }}
                    >
                      {day.flagText}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
