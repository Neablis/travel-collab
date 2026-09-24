"use client";
import type { WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
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
// row and a typical row carry the same five columns, and a column a mode has
// no value for keeps its place with a dash rather than closing up. So the
// block's height is a function of the trip's days, not of the calendar, and
// the page does not move when a day crosses into the forecast.
//
// **One row that scrolls on a narrow screen**, the trip strip's rule
// (design-system.md's scroller rule): columns are fixed widths, so a phone
// scrolls the rows sideways rather than wrapping a row onto two lines, which
// would break the fixed height above.
//
// Spans with table roles, not `<table>`: a widget node is an inline atom and
// renders inside a paragraph (`ItineraryDayBlock` records the hydration error).

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayAndTime = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * The forecast's as-of in the READER's own zone (decision 7): the time alone
 * when it is from today, the date as well when it is not — a stale row served
 * after a failed revalidation must not read as this morning's.
 */
export function asOfText(iso: string, today: string): string {
  const at = new Date(iso);
  return `Forecast as of ${localTodayIso(at) === today ? time.format(at) : dayAndTime.format(at)}`;
}

function Value({ text, label, wide = false }: { text: string | null; label: string; wide?: boolean }) {
  return (
    <span role="cell" aria-label={label} className={cn("shrink-0 text-right", wide ? "w-16" : "w-10")}>
      <DataText className={text === null ? undefined : "text-ink"}>{text ?? "—"}</DataText>
    </span>
  );
}

function Row({ row }: { row: WeatherRow }) {
  return (
    <span role="row" data-mode={row.mode} className="flex h-10 w-max min-w-full items-center gap-3 border-b border-hairline px-3 last:border-b-0">
      {/* The place and the day, one line each and never the date: a date
          range wrapped out of the row's fixed height on the #221 preview, and
          a reader who wants the dates puts them at the top of the page. */}
      <span role="rowheader" className="flex w-24 shrink-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-ink">{row.city ?? row.label}</span>
        {row.city === null ? null : (
          <DataText size="xs" className="truncate">
            {row.label}
          </DataText>
        )}
      </span>
      <span role="cell" className="w-60 shrink-0 truncate text-sm text-ink">
        {row.modeText}
        {row.sky ? <span className="text-slate"> · {row.sky}</span> : null}
      </span>
      {/* Present on every row, so today's extra value does not shift the columns under it. */}
      <Value text={row.now === null ? null : `now ${row.now}`} label="now" wide />
      <Value text={row.high} label="high" />
      <Value text={row.low} label="low" />
      <span role="cell" aria-label="rain" className="w-24 shrink-0 text-right">
        <DataText className={row.rain === null ? undefined : "text-ink"}>{row.rain ?? "—"}</DataText>
      </span>
    </span>
  );
}

/** The weather block: a fixed-height row per (day, city) naming its mode, and the as-of and credit footer. */
export function WeatherBlock({ payload }: { payload: WeatherPayload }) {
  const today = useToday();
  return (
    <span className="flex flex-col overflow-hidden rounded-md border border-hairline bg-surface">
      <span role="table" aria-label={payload.summary} className="flex flex-col overflow-x-auto">
        {payload.rows.map((row) => <Row key={row.key} row={row} />)}
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
