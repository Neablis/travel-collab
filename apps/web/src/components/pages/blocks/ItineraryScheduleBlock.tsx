import type { ItineraryPayload, ItineraryStop } from "@tc/pages";
import { Badge } from "@/components/ui/badge";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { CITY_INK, CITY_TINT, type CityAccents } from "../cityAccents";

// The days as a printed itinerary (M30) — `day.detail {view: "schedule"}`, the
// Overview's "Day by day". Mitchell, 2026-09-26: *"I wanted it to read more
// like a Professional travel itinerary"*, and of the shapes offered, "each day
// as a timed schedule (times, place, booking status) like a printed
// itinerary".
//
// **Typography, not a table.** The glance (`ItineraryTripBlock`) is a bordered
// table of day rows; a printed itinerary is a document. So: a day heading in
// the day's city ink — "Day 3" small, the date as the heading, the cities
// after it — then one line per stop with its time in the data face (mono, the
// design system's rule for every time) in a fixed column, the stop's name, and
// under it where it is. Hairlines between days, none between stops. The only
// colour on a stop line is the standing, and only when it is news: "To book"
// in the warning tint (the Calendar's "N to book" is the same amber), "Travel"
// neutral, and nothing at all for a planned stop.
//
// Spans rather than divs throughout, for the reason every block here gives: a
// widget node is an inline atom inside a `<p>`. The roles carry what the tags
// cannot — a list of days, each a list of stops.

const STATUS_VARIANT: Record<NonNullable<ItineraryStop["status"]>, "warning" | "neutral"> = {
  "To book": "warning",
  Travel: "neutral",
};

/** The printed itinerary: a dated heading per day and a timed line per stop, with its place and standing. */
export function ItineraryScheduleBlock({ payload, accents }: { payload: ItineraryPayload; accents: CityAccents }) {
  return (
    <span role="list" aria-label="Day by day" className="block">
      {payload.days.map((day) => {
        const family = accents.ofDayId(day.dayId);
        return (
          <span
            role="listitem"
            key={day.dayId}
            className="block border-t border-hairline py-4 first:border-t-0 first:pt-1"
            data-testid="itinerary-day"
          >
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className={cn("text-xs font-semibold uppercase tracking-wide", CITY_INK[family])}>Day {day.ordinal}</span>
              <span className="text-md font-semibold text-ink">{day.date ?? "No date yet"}</span>
              {day.cities.length > 0 ? (
                <span className={cn("text-sm", CITY_INK[family])}>{day.cities.join(" – ")}</span>
              ) : null}
            </span>
            {day.stops.length === 0 ? (
              <span className="mt-1.5 block text-sm text-slate">Nothing planned yet</span>
            ) : (
              <span role="list" aria-label={`Day ${day.ordinal}`} className="mt-2 flex flex-col gap-2.5">
                {day.stops.map((stop, i) => (
                  <span role="listitem" key={i} className="flex items-start gap-4">
                    <span className="flex w-20 shrink-0 flex-col pt-0.5">
                      <DataText size="sm" className="text-ink">
                        {stop.time ?? "—"}
                      </DataText>
                      {stop.until ? <DataText size="xs">until {stop.until}</DataText> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium text-ink">{stop.title}</span>
                        {stop.status ? <Badge variant={STATUS_VARIANT[stop.status]}>{stop.status}</Badge> : null}
                      </span>
                      {stop.place ? <span className="text-sm text-slate">{stop.place}</span> : null}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The same schedule at phone density — the artboard's phone notebook page
 * (`phoneNbDoc`, SPEC §19), whose `day.detail` is one tinted row per day.
 *
 * Every stop is still here, with its time and its standing: the letter's
 * opening sentence promises "at what time, and anything still to book", and a
 * phone does not get to make it false. What goes is the layout — a timed column
 * and a place line per stop measured ~420px a day at 390px, so the demo's
 * fourteen days were a 5,848px block (KI-2026-09-25-f). Here a day is its
 * label, date and cities over one wrapped line, `time title · time title`.
 */
export function ItineraryScheduleCompact({ payload, accents }: { payload: ItineraryPayload; accents: CityAccents }) {
  return (
    <span role="list" aria-label="Day by day" className="block overflow-hidden rounded-lg border border-hairline">
      {payload.days.map((day) => {
        const family = accents.ofDayId(day.dayId);
        return (
          <span
            role="listitem"
            key={day.dayId}
            className={cn("flex flex-col gap-0.5 border-b border-hairline px-3 py-2.5 last:border-b-0", CITY_TINT[family])}
            data-testid="itinerary-day"
          >
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("text-sm font-semibold", CITY_INK[family])}>Day {day.ordinal}</span>
              <DataText size="xs">{day.date ?? "No date yet"}</DataText>
              {day.cities.length > 0 ? (
                <span className={cn("text-xs", CITY_INK[family])}>{day.cities.join(" – ")}</span>
              ) : null}
            </span>
            {/* `break-words` so a title with no break in it wraps rather than
                running under the list's `overflow-hidden` (CodeRabbit, PR #367).
                The editor's `.ProseMirror` rule wraps it today; this block
                should not depend on its host for it. */}
            <span className={cn("break-words text-sm", day.stops.length === 0 ? "text-slate" : "text-ink")}>
              {day.stops.length === 0
                ? "Nothing planned yet"
                : day.stops.map((stop, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : null}
                      {/* Nowrap: "9 pm" broken across two lines reads as a 9 and a stray "pm". */}
                      {stop.time ? (
                        <>
                          <DataText size="xs" className="whitespace-nowrap text-ink">
                            {stop.time}
                          </DataText>{" "}
                        </>
                      ) : null}
                      {stop.title}
                      {/* Nowrap for the same reason: "(To" / "book)" is two fragments, not a standing. */}
                      {stop.status ? (
                        <span className={cn("whitespace-nowrap", stop.status === "To book" ? "text-warning-ink" : "text-slate")}> ({stop.status})</span>
                      ) : null}
                    </span>
                  ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
