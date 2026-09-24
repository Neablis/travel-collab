import type { TripStripPayload } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { CITY_FILL, CITY_INK, type CityAccents } from "../cityAccents";

// "Trip strip" — the whole trip in one band: a cell per day in its city's
// colour, the city named over each run, day number and date beneath.
//
// **The colour is the board's.** Each cell asks `accents.ofDayId`, which is
// `cityAccents` → `dayAccents` over the same per-day cities the board feeds it,
// and the run's label is the same `dayCity` answer (`@tc/pages`), so a label
// cannot sit over another city's colour. `data-accent` names the family so a
// test can hold that without asserting a class (the lint wall bans those).
//
// **One row that scrolls on a narrow screen, rather than compressing.** Cells
// are a fixed `w-12` and refuse to shrink (design-system.md's scroller rule), so
// the band is always one row and one height (ADR-044: the value never moves).
// Compressing a 14-day trip into a phone's width leaves cells about 24px wide:
// the date no longer fits, and the day number is the only thing that tells a
// reader which cell is which. A clipped band that still reads beats a whole one
// that does not — and the accessible name carries every run either way.
//
// Spans rather than `<div>`s: a widget node is an inline atom, so this renders
// inside a paragraph (`ItineraryDayBlock` records the hydration error). No SVG:
// every mark here is a box, and boxes lay out and truncate text for free.
/** The trip strip: one image, a coloured cell per day grouped under its city, named by the runs in words. */
export function TripStripBlock({ payload, accents }: { payload: TripStripPayload; accents: CityAccents }) {
  return (
    <span role="img" aria-label={payload.summary} className="block overflow-x-auto">
      <span className="flex w-max">
        {payload.runs.map((run) => {
          const family = accents.ofDayId(run.days[0]!.dayId);
          return (
            <span key={run.days[0]!.dayId} className="flex shrink-0 flex-col">
              {/* `w-0 min-w-full`: the label takes the run's width and never
                  widens it, so a long name truncates over a one-day run instead
                  of stretching that day's cell. Empty for a no-city run — the
                  grey cells already say it, and the row keeps its height. */}
              <span className={cn("h-5 w-0 min-w-full truncate px-0.5 text-xs font-semibold", CITY_INK[family])}>
                {run.city ?? ""}
              </span>
              <span className="flex">
                {run.days.map((day) => {
                  const dayFamily = accents.ofDayId(day.dayId);
                  return (
                    <span
                      key={day.dayId}
                      data-testid="trip-strip-day"
                      data-day-id={day.dayId}
                      data-accent={dayFamily}
                      className="flex w-12 shrink-0 flex-col items-center gap-0.5 px-px"
                    >
                      <span className={cn("block h-4 w-full rounded-sm", CITY_FILL[dayFamily])} />
                      <DataText size="xs" className="text-ink">{day.ordinal}</DataText>
                      <DataText size="xs" className="whitespace-nowrap">{day.date ?? "—"}</DataText>
                    </span>
                  );
                })}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
