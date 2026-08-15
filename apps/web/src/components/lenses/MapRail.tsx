import type { AccentFamily } from "@/lib/dayAccent";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";
import type { MapDay } from "./mapRailData";

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
  return (
    <div
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
