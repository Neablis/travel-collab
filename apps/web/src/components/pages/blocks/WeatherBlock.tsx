"use client";
import type { TimeFormat } from "@tc/contracts";
import type { WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { formatTripDate } from "@/lib/formatDate";
import { toClockLabel } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { localTodayIso, useToday } from "@/lib/today";

// "Weather" (M14 link 11, ADR-052) — one row per (day, city), each saying its
// mode in words, over a footer that says whose the data is and how old.
//
// **The footer is the block's, not the author's** (decision 5): the credit for
// every source whose data is on the block, with the as-of beside the forecast's
// (decision 7). A widget has no param that could remove either, and the one
// URL here comes from the payload's fixed table, never from fetched data.
//
// **One plain line, not a section** (Mitchell, PR 221 preview: *"I dont
// understand what this section is? Typical lines? are they needed?"*). It was
// three stacked lines — an as-of, "Typical: 2001–2020 averages", and two
// credits — that read as content of their own. Now each source says what its
// data IS on the block: *"Forecast: Norwegian Meteorological Institute, CC BY
// 4.0 (updated 9:10 am) · Monthly averages: NASA POWER, 2001–2020"*.
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
 * after a failed revalidation must not read as this morning's. In the reader's
 * clock (`UserPreferences.timeFormat`), 12-hour unless they chose otherwise.
 * Printed beside the forecast's credit, so it needs no "Forecast" of its own.
 */
export function asOfText(iso: string, today: string, clock: TimeFormat): string {
  const at = new Date(iso);
  const day = localTodayIso(at);
  const time = toClockLabel(clockOf(at), clock);
  return `updated ${day === today ? time : `${formatTripDate(day)}, ${time}`}`;
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
      <span
        role="cell"
        className={cn(COL.conditions, "truncate text-sm text-ink")}
        title={row.sky ? `${row.modeText} · ${row.sky}` : row.modeText}
      >
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
  const clock = useTimeFormat();
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
      <span
        role="note"
        aria-label="Weather sources"
        className="block border-t border-hairline bg-paper px-3 py-2 text-xs text-slate"
      >
        {payload.credits.map((credit, i) => {
          // What each source's data is on the block, beside it: the forecast's
          // as-of, the averages' period.
          const aside =
            credit.source === "met-norway" && payload.forecastAsOf
              ? ` (${asOfText(payload.forecastAsOf, today, clock)})`
              : credit.source === "nasa-power" && payload.typicalPeriod
                ? `, ${payload.typicalPeriod}`
                : "";
          return (
            <span key={credit.source}>
              {i > 0 ? " · " : null}
              {credit.label}:{" "}
              {credit.href ? (
                <a href={credit.href} target="_blank" rel="noreferrer" className="underline">
                  {credit.text}
                </a>
              ) : (
                credit.text
              )}
              {aside}
            </span>
          );
        })}
      </span>
    </span>
  );
}
