"use client";

import type { TripDetail } from "@tc/contracts";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { Button } from "../ui/button";
import { chipModel } from "../trip/DayChips";
import { useFocus } from "../trip/context/FocusProvider";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";
import { calendarCells } from "./calendarData";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const cells = calendarCells(detail);
  // Same per-day city derivation Task 8's DayChips established, reused via
  // chipModel rather than re-deriving it (mirrors TimelineLens.tsx). Indexed
  // by 0-based day index — cell.ordinal is 1-based, so look up days[ordinal - 1].
  const days = chipModel(detail);
  // One dayAccents() call over the whole trip's cities so collisions between
  // this trip's own days get probed, rather than each day resolving blind to
  // every other day.
  const accents = dayAccents(days.map((d) => d.city));
  const { setFocusedDay } = useFocus();

  return (
    <section>
      {cells.length === 0 ? (
        <Text as="span" variant="secondary" role="status">
          Set a start date to see the calendar.
        </Text>
      ) : (
        // Handoff README §"Calendar view": 7-column grid with 1px hairline
        // gaps — gap-px is a stock Tailwind utility (not an arbitrary bracket
        // value), and the bg-hairline base + bg-paper cells produce the 1px
        // seam.
        <div role="grid" aria-label="Trip calendar" className="mt-2 grid grid-cols-7 gap-px bg-hairline">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="bg-paper text-center text-xs font-semibold text-slate">
              {label}
            </div>
          ))}
          {cells.map((cell) => {
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
            const firstActivityId = cell.activityIds[0];
            const firstStopTitle = firstActivityId ? detail.activities[firstActivityId]?.title : undefined;
            const moreCount = cell.activityIds.length - 1;

            return (
              <Button
                key={cell.date}
                variant="ghost"
                data-testid="calendar-cell"
                data-in-trip={true}
                aria-label={`Day ${ordinal}${day?.city ? `, ${day.city}` : ""}`}
                onClick={() => setFocusedDay(ordinal - 1)}
                className={cn(
                  "h-auto flex-col items-start justify-start gap-0.5 rounded-none p-1 text-left hover:opacity-90",
                  TINT_BG[accent.tint],
                )}
                // eslint-disable-next-line no-restricted-syntax -- 116px min cell height (handoff spec) has no token equivalent
                style={CELL_MIN_HEIGHT}
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
                {firstStopTitle && (
                  <Text as="span" variant="muted" className="w-full truncate text-xs">
                    {firstStopTitle}
                  </Text>
                )}
                {moreCount > 0 && <DataText size="xs">+{moreCount} more</DataText>}
                {/* Phase 6, copy table row "calendar empty day". Only in-trip
                    cells reach here — the !cell.inTrip branch above returns
                    first — so a day outside the trip stays a bare, dimmed date
                    number and never claims a plan is missing from it. Days
                    holding zero stops are valid in the projection, so this is
                    an honest reading of real state, not a placeholder. */}
                {cell.activityIds.length === 0 && (
                  <Text as="span" variant="muted" className="w-full truncate text-xs">
                    Nothing planned yet
                  </Text>
                )}
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}
