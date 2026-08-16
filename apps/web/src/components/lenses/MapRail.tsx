import { useEffect, useRef } from "react";
import type { AccentFamily } from "@/lib/dayAccent";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";
import type { MapDay } from "./mapRailData";

// A light leading+trailing throttle on scroll-driven focus evaluation: the
// first scroll event of a burst reacts immediately (so focus jumps promptly,
// not after scrolling stops), and further events inside the same window
// collapse into a single trailing evaluation instead of firing once per
// pixel. Mitchell's explicit feedback: he expects focus to "jump" live as he
// scrolls, not wait for scrolling to fully stop — a prior "settle after
// 150ms of no scroll events" debounce read as sluggish and was rejected.
const SCROLL_THROTTLE_MS = 50;

// Tolerance (px) for "the rail is scrolled to its scroll boundary" — real
// browsers can leave a sub-pixel remainder at max scrollTop depending on
// zoom/DPI, so an exact equality check would be flaky.
const BOUNDARY_EPSILON_PX = 4;

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

  // Scroll-driven focus: as the user scrolls the rail's own list, whichever
  // day button is most visible in the rail's viewport becomes focused — the
  // same onFocus callback a click already uses, so this is additive, not a
  // parallel code path. An IntersectionObserver (scoped to this container as
  // its `root`) tracks how visible each day is; a native `scroll` listener
  // on the same container decides *when* to act on that data, lightly
  // throttled (see SCROLL_THROTTLE_MS) purely to avoid re-evaluating on
  // every single scroll pixel — NOT debounced to wait for scrolling to stop.
  // The dominant day is meant to change live, promptly, while the user is
  // still scrolling. Deliberately does NOT fire from the observer's initial
  // (mount-time) callback, since that is not the user scrolling — only a
  // real "scroll" event triggers an evaluation, so mounting never silently
  // overrides whatever focus the caller started with. There is also no
  // "scroll the focused day into view" effect here (not asked for, and it
  // would create a feedback loop with this one), so a click-driven focus
  // change never re-enters this path.
  //
  // Picking "the most visible day" also has to handle two edge cases:
  //   - Many-at-once visibility: with short day rows and a tall-enough rail
  //     viewport, several days can be simultaneously at (or near) 100%
  //     intersection ratio at once — not a rare edge case here, the common
  //     one (measured live: ~95px-tall buttons in a ~600px viewport puts up
  //     to 6 days at ratio ~1 simultaneously). Ratio can't disambiguate
  //     between them, so "most visible" is decided by position instead:
  //     whichever day's own center is closest to the rail's own viewport
  //     center (the standard scroll-spy technique) — exactly one button is
  //     closest at any given scroll position, so this naturally produces a
  //     smooth, progressive one-day-at-a-time change as the user scrolls,
  //     regardless of how many buttons fit on screen at once. A day still
  //     has to clear a minimum-visibility bar (isIntersecting / ratio > 0)
  //     to be a candidate at all, so something scrolled fully out of view is
  //     never picked just for having a nearby center.
  //   - Scroll boundaries: center-distance math can still leave the true
  //     last day under-favoured once it's the only thing left to scroll to
  //     (its center never quite reaches the viewport's center). When the
  //     rail is scrolled to (within BOUNDARY_EPSILON_PX of) its max
  //     scrollTop, focus is forced to the last day outright — guaranteeing
  //     it's always reachable by scrolling to the bottom, which is more
  //     robust than relying on position math to get every layout right.
  //     Symmetric handling at the top prefers the first day for consistency.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver !== "function") return;

    type DayGeometry = { ratio: number; intersecting: boolean; centerY: number | null };
    const geometryByIndex = new Map<number, DayGeometry>();
    // A real IntersectionObserverEntry's rootBounds is the root's (this
    // container's) own client rect, delivered alongside every entry — reused
    // across evaluations rather than re-queried via getBoundingClientRect(),
    // keeping this consistent with the existing IntersectionObserver-based
    // architecture instead of introducing a parallel measurement path.
    let rootCenterY: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.dayIndex);
          const rect = entry.boundingClientRect;
          const centerY = rect ? (rect.top + rect.bottom) / 2 : null;
          geometryByIndex.set(index, { ratio: entry.intersectionRatio, intersecting: entry.isIntersecting, centerY });
          if (entry.rootBounds) rootCenterY = (entry.rootBounds.top + entry.rootBounds.bottom) / 2;
        }
      },
      { root: container, threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    for (const el of buttonsRef.current.values()) observer.observe(el);

    const evaluate = () => {
      if (days.length === 0) return;
      const hasOverflow = container.scrollHeight > container.clientHeight;
      const atBottom =
        hasOverflow && container.scrollTop + container.clientHeight >= container.scrollHeight - BOUNDARY_EPSILON_PX;
      const atTop = hasOverflow && container.scrollTop <= BOUNDARY_EPSILON_PX;

      let bestIndex: number;
      if (atBottom) {
        bestIndex = days[days.length - 1]!.index;
      } else if (atTop) {
        bestIndex = days[0]!.index;
      } else {
        let closestIndex: number | undefined;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (const d of days) {
          const geometry = geometryByIndex.get(d.index);
          if (!geometry) continue;
          if (!geometry.intersecting && geometry.ratio <= 0) continue;
          const distance =
            geometry.centerY !== null && rootCenterY !== null
              ? Math.abs(geometry.centerY - rootCenterY)
              : Number.POSITIVE_INFINITY;
          if (closestIndex === undefined || distance < closestDistance) {
            closestDistance = distance;
            closestIndex = d.index;
          }
        }
        bestIndex = closestIndex ?? days[0]!.index;
      }

      if (bestIndex !== lastEmittedRef.current) {
        lastEmittedRef.current = bestIndex;
        onFocusRef.current(bestIndex);
      }
    };

    let lastRun = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | undefined;
    const handleScroll = () => {
      const now = Date.now();
      if (now - lastRun >= SCROLL_THROTTLE_MS) {
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = undefined;
        }
        lastRun = now;
        evaluate();
      } else if (!trailingTimer) {
        trailingTimer = setTimeout(
          () => {
            trailingTimer = undefined;
            lastRun = Date.now();
            evaluate();
          },
          SCROLL_THROTTLE_MS - (now - lastRun),
        );
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
      if (trailingTimer) clearTimeout(trailingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-observing on every day identity change (not every focus/onFocus change) is intentional; onFocus/focusedDay are read via refs above instead
  }, [days.map((d) => d.dayId).join(",")]);

  return (
    <div
      ref={containerRef}
      aria-label="Days"
      className="absolute overflow-y-auto rounded-2xl border border-hairline bg-surface shadow-overlay"
      // eslint-disable-next-line no-restricted-syntax -- 268px rail width + 16px inset + z-index 4 have no token equivalent, matching AssistantRail's computed-geometry pattern
      style={{ left: "16px", top: "16px", bottom: "16px", width: "268px", zIndex: 4 }}
    >
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
  );
}
