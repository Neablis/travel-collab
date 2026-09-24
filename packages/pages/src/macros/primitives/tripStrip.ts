import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import type { MacroDef, TripStripDay, TripStripPayload, TripStripRun, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { dayCity } from "../../dayCity";
import { formatShortDate } from "../../format";

// `trip.strip` — "Trip strip" (M14 link 11; widget brainstorm tier A). One
// band, a cell per day, coloured by the day's city, city names over each run.
//
// **A registered widget, not a primitive**, for `open`'s and `country.facts`'
// reason: it has no entity to narrow. A strip of some of the days would be a
// strip with holes, and the point of the picture is the whole trip at once.
//
// **No colour here** (ADR-037 decision 1). A day's city NAME is resolved by
// `dayCity` — the rule the board and `cityAccents` use — and `apps/web` turns
// the day into a colour through `cityAccents`, so the label over a run and the
// colour under it come from one reading of "a day's city".

const TripStripParams = z.object({});
type TripStripParams = z.infer<typeof TripStripParams>;

/**
 * The trip's days as maximal runs of consecutive days in one city.
 *
 * A city the trip RETURNS to starts a new run rather than joining its first
 * visit: the strip is a timeline, and Tokyo–Kyoto–Tokyo is three stays. Days
 * naming no place group the same way, under `city: null`.
 */
function runsOf(trip: TripDetail): TripStripRun[] {
  const runs: Omit<TripStripRun, "phrase">[] = [];
  trip.days.forEach((day, index) => {
    const city = dayCity(day, trip.activities);
    const entry: TripStripDay = { dayId: day.dayId, ordinal: index + 1, date: formatShortDate(day.date), city };
    const last = runs.at(-1);
    if (last && last.city === city) last.days.push(entry);
    else runs.push({ city, days: [entry] });
  });
  return runs.map((run) => ({ ...run, phrase: phraseOf(run) }));
}

// "days 1–4 Tokyo (Jun 1 – Jun 4)", "day 5 Kyoto (Jun 5)". The strip is a
// picture, so this is what a screen reader hears in its place — every run, not
// a count of them — and what a pointer sees over a run whose name or dates the
// picture had no room for. Capitalised once, at the front of the whole summary.
function phraseOf(run: Omit<TripStripRun, "phrase">): string {
  const first = run.days[0]!;
  const last = run.days.at(-1)!;
  const one = first === last;
  const days = one ? `day ${first.ordinal}` : `days ${first.ordinal}–${last.ordinal}`;
  const place = run.city ?? "no city yet";
  const dates = first.date === null ? "" : one || last.date === null ? ` (${first.date})` : ` (${first.date} – ${last.date})`;
  return `${days} ${place}${dates}`;
}

function summaryOf(runs: TripStripRun[]): string {
  const sentence = runs.map((run) => run.phrase).join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export const tripStripWidget: MacroDef<TripStripParams, TripStripPayload> = {
  name: "trip.strip",
  title: "Trip strip",
  shape: "block",
  params: TripStripParams,
  inputs: [],
  selection: undefined,
  description: "One band across the whole trip, a cell per day in its city's colour, with the city named over each stay.",
  emptyText: "add a day to see this",
  // Fixed, never computed (ADR-037 decision 5): no city named.
  preview: "every day of the trip in one band, coloured by city",
  resolve: ({ trip }: WidgetContext, _params): MacroResult<TripStripPayload> => {
    if (!trip) return needsTrip();
    if (trip.days.length === 0) return empty();
    const runs = runsOf(trip);
    return ok({ kind: "trip-strip", runs, summary: summaryOf(runs) });
  },
  render: blockOf,
};
