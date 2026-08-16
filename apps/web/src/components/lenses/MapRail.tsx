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
            track transform below. overflow:hidden matters: without it the
            overflowing buttons would extend the container's own scrollable
            area and corrupt the gearing math. */}
        {/* eslint-disable-next-line no-restricted-syntax -- height is measured geometry, set from the effect above */}
        <div ref={clipRef} className="sticky top-0 overflow-hidden" style={{ height: "auto" }}>
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
