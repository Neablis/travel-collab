import type { TripStripPayload } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { CITY_FILL, CITY_INK, type CityAccents } from "../cityAccents";

// "Trip strip" — the whole trip in one band: a bar per day in its city's
// colour, and over each run of same-city days the day it starts on and, where
// there is room, the city's name.
//
// **The colour is the board's.** Each cell asks `accents.ofDayId`, which is
// `cityAccents` → `dayAccents` over the same per-day cities the board feeds it,
// and the run's label is the same `dayCity` answer (`@tc/pages`), so a label
// cannot sit over another city's colour. `data-accent` names the family so a
// test can hold that without asserting a class (the lint wall bans those).
//
// **It always fits its column; it never scrolls.** Mitchell on the PR #221
// preview: *"I would love if this could fit without having to scroll, and be
// more space efficient, but might be hard, especially on mobile."* This used to
// be fixed `w-12` cells in a scroller, on the argument that a clipped band that
// reads beats a whole one that does not. The owner picked the whole one, and
// the way to make it read is to stop asking every cell to carry text:
//
// - **A day is an equal share of the width** (`flex-1 basis-0 min-w-0`), and a
//   run grows by its day count, so a 20-day trip in a phone's ~320px column is
//   about 14px a day and every day is still one visible bar.
// - **Text belongs to the run, not the day.** One line over each run: the
//   ordinal it starts on, then its city, then its first date. Each part appears
//   only when the RUN is wide enough for it (a container query on the run), so
//   a narrow run drops the date, then the city, then its number, and never
//   wraps. A city shows from 3rem, where at least "Hiros…" fits — a stub of
//   one or two letters says less than the colour does, so below that it goes.
//   Measured on the 20-day e2e trip: at 1280px every run is numbered and most
//   are named; on a phone the four-day stays keep "1 Tokyo" and "6 Kyoto" and
//   a one-day stay keeps only its colour (the phone e2e holds that).
// - **Nothing dropped is lost.** Each run's `title` is its phrase ("days 6–9
//   Kyoto (Jun 6 – Jun 9)") for a pointer, and the strip's accessible name is
//   every phrase in order, so a screen reader hears each city and its dates
//   however narrow the picture got.
// - **Two heights, both fixed**: a 16px text line and a 12px bar, about 30px
//   where the three-row version stood near 70. Neither depends on trip length
//   or column width, so the strip is one height at every size (ADR-044: the
//   value never moves), and the desktop e2e holds it across the rail opening.
// - **Runs are split by a 4px gap, days by 1px.** There are five colour
//   families and a trip can have more cities than that, so two neighbouring
//   runs can share a colour; the wider gap is what still says "a new stay".
//
// Spans rather than `<div>`s: a widget node is an inline atom, so this renders
// inside a paragraph (`ItineraryDayBlock` records the hydration error). No SVG:
// every mark here is a box, and boxes lay out and truncate text for free.
/** The trip strip: one image that fits its column, a coloured bar per day grouped under its city, named by the runs in words. */
export function TripStripBlock({ payload, accents }: { payload: TripStripPayload; accents: CityAccents }) {
  return (
    <span role="img" aria-label={payload.summary} className="flex w-full gap-1">
      {payload.runs.map((run) => {
        const first = run.days[0]!;
        const family = accents.ofDayId(first.dayId);
        return (
          <span
            key={first.dayId}
            title={run.phrase}
            className="@container flex min-w-0 basis-0 flex-col gap-0.5"
            // eslint-disable-next-line no-restricted-syntax -- computed geometry: a run's share of the band is its day count, which no token class can express
            style={{ flexGrow: run.days.length }}
          >
            {/* One line, `truncate` only as a backstop: the container queries
                are what keep it from ever needing the ellipsis. The ordinal is
                `invisible` rather than hidden so the line keeps its height. */}
            <span className="block h-4 truncate text-xs leading-4">
              <DataText size="xs" className="invisible @strip-number:visible">{first.ordinal}</DataText>
              {run.city === null ? null : (
                <span className={cn("hidden font-semibold @strip-city:inline", CITY_INK[family])}> {run.city}</span>
              )}
              {first.date === null ? null : (
                <DataText size="xs" className="hidden @strip-date:inline"> · {first.date}</DataText>
              )}
            </span>
            <span className="flex gap-px">
              {run.days.map((day) => {
                const dayFamily = accents.ofDayId(day.dayId);
                return (
                  <span
                    key={day.dayId}
                    data-testid="trip-strip-day"
                    data-day-id={day.dayId}
                    data-accent={dayFamily}
                    className={cn("block h-3 min-w-0 flex-1 basis-0 rounded-sm", CITY_FILL[dayFamily])}
                  />
                );
              })}
            </span>
          </span>
        );
      })}
    </span>
  );
}
