import { z } from "zod";
import { ActivityTag, DayRef } from "@tc/contracts";
import type { MacroDef, RepeatPayload, RepeatRow, WidgetContext, WidgetInput } from "../registry-types";
import { chip, rowsOf, text } from "../registry-types";
import { ok, empty, unbound, needsTrip, type MacroResult } from "../result";
import { formatMoney, formatDate } from "../format";
import { DayParams, DAY_INPUT, resolveDayIndex } from "./inline";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// The catalogue's repeat widgets — "a line for every day / city / booking".
//
// **What is built here, and what deliberately is not.** ADR-035 decision 4 says
// a repeater's CONTENT is the author's row template, editable inline in the
// page's own document. That is not what these are. The catalogue's own gap list
// marks row 12 — *"how an author edits a row template without seeing macro
// syntax"* — as **unowned**, and it is a design decision rather than an
// implementation one, so building an authoring surface here would be settling it
// by writing code.
//
// These render a FIXED line per item, through `Rendered.rows`, which
// `MacroView` has understood since the widget framework landed. `PageRepeatNode`
// is untouched and still describes the authorable form for when row 12 has an
// owner; nothing here forecloses it, because a widget that renders its own rows
// and a node whose content is a template are different things that can both
// exist.
//
// One shared renderer: the lead is text and every value is a chip. A chip is a
// resolved value reading as a word in a sentence (§7), and in a repeater's line
// the lead ("Day 1") is the label while everything after it came from the trip.
const renderRows = (payload: RepeatPayload) =>
  rowsOf(payload.rows.map((row) => [text(row.lead), ...row.values.map((v) => chip("value", v))]));

// `w-dayline`. No inputs: it iterates the whole trip, so there is nothing to
// point it at — `inputs: []` is a real answer meaning it is finished the moment
// it lands (ADR-035 decision 2).
//
// Cities come from `globals`, which is a separate request; a line still renders
// without it, one value shorter. That is the honest degradation — a day with no
// city listed reads as a day whose city we cannot name, and dropping the whole
// line because one projection is late would lose the days themselves.
export const dayLine: MacroDef<NoParams, RepeatPayload> = {
  name: "day.line", title: "A line for every day", shape: "repeat", params: NoParams, inputs: [],
  description: "One line per day of the trip: its date, its cities and what it costs.",
  emptyText: "this trip has no days yet",
  preview: "one line per day, with its date and cost",
  resolve: ({ trip, globals }: WidgetContext): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    if (trip.days.length === 0) return empty();
    const rows: RepeatRow[] = trip.days.map((day, index) => {
      const values: string[] = [];
      if (day.date !== null) values.push(formatDate(day.date));
      const cities = globals?.days[index]?.cities ?? [];
      if (cities.length > 0) values.push(cities.join(" – "));
      if (day.costSubtotal !== 0) values.push(formatMoney(day.costSubtotal, trip.currency));
      return { lead: `Day ${index + 1}`, values };
    });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

// `w-cityline`. Served ENTIRELY by the globals projection — cities are derived
// by `citiesOfDay` in `@tc/domain`, which this package may not import. With no
// globals there is no city list at all, which is `empty()` rather than an
// invented one.
export const cityLine: MacroDef<NoParams, RepeatPayload> = {
  name: "city.line", title: "A line for every city", shape: "repeat", params: NoParams, inputs: [],
  description: "One line per city the trip touches: which days are there, and how many stops.",
  emptyText: "no cities on this trip yet",
  preview: "one line per city, with its days and stops",
  resolve: ({ trip, globals }: WidgetContext): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const cities = globals?.cities ?? [];
    if (cities.length === 0) return empty();
    const rows: RepeatRow[] = cities.map((city) => {
      const values: string[] = [];
      if (city.dayIndexes.length > 0) {
        // Day NUMBERS, not indexes. `dayIndexes` counts from 0 because that is
        // how the projection addresses days; a person counts from 1, and a
        // notebook line saying "Day 0" would be the projection's private
        // convention leaking onto the page.
        values.push(city.dayIndexes.map((i) => `Day ${i + 1}`).join(", "));
      }
      if (city.activityCount > 0) {
        values.push(city.activityCount === 1 ? "1 stop" : `${city.activityCount} stops`);
      }
      return { lead: city.name, values };
    });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

// `w-bookline`. "Booking" is `ActivityKind === "booked"` — an enum member that
// already exists, which is why this widget needs no new domain data.
//
// It takes a day, so it lands unbound and is pointed from the chrome row like
// every other day widget. A day with stops but none booked is `empty()`, and
// that is a different sentence from "no stops": `emptyText` says which.
export const bookingLine: MacroDef<DayParams, RepeatPayload> = {
  name: "booking.line", title: "A line for every booking", shape: "repeat", params: DayParams, inputs: DAY_INPUT,
  description: "One line per booked stop on a day: when it is, and what it cost.",
  emptyText: "nothing booked on this day",
  preview: "one line per booking, with its time and cost",
  resolve: ({ trip }: WidgetContext, params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    const rows: RepeatRow[] = [];
    for (const activityId of trip.days[idx]!.activityIds) {
      const activity = trip.activities[activityId];
      if (!activity || activity.kind !== "booked") continue;
      const values: string[] = [];
      if (activity.timeWindow) values.push(`${activity.timeWindow.start} – ${activity.timeWindow.end}`);
      if (activity.cost) values.push(formatMoney(activity.cost.amountMinor, activity.cost.currency));
      rows.push({ lead: activity.title, values });
    }
    return rows.length === 0 ? empty() : ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};


// `w-stopline`, and the catalogue calls it what it is: *"the only two-input
// widget, so it is the one that proves the model"*. Everything else in the
// registry takes one thing or nothing, so this is the first widget whose
// bindings can interfere — and the chrome row had a real defect that only it
// could expose (its `onChange` replaced the whole params object, so setting a
// tag would have discarded the day).
//
// **`tag` is optional and its absence is a REAL answer**, not an unfilled
// blank: §18's table reads "every stop, or one". So an unbound tag means every
// stop on the day, which is why this widget is useful the moment it is pointed
// at a day and does not wait for a second choice.
export const StopLineParams = z.object({
  dayRef: DayRef.optional(),
  tag: ActivityTag.optional(),
}).strip();
export type StopLineParams = z.infer<typeof StopLineParams>;

// Both inputs declared. `name` must match this schema's own keys or the widget
// declares a binding the validator ignores — enforced registry-wide rather than
// by convention, which is what makes adding the second one safe.
const STOP_LINE_INPUTS: readonly WidgetInput[] = [
  { name: "dayRef", type: "day", label: "Day" },
  { name: "tag", type: "tags", label: "Tags" },
];

export const stopLine: MacroDef<StopLineParams, RepeatPayload> = {
  name: "stop.line", title: "A line for every stop", shape: "repeat",
  params: StopLineParams, inputs: STOP_LINE_INPUTS,
  description: "One line per stop on a day: when it is, and what it costs. Optionally only the stops carrying one tag.",
  emptyText: "no stops on this day",
  preview: "one line per stop, with its time and cost",
  resolve: ({ trip }: WidgetContext, params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    const rows: RepeatRow[] = [];
    for (const activityId of trip.days[idx]!.activityIds) {
      const activity = trip.activities[activityId];
      if (!activity) continue;
      // No tag bound means every stop. A bound tag filters, and a day whose
      // stops all lack it is `empty()` — the widget says "no stops on this
      // day" rather than silently dropping the filter, because a filter that
      // quietly stops filtering is worse than one that finds nothing.
      if (params.tag && !activity.tags.includes(params.tag)) continue;
      const values: string[] = [];
      if (activity.timeWindow) values.push(`${activity.timeWindow.start} – ${activity.timeWindow.end}`);
      if (activity.cost) values.push(formatMoney(activity.cost.amountMinor, activity.cost.currency));
      rows.push({ lead: activity.title, values });
    }
    return rows.length === 0 ? empty() : ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};
