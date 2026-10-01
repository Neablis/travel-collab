"use client";
import type { TimeFormat } from "@tc/contracts";
import type { WeatherPayload } from "@tc/pages";
import { formatTripDate } from "@/lib/formatDate";
import { toClockLabel } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { localTodayIso, useToday } from "@/lib/today";
import type { CityAccents } from "../cityAccents";
import { WeatherGraphic } from "./WeatherGraphic";
import { WeatherTable } from "./WeatherTable";

// "Weather" (M14 link 11, ADR-052) — one row per (day, city), drawn as the
// graphic or read as the table (`payload.view`, the widget's "Show as"), over
// a footer that says whose the data is and how old. Both views read the same
// rows; this file chooses between them and owns what they share.
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
// **Every row is one fixed height whatever its source, in either view**
// (ADR-044): a row with nothing to show keeps its place with dashes rather
// than closing up. So the block's height is a function of the trip's days, not
// of the calendar, and the page does not move when a day crosses into the
// forecast.
//
// **It fits its column** (Mitchell, on the #221 preview: *"We need to scroll
// to the right to see all the data here"*): neither view gives a row a minimum
// width, so nothing here scrolls sideways.
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

/** The weather block: its rows as the graphic or the table, over the as-of and credit footer. */
export function WeatherBlock({ payload, accents }: { payload: WeatherPayload; accents: CityAccents }) {
  const clock = useTimeFormat();
  const today = useToday();
  return (
    <span className="flex flex-col overflow-hidden rounded-md border border-hairline bg-surface">
      {payload.view === "table" ? (
        <WeatherTable payload={payload} />
      ) : (
        <WeatherGraphic payload={payload} accents={accents} />
      )}
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
