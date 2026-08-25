"use client";

import type { TripDetail } from "@tc/contracts";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { Button } from "../ui/button";
import { chipModel } from "../trip/DayChips";
import { useFocus } from "../trip/context/FocusProvider";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { toClockLabel } from "@/lib/time";
import { cn } from "@/lib/cn";
import { calendarMonths, type CalendarCell } from "./calendarData";

// SPEC.md §4 / the handoff design: Sunday-start, not the old Monday-start
// grid — this is where the flip happens.
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Same static-map pattern as DayChips.tsx's CHIP_BG / TimelineLens.tsx's
// TINT_BG — Tailwind's JIT scanner can't see a template-interpolated
// `bg-${family}-tint`.
const TINT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

// Handoff README §"Calendar view": 116px min cell height has no token
// equivalent — same computed-geometry escape hatch as TimelineLens/MapLens/
// DayChips' 10px transition label.
const CELL_MIN_HEIGHT = { minHeight: "116px" };

// SPEC.md §4: 26px between stacked month blocks — no spacing token lands on
// it (the scale steps 24px/28px either side), same escape hatch as
// UnscheduledRack's 26px row padding.
const MONTH_GAP = { gap: "26px" };

// dc.html:3044 — 17px/600 month header; --text-lg is 19px, --text-md is
// 16px, neither matches.
const MONTH_LABEL_SIZE = { fontSize: "17px" };

// The per-day summary line (dc.html:3053): "N stops · 9 am – 5:30 pm", or
// "Nothing planned yet" for an in-trip day with no stops. Supersedes Task
// 8.6's "+N more" line — see this task's commit message. Unlike the design's
// literal mock (which assumes every stop is time-windowed and already in
// time order), real activities can be untimed, so only timed stops
// contribute a range. The end is the max over every window's end, not the
// last window sorted by start — a window can nest inside an earlier, longer
// one (9–17 then 10–11), so "sorted by start, take the last end" would
// silently shrink the reported span. (timelineRows' `timed.sort` is not
// precedent here: that sort only orders rows for display, it never derives
// a boundary value from the result.)
function stopsSummary(activityIds: string[], activities: TripDetail["activities"]): string {
  if (activityIds.length === 0) return "Nothing planned yet";
  const count = activityIds.length;
  const label = `${count} stop${count === 1 ? "" : "s"}`;

  const timed = activityIds
    .map((id) => activities[id]?.timeWindow)
    .filter((window): window is NonNullable<typeof window> => window != null);
  if (timed.length === 0) return label;

  const start = timed.reduce((min, w) => (w.start < min ? w.start : min), timed[0]!.start);
  const end = timed.reduce((max, w) => (w.end > max ? w.end : max), timed[0]!.end);
  return `${label} · ${toClockLabel(start)} – ${toClockLabel(end)}`;
}

export function CalendarLens({
  detail,
  // Restyle only: the prop stays in the signature for API consistency with
  // ScheduleLens/TripBoardScreen's other lenses, but Calendar's own
  // interaction no longer opens the activity editor per-activity — clicking
  // an in-trip cell now sets focus (setFocusedDay) like Task 8's DayChips,
  // per the plan brief ("Calendar cells set focus via useFocus()"). It is
  // intentionally unused inside this component.
  onSelectActivity: _onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const months = calendarMonths(detail);
  // Same per-day city derivation Task 8's DayChips established, reused via
  // chipModel rather than re-deriving it (mirrors TimelineLens.tsx). Indexed
  // by 0-based day index — cell.ordinal is 1-based, so look up days[ordinal - 1].
  const days = chipModel(detail);
  // One dayAccents() call over the whole trip's cities so collisions between
  // this trip's own days get probed, rather than each day resolving blind to
  // every other day.
  const accents = dayAccents(days.map((d) => d.city));
  const { setFocusedDay } = useFocus();

  if (months.length === 0) {
    return (
      <section>
        <Text as="span" variant="secondary" role="status">
          Set a start date to see the calendar.
        </Text>
      </section>
    );
  }

  function renderCell(cell: CalendarCell, cellIndex: number) {
    if (cell.blank) {
      return (
        <div
          key={`blank-${cellIndex}`}
          className="bg-paper"
          // eslint-disable-next-line no-restricted-syntax -- 116px min cell height (handoff spec) has no token equivalent
          style={CELL_MIN_HEIGHT}
        />
      );
    }

    if (!cell.inTrip || cell.ordinal === undefined) {
      return (
        <div
          key={cell.date}
          data-testid="calendar-cell"
          data-in-trip={false}
          className="bg-paper p-1 opacity-40"
          // eslint-disable-next-line no-restricted-syntax -- 116px min cell height (handoff spec) has no token equivalent
          style={CELL_MIN_HEIGHT}
        >
          <DataText size="xs">{Number(cell.date.slice(-2))}</DataText>
        </div>
      );
    }

    const ordinal = cell.ordinal;
    const day = days[ordinal - 1];
    const accent = accents[ordinal - 1] ?? { tint: "neutral", ink: "neutral", solid: "neutral" };

    return (
      // Outer surface cell (design: "a tinted button INSIDE a surface
      // cell, not a tinted cell itself"). This div carries bg-surface
      // and the 116px min height; the tint lives on the inner Button.
      // flex + the button's h-full stretches the button to fill the
      // cell rather than leaving the tint short of the cell's edges.
      <div
        key={cell.date}
        className="flex bg-surface"
        // eslint-disable-next-line no-restricted-syntax -- 116px min cell height (handoff spec) has no token equivalent
        style={CELL_MIN_HEIGHT}
      >
        <Button
          variant="ghost"
          data-testid="calendar-cell"
          data-in-trip={true}
          aria-label={`Day ${ordinal}${day?.city ? `, ${day.city}` : ""}`}
          onClick={() => setFocusedDay(ordinal - 1)}
          className={cn(
            "h-full w-full flex-col items-start justify-start gap-0.5 rounded-none p-1 text-left hover:opacity-90",
            TINT_BG[accent.tint],
          )}
        >
          <DataText size="xs">{Number(cell.date.slice(-2))}</DataText>
          <Text as="span" variant="muted" className="w-full truncate text-xs font-semibold">
            Day {ordinal}
          </Text>
          {day?.city && (
            <Text as="span" variant="muted" className="w-full truncate text-xs">
              {day.city}
            </Text>
          )}
          {/* Phase 6, copy table row "calendar empty day"; dc.html:3053's
              summary line for a day that does hold stops. Only in-trip cells
              reach here — the !cell.inTrip branch above returns first — so a
              day outside the trip stays a bare, dimmed date number and never
              claims a plan is missing from it. */}
          <Text as="span" variant="muted" className="w-full truncate text-xs">
            {stopsSummary(cell.activityIds, detail.activities)}
          </Text>
        </Button>
      </div>
    );
  }

  return (
    <section>
      <div
        className="mt-2 flex flex-col"
        // eslint-disable-next-line no-restricted-syntax -- 26px month-block gap (handoff spec) has no token equivalent, matching UnscheduledRack's computed-geometry pattern
        style={MONTH_GAP}
      >
        {months.map((month) => (
          <div key={month.label}>
            <div className="flex items-baseline gap-2.5 pb-2">
              <span
                className="font-display font-semibold text-ink"
                // eslint-disable-next-line no-restricted-syntax -- 17px month header (handoff spec) has no token equivalent
                style={MONTH_LABEL_SIZE}
              >
                {month.label}
              </span>
              {month.note && <DataText size="xs">{month.note}</DataText>}
            </div>
            {/* Handoff README §"Calendar view": 7-column grid with 1px hairline
                gaps — gap-px is a stock Tailwind utility (not an arbitrary
                bracket value), and the bg-hairline base + bg-paper cells
                produce the 1px seam. */}
            <div
              role="grid"
              aria-label={`Trip calendar, ${month.label}`}
              className="grid grid-cols-7 gap-px bg-hairline"
            >
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="bg-paper text-center text-xs font-semibold text-slate">
                  {label}
                </div>
              ))}
              {month.cells.map((cell, cellIndex) => renderCell(cell, cellIndex))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
