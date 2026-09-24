"use client";
import type { WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { formatTripDate } from "@/lib/formatDate";
import { toClockLabel } from "@/lib/time";
import { localTodayIso, useToday } from "@/lib/today";

// "Weather" (M14 link 11, ADR-052) — one row per (day, city), each saying its
// mode in words, over a footer that says how old the data is and whose it is.
//
// **The footer is the block's, not the author's** (decision 5): the credit for
// every source whose data is on the block, and the as-of line before it
// (decision 7). A widget has no param that could remove either, and the one
// URL here comes from the payload's fixed table, never from fetched data.
//
// **Every row is one fixed height whatever its mode** (ADR-044): a forecast
// row and a typical row carry the same columns, and a column a mode has no
// value for keeps its place with a dash rather than closing up. So the
// block's height is a function of the trip's days, not of the calendar, and
// the page does not move when a day crosses into the forecast.
//
// **It fits the notebook's column** (Mitchell, on the #221 preview: *"We need
// to scroll to the right to see all the data here"*). The conditions cell is
// the one that gives — it flexes and truncates — and every other column is a
// fixed width shared by the heading row and every data row, so they line up.
// The "now" column is only there when some row has a now: a column of dashes
// was width the conditions could have had. Below `min-w-112` a row stops
// shrinking and the table scrolls on its own, which is the phone's case (the
// trip strip's rule, design-system.md): wrapping a row onto two lines would
// break the fixed height above.
//
// Spans with table roles, not `<table>`: a widget node is an inline atom and
// renders inside a paragraph (`ItineraryDayBlock` records the hydration error).

// Local wall-clock `HH:MM`, which is what `toClockLabel` reads.
const clockOf = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

/**
 * The forecast's as-of in the READER's own zone (decision 7): the time alone
 * when it is from today, the date as well when it is not — a stale row served
 * after a failed revalidation must not read as this morning's. On the house
 * 12-hour clock (Mitchell: *"All times should be in AM/PM not military time"*).
 */
export function asOfText(iso: string, today: string): string {
  const at = new Date(iso);
  const day = localTodayIso(at);
  const clock = toClockLabel(clockOf(at));
  return `Forecast as of ${day === today ? clock : `${formatTripDate(day)}, ${clock}`}`;
}

// One place for each column's width, so the heading row and the data rows
// cannot disagree about where a column is.
const COL = {
  place: "w-24 shrink-0",
  conditions: "min-w-0 flex-1",
  now: "w-12 shrink-0 text-right",
  temp: "w-10 shrink-0 text-right",
  rain: "w-28 shrink-0 text-right",
} as const;
const ROW = "flex w-full min-w-112 items-center gap-2 border-b border-hairline px-3";

function Value({ text, label, width }: { text: string | null; label: string; width: string }) {
  return (
    <span role="cell" aria-label={label} className={width}>
      <DataText className={text === null ? undefined : "text-ink"}>{text ?? "—"}</DataText>
    </span>
  );
}

function Headings({ showNow }: { showNow: boolean }) {
  return (
    <span role="row" className={cn(ROW, "h-8 bg-paper text-xs font-medium text-slate")}>
      <span role="columnheader" className={COL.place}>Day</span>
      <span role="columnheader" className={COL.conditions}>Conditions</span>
      {showNow ? <span role="columnheader" className={COL.now}>Now</span> : null}
      <span role="columnheader" className={COL.temp}>High</span>
      <span role="columnheader" className={COL.temp}>Low</span>
      <span role="columnheader" className={COL.rain}>Rain</span>
    </span>
  );
}

function Row({ row, showNow, headed }: { row: WeatherRow; showNow: boolean; headed: boolean }) {
  // Under a "Now" heading the value needs no word; without one, it does.
  const now = row.now === null ? null : headed ? row.now : `now ${row.now}`;
  return (
    <span role="row" data-mode={row.mode} className={cn(ROW, "h-10 last:border-b-0")}>
      {/* The place and the day, one line each and never the date: a date
          range wrapped out of the row's fixed height on the #221 preview, and
          a reader who wants the dates puts them at the top of the page. */}
      <span role="rowheader" className={cn(COL.place, "flex flex-col leading-tight")}>
        <span className="truncate text-sm font-semibold text-ink">{row.city ?? row.label}</span>
        {row.city === null ? null : (
          <DataText size="xs" className="truncate">
            {row.label}
          </DataText>
        )}
      </span>
      <span role="cell" className={cn(COL.conditions, "truncate text-sm text-ink")}>
        {row.modeText}
        {row.sky ? <span className="text-slate"> · {row.sky}</span> : null}
      </span>
      {showNow ? <Value text={now} label="now" width={COL.now} /> : null}
      <Value text={row.high} label="high" width={COL.temp} />
      <Value text={row.low} label="low" width={COL.temp} />
      <Value text={row.rain} label="rain" width={COL.rain} />
    </span>
  );
}

/** The weather block: a fixed-height row per (day, city) naming its mode, and the as-of and credit footer. */
export function WeatherBlock({ payload }: { payload: WeatherPayload }) {
  const today = useToday();
  const showNow = payload.rows.some((row) => row.now !== null);
  return (
    <span className="flex flex-col overflow-hidden rounded-md border border-hairline bg-surface">
      <span role="table" aria-label={payload.summary} className="flex flex-col overflow-x-auto">
        {payload.headings ? <Headings showNow={showNow} /> : null}
        {payload.rows.map((row) => (
          <Row key={row.key} row={row} showNow={showNow} headed={payload.headings} />
        ))}
      </span>
      <span className="flex flex-col gap-0.5 border-t border-hairline bg-paper px-3 py-2 text-xs text-slate">
        {payload.forecastAsOf ? <DataText size="xs">{asOfText(payload.forecastAsOf, today)}</DataText> : null}
        {payload.typicalPeriod ? <span>Typical: {payload.typicalPeriod}</span> : null}
        {payload.credits.map((credit) =>
          credit.href ? (
            <a key={credit.source} href={credit.href} target="_blank" rel="noreferrer" className="underline">
              {credit.text}
            </a>
          ) : (
            <span key={credit.source}>{credit.text}</span>
          ),
        )}
      </span>
    </span>
  );
}
