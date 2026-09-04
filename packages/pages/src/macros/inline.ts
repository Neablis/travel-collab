import { z } from "zod";
import { DayRef, type TripDetail } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../registry-types";
import { chip, inlineOf } from "../registry-types";
import { ok, empty, unbound, needsTrip, type MacroResult } from "../result";
import { formatMoney, formatDate } from "../format";
import { dayIndexOf } from "../select";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// A widget that reads ONE day takes that day as its own input (ADR-035
// decision 3): the day lives in this macro node's params, not on the page.
// Optional, because a widget can exist before it is pointed anywhere — that is
// the `unbound` state, and it renders as a chip rather than an error.
export const DayParams = z.object({ dayRef: DayRef.optional() }).strip();
export type DayParams = z.infer<typeof DayParams>;

// The declared input for the two widgets that read one day (ADR-035 decision 2).
// Shared rather than written twice so the input's `name` and `DayParams`' key
// cannot drift apart across two files — they MUST match, and a registry-wide
// test in registry.test.ts enforces that for every widget, not just these.
export const DAY_INPUT: readonly WidgetInput[] = [{ name: "dayRef", type: "day", label: "Day" }];

// Resolve this widget's bound day to an index into TripDetail.days, or null if
// it is bound to nothing or to a day that no longer exists. A stale binding is
// silently no binding, never a guessed one — writing about day 1 because day 100
// was deleted is a confident wrong answer.
//
// The rule itself now lives in `dayIndexOf` (`select.ts`), because ADR-039's
// primitives resolve the same binding under a different param name (`day`, not
// `dayRef` — spec §4's preset table writes `cost{day: N}`). Two copies of "what
// does this ref point at" is precisely how the seventeen named widgets and the
// eleven primitives would come to disagree about a deleted day.
export function resolveDayIndex(detail: TripDetail, params: DayParams): number | null {
  return dayIndexOf(detail, params.dayRef);
}

// **Every resolved value renders as a chip, not as bare text.**
//
// These four used to render `inlineOf(text(value))`, which made a widget's
// output typographically identical to the sentence the author typed around it.
// In Editing a chrome row says which words are widgets; in Reading there is no
// chrome row, so nothing did. Mitchell, on the preview: *"A value coming from a
// widget in readonly mode should be clearly coming from a widget."* dc.html's
// own document renders `trip.name`, `trip.dates` and the rest as chips
// (`:5117`), and `chip` is the segment kind that already meant "this word came
// from the trip" — the repeaters have used it since they landed.
//
// `apps/web` decides what a chip looks like; this only says that it is one.
export const tripName: MacroDef<NoParams, string> = {
  name: "trip.name", title: "The trip's name", shape: "single", params: NoParams, inputs: [],
  description: "The trip's name.", emptyText: "untitled trip",
  preview: "Japan, spring",
  resolve: ({ trip }): MacroResult<string> =>
    !trip ? needsTrip() : trip.name.trim() === "" ? empty() : ok(trip.name),
  render: (value) => inlineOf(chip("value", value)),
};

export const tripDates: MacroDef<NoParams, string> = {
  name: "trip.dates", title: "The trip's dates", shape: "single", params: NoParams, inputs: [],
  description: "The trip's date range (start date and number of days).", emptyText: "no dates set",
  preview: "Fri 25 Sep – Sun 4 Oct",
  resolve: ({ trip }): MacroResult<string> => {
    if (!trip) return needsTrip();
    if (trip.startDate === null) return empty();
    // The last day that HAS a date, not the last day. A trip can be dated at
    // the front and open-ended at the back, and reading `days.at(-1).date`
    // blindly rendered "Aug 1, 2026 – —" — an em dash presented as the end of a
    // range, which reads as a date rather than as its absence. Falls back to the
    // start date, so the range degrades to a single day rather than to nonsense.
    // Found by CodeRabbit on PR 139.
    const lastDated = [...trip.days].reverse().find((d) => d.date !== null)?.date ?? trip.startDate;
    return ok(
      trip.days.length <= 1 || lastDated === trip.startDate
        ? formatDate(trip.startDate)
        : `${formatDate(trip.startDate)} – ${formatDate(lastDated)}`,
    );
  },
  render: (value) => inlineOf(chip("value", value)),
};

export const costTrip: MacroDef<NoParams, string> = {
  name: "cost.trip", title: "What the trip costs", shape: "single", params: NoParams, inputs: [],
  description: "Total cost of the whole trip.", emptyText: "no costs yet",
  preview: "the trip's running total",
  resolve: ({ trip }): MacroResult<string> =>
    !trip ? needsTrip() : trip.tripCostTotal === 0 ? empty() : ok(formatMoney(trip.tripCostTotal, trip.currency)),
  render: (value) => inlineOf(chip("value", value)),
};

export const costDay: MacroDef<DayParams, string> = {
  name: "cost.day", title: "What a day costs", shape: "single", params: DayParams, inputs: DAY_INPUT,
  description: "Total cost of one day of the trip.", emptyText: "no costs on this day",
  preview: "what that day comes to",
  resolve: ({ trip }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    const sub = trip.days[idx]!.costSubtotal;
    return sub === 0 ? empty() : ok(formatMoney(sub, trip.currency));
  },
  render: (value) => inlineOf(chip("value", value)),
};
