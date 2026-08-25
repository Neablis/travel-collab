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

// dc.html:673's grip dots and :674's city name both render in the day's
// accent ink — same map as TimelineLens.tsx/KeepDayFlag.tsx's own INK_TEXT
// ("brand"'s darkest tone is `-pressed`, not a `-ink` token).
const INK_TEXT: Record<AccentFamily, string> = {
  brand: "text-brand-pressed",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-slate",
};

// Same family→ink mapping as INK_TEXT, as a background for the grip's dots
// (dc.html:670-672: `background: {{ c.ink }}`) rather than a text color.
const INK_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-pressed",
  info: "bg-info-ink",
  success: "bg-success-ink",
  warning: "bg-warning-ink",
  danger: "bg-danger-ink",
  neutral: "bg-slate",
};

// Handoff README §"Calendar view": 116px min cell height has no token
// equivalent — same computed-geometry escape hatch as TimelineLens/MapLens/
// DayChips' 10px transition label. dc.html:665's cell padding (8px 9px)
// joins it here: 9px isn't on Tailwind's spacing scale either.
const CELL_STYLE = { minHeight: "116px", padding: "8px 9px" };

// dc.html:663: the grid's own 10px corner radius — between --radius-md (8px)
// and --radius-lg (12px), so neither token lands on it.
const GRID_RADIUS = { borderRadius: "10px" };

// dc.html:662: weekday head font-size (11px) sits below --text-xs (12px).
const DOW_HEAD_SIZE = { fontSize: "11px" };

// dc.html:668: "Day N" on the cell's top-right, 10px — below --text-xs.
const DAY_LABEL_SIZE = { fontSize: "10px" };

// dc.html:679: the in-trip inner card's own radius (10px, same gap as
// GRID_RADIUS) and 7px/8px padding (7px isn't on the spacing scale).
const CARD_STYLE = { borderRadius: "10px", padding: "7px 8px" };

// dc.html:680: grip + city header row's 5px gap — off the spacing scale
// (nearest steps are 4px/6px).
const CARD_HEADER_GAP = { gap: "5px" };

// dc.html:682: city name, 11px/600 — below --text-xs.
const CITY_SIZE = { fontSize: "11px" };

// dc.html:684: the chip column's 3px gap — off the spacing scale.
const CHIP_STACK_GAP = { gap: "3px" };

// dc.html:685: each chip's 5px gap and 3px/6px padding — off the spacing
// scale (padding-y of 3px has no `py-*` step; the gap has no `gap-*` step).
const CHIP_STYLE = { gap: "5px", padding: "3px 6px" };

// dc.html:686: chip time, 9.5px — below --text-xs.
const CHIP_TIME_SIZE = { fontSize: "9.5px" };

// dc.html:687: chip name, 10.5px — below --text-xs.
const CHIP_NAME_SIZE = { fontSize: "10.5px" };

// dc.html:691: the more/summary line under the chips, 10px text + 5px
// margin-top — both off-scale.
const MORE_STYLE = { fontSize: "10px", marginTop: "5px" };

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

// 6-dot grip (dc.html:670-672): 3 rows of 2 dots, each 2px, in the day's
// accent ink. Rendered as a visual identity marker beside the city name
// ONLY — no cursor: grab, no drag handlers/drop targets (Mitchell's
// decision: a grip that advertises dragging and does nothing is the failure
// mode this project already rejected once; see TODO.md's "Unscheduled rack:
// drag support is Board-view-only" entry, extended by this task with the
// calendar's own gap).
function DayGrip({ accent }: { accent: AccentFamily }) {
  return (
    <span className="flex shrink-0 flex-col gap-0.5">
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex gap-0.5">
          {[0, 1].map((dot) => (
            <span key={dot} className={cn("h-0.5 w-0.5 rounded-full", INK_BG[accent])} />
          ))}
        </span>
      ))}
    </span>
  );
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
      // dc.html:3038's blank week-lead-in/trailing-pad cells render through
      // the SAME template as every other cell (an empty `num`), not a
      // separately-dimmed one — SPEC.md §4's month blocks are trimmed to the
      // weeks that matter, but the cells themselves are still plain surface.
      return (
        <div
          key={`blank-${cellIndex}`}
          className="bg-surface"
          // eslint-disable-next-line no-restricted-syntax -- dc.html:665's 116px min height / 8px-9px padding has no token equivalent
          style={CELL_STYLE}
        />
      );
    }

    if (!cell.inTrip || cell.ordinal === undefined) {
      // dc.html:665/678: every cell is bg-surface — out-of-trip days are
      // distinguished by having no inner card, not by a dimmed cell.
      return (
        <div
          key={cell.date}
          data-testid="calendar-cell"
          data-in-trip={false}
          className="bg-surface"
          // eslint-disable-next-line no-restricted-syntax -- dc.html:665's 116px min height / 8px-9px padding has no token equivalent
          style={CELL_STYLE}
        >
          <div className="flex items-center justify-between">
            <DataText size="xs">{Number(cell.date.slice(-2))}</DataText>
          </div>
        </div>
      );
    }

    const ordinal = cell.ordinal;
    const day = days[ordinal - 1];
    const accent = accents[ordinal - 1] ?? { tint: "neutral", ink: "neutral", solid: "neutral" };
    // dc.html:685-691: up to three chips sit ABOVE the more/summary line —
    // 8b.5's brief covered only that line and never mentioned this array,
    // so the chips never rendered at all. Time first (blank when the stop
    // isn't timed — the day itself can hold a mix, per stopsSummary above).
    const chips = cell.activityIds.slice(0, 3).map((activityId) => {
      const activity = detail.activities[activityId];
      return {
        activityId,
        time: activity?.timeWindow ? toClockLabel(activity.timeWindow.start) : "",
        name: activity?.title ?? "",
      };
    });

    return (
      // Outer surface cell IS the clickable button (dc.html's own click
      // target is narrower — just the grip/city header, which also jumps to
      // a different view — but Calendar cells already set focus via
      // useFocus() on the whole cell; this task is presentational only, so
      // that existing interaction is kept rather than narrowed or widened).
      <Button
        key={cell.date}
        variant="ghost"
        data-testid="calendar-cell"
        data-in-trip={true}
        aria-label={`Day ${ordinal}${day?.city ? `, ${day.city}` : ""}`}
        onClick={() => setFocusedDay(ordinal - 1)}
        className="h-full w-full flex-col items-stretch justify-start rounded-none bg-surface text-left hover:opacity-90"
        // eslint-disable-next-line no-restricted-syntax -- dc.html:665's 116px min height / 8px-9px padding has no token equivalent
        style={CELL_STYLE}
      >
        <div className="flex items-center justify-between">
          <DataText size="xs">{Number(cell.date.slice(-2))}</DataText>
          <span
            className={cn("font-semibold", INK_TEXT[accent.ink])}
            // eslint-disable-next-line no-restricted-syntax -- dc.html:668's 10px "Day N" label has no token equivalent
            style={DAY_LABEL_SIZE}
          >
            Day {ordinal}
          </span>
        </div>
        <div
          data-testid="calendar-day-card"
          className={cn("mt-1.5 min-w-0", TINT_BG[accent.tint])}
          // eslint-disable-next-line no-restricted-syntax -- dc.html:679's 10px radius / 7px-8px padding has no token equivalent
          style={CARD_STYLE}
        >
          <div
            className="flex items-center"
            // eslint-disable-next-line no-restricted-syntax -- dc.html:680's 5px header gap has no token equivalent
            style={CARD_HEADER_GAP}
          >
            <DayGrip accent={accent.ink} />
            <span
              className={cn("min-w-0 flex-1 truncate font-semibold", INK_TEXT[accent.ink])}
              // eslint-disable-next-line no-restricted-syntax -- dc.html:682's 11px city name has no token equivalent
              style={CITY_SIZE}
            >
              {day?.city}
            </span>
          </div>
          <div
            className="mt-1.5 flex flex-col"
            // eslint-disable-next-line no-restricted-syntax -- dc.html:684's 3px chip-stack gap has no token equivalent
            style={CHIP_STACK_GAP}
          >
            {chips.map((chip) => (
              <div
                key={chip.activityId}
                data-testid="calendar-chip"
                className="flex min-w-0 items-baseline rounded-sm bg-surface"
                // eslint-disable-next-line no-restricted-syntax -- dc.html:685's 5px gap / 3px-6px padding has no token equivalent (radius is rounded-sm, a real token)
                style={CHIP_STYLE}
              >
                <DataText
                  size="xs"
                  className="shrink-0"
                  // eslint-disable-next-line no-restricted-syntax -- dc.html:686's 9.5px chip time has no token equivalent
                  style={CHIP_TIME_SIZE}
                >
                  {chip.time}
                </DataText>
                <span
                  className="min-w-0 flex-1 truncate text-ink"
                  // eslint-disable-next-line no-restricted-syntax -- dc.html:687's 10.5px chip name has no token equivalent
                  style={CHIP_NAME_SIZE}
                >
                  {chip.name}
                </span>
              </div>
            ))}
          </div>
          {/* Phase 6, copy table row "calendar empty day"; dc.html:691's
              summary line BELOW the chips. Only in-trip cells reach here —
              the !cell.inTrip branch above returns first — so a day outside
              the trip stays a bare, dimmed date number and never claims a
              plan is missing from it. */}
          <DataText
            size="xs"
            className="block truncate"
            // eslint-disable-next-line no-restricted-syntax -- dc.html:691's 10px summary text / 5px margin-top has no token equivalent
            style={MORE_STYLE}
          >
            {stopsSummary(cell.activityIds, detail.activities)}
          </DataText>
        </div>
      </Button>
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
            {/* dc.html:663: 7-column grid, 1px hairline gaps drawing the grid
                lines (gap-px is a stock Tailwind utility, not an arbitrary
                bracket value) over a hairline background, ringed by a
                hairline border and clipped to a 10px radius. */}
            <div
              role="grid"
              aria-label={`Trip calendar, ${month.label}`}
              className="grid grid-cols-7 gap-px overflow-hidden border border-hairline bg-hairline"
              // eslint-disable-next-line no-restricted-syntax -- dc.html:663's 10px grid radius has no token equivalent
              style={GRID_RADIUS}
            >
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="bg-surface py-2.5 px-3 text-center font-semibold uppercase tracking-wider text-slate"
                  // eslint-disable-next-line no-restricted-syntax -- dc.html:662's 11px weekday head has no token equivalent
                  style={DOW_HEAD_SIZE}
                >
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
