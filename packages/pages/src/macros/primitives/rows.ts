import { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import type { MacroDef, RepeatPayload, RepeatRow, RepeatValue, WidgetContext } from "../../registry-types";
import { chip, rowCity, rowLabel, rowValue, rowsOf, text } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { costOfStops, narrow, type SelectedStop } from "../../select";
import { formatMoney, formatDate } from "../../format";

// The `repeat` primitives (ADR-039 decision 1): a shape that **lists** its
// selection as rows.
//
// One shared renderer, inherited unchanged from the named repeaters: a label is
// text and every other kind is a chip. A chip is a resolved value reading as a
// word in a sentence (§7), and in a line the lead ("Day 1") is usually the label
// while everything after it came from the trip — usually, because on
// `city.rows` the lead IS the resolved value, and `RepeatValue` is what lets one
// renderer say so.
const segOf = (v: RepeatValue) => (v.name === "label" ? text(v.text) : chip(v.name, v.text));
const renderRows = (payload: RepeatPayload) =>
  rowsOf(payload.rows.map((row) => [segOf(row.lead), ...row.values.map(segOf)]));

const DAY_ROWS_FILTERS = ["day", "city", "dates"] as const satisfies readonly FilterDimension[];
const DayRowsParams = filterParams(DAY_ROWS_FILTERS);
type DayRowsParams = z.infer<typeof DayRowsParams>;

/**
 * `day.rows` — one line per day: its date, its cities and what it costs.
 *
 * Wide this is `day.line`. It declares no `tag` or `kind` dimension, and that is
 * deliberate rather than an oversight: the line's cost is the day's own
 * `costSubtotal`, the number the board shows, and a tag filter would make that
 * number a lie the widget could not correct without recomputing a total the
 * domain owns. Filtering a day's CONTENTS is `day.detail`'s job; this lists
 * days.
 *
 * Cities come from `globals`, which is a separate request; a line still renders
 * without it, one value shorter. That is the honest degradation — a day with no
 * city listed reads as a day whose city we cannot name, and dropping the whole
 * line because one projection is late would lose the days themselves.
 */
export const dayRows: MacroDef<DayRowsParams, RepeatPayload> = {
  name: "day.rows", title: "A line for every day", shape: "repeat",
  params: DayRowsParams, inputs: filterInputs(DAY_ROWS_FILTERS),
  selection: { entity: "day", filters: DAY_ROWS_FILTERS },
  description: "One line per selected day: its date, its cities and what it costs.",
  emptyText: "no days to show",
  preview: "one line per day, with its date and cost",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    if (selection.value.days.length === 0) return empty();
    const rows: RepeatRow[] = selection.value.days.map((index) => {
      const day = trip.days[index]!;
      const values: RepeatValue[] = [];
      if (day.date !== null) values.push(rowValue(formatDate(day.date)));
      // One value PER CITY, not one joined string: a day that touches two
      // cities wears two colours on the board, and one value can only wear one.
      for (const cityName of globals?.days[index]?.cities ?? []) values.push(rowCity(cityName));
      if (day.costSubtotal !== 0) values.push(rowValue(formatMoney(day.costSubtotal, trip.currency)));
      return { lead: rowLabel(`Day ${index + 1}`), values };
    });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

const CITY_ROWS_FILTERS = ["city", "dates"] as const satisfies readonly FilterDimension[];
const CityRowsParams = filterParams(CITY_ROWS_FILTERS);
type CityRowsParams = z.infer<typeof CityRowsParams>;

/**
 * `city.rows` — one line per city: which days are there, and how many stops.
 *
 * Wide this is `city.line`. Served entirely by the globals projection, so with
 * no globals there is no city list at all — `empty()` rather than an invented
 * one.
 *
 * The lead is the CITY, not a label: this is the one repeater whose opening
 * phrase is itself a resolved value, so it carries the city's own colour like
 * every other mention of that city does.
 */
export const cityRows: MacroDef<CityRowsParams, RepeatPayload> = {
  name: "city.rows", title: "A line for every city", shape: "repeat",
  params: CityRowsParams, inputs: filterInputs(CITY_ROWS_FILTERS),
  selection: { entity: "city", filters: CITY_ROWS_FILTERS },
  description: "One line per selected city: which days are there, and how many stops.",
  emptyText: "no cities to show",
  preview: "one line per city, with its days and stops",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const cities = selection.value.cities;
    if (cities.length === 0) return empty();
    const rows: RepeatRow[] = cities.map((entry) => {
      const values: RepeatValue[] = [];
      // Day NUMBERS, not indexes: the projection counts from 0 and a person
      // counts from 1.
      if (entry.dayIndexes.length > 0) {
        values.push(rowValue(entry.dayIndexes.map((index) => `Day ${index + 1}`).join(", ")));
      }
      if (entry.activityCount > 0) {
        values.push(rowValue(entry.activityCount === 1 ? "1 stop" : `${entry.activityCount} stops`));
      }
      return { lead: rowCity(entry.name), values };
    });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

const STOP_ROWS_FILTERS = ["day", "city", "tag", "kind", "person", "dates"] as const satisfies readonly FilterDimension[];
const StopRowsParams = filterParams(STOP_ROWS_FILTERS);
type StopRowsParams = z.infer<typeof StopRowsParams>;

// The header a group of stops sits under: a row whose lead is a label and whose
// values are empty, which `renderRows` turns into a single text segment.
//
// A header is a row rather than a field on `RepeatRow` because `Rendered.rows`
// is `Seg[][]` — a repeat renders N lines and `MacroView` maps them to
// `role="listitem"` spans. Giving `RepeatRow` a `kind` would push a grouping
// concept through the render seam and into `apps/web` for one widget's benefit;
// a label-only line is the same thing said with what already exists.
const headerRow = (label: string): RepeatRow => ({ lead: rowLabel(label), values: [] });

/**
 * `stop.rows` — one line per stop: when it is, and what it cost.
 *
 * Wide this is `stop.line` over the whole trip; with `kind: "booked"` it is
 * `booking.line`. The fourth row of ADR-039's table of widgets written twice,
 * and the one that needed no new data at all — "booking" was already an
 * `ActivityKind` member.
 *
 * **Stops are grouped under day headers when the selection spans more than one
 * day**, which is the spec's own wording. One day needs no header (the widget is
 * pointed at that day and the chrome row says so), and the backlog gets an
 * "Unscheduled" header for the same reason a day gets a numbered one: a line
 * with no heading over it reads as belonging to whatever came before it.
 */
export const stopRows: MacroDef<StopRowsParams, RepeatPayload> = {
  name: "stop.rows", title: "A line for every stop", shape: "repeat",
  params: StopRowsParams, inputs: filterInputs(STOP_ROWS_FILTERS),
  selection: { entity: "stop", filters: STOP_ROWS_FILTERS },
  description:
    "One line per selected stop: when it is, and what it cost. Filter it to a day, a tag, or a kind — booked, for instance, gives a line for every booking.",
  // True whether the selection held no stops at all or the filters matched none
  // of them. `emptyText` is a fixed string on the definition and cannot see the
  // params, so "no stops on this day" would be a claim the widget cannot keep.
  emptyText: "no stops to show",
  preview: "one line per stop, with its time and cost",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const stops = selection.value.stops;
    if (stops.length === 0) return empty();

    const lineOf = ({ activity }: SelectedStop): RepeatRow => {
      const values: RepeatValue[] = [];
      if (activity.timeWindow) values.push(rowValue(`${activity.timeWindow.start} – ${activity.timeWindow.end}`));
      if (activity.cost) values.push(rowValue(formatMoney(activity.cost.amountMinor, activity.cost.currency)));
      return { lead: rowLabel(activity.title), values };
    };

    // Group only when there is more than one group to tell apart. `stops` is
    // already in board order — the selected days in order, then the backlog —
    // so a header is due whenever the day changes.
    const groups = new Set(stops.map((stop) => stop.dayIndex));
    if (groups.size <= 1) return ok({ kind: "repeat-rows", rows: stops.map(lineOf) });

    const rows: RepeatRow[] = [];
    let current: number | null | undefined;
    for (const stop of stops) {
      if (stop.dayIndex !== current) {
        current = stop.dayIndex;
        rows.push(headerRow(stop.dayIndex === null ? "Unscheduled" : `Day ${stop.dayIndex + 1}`));
      }
      rows.push(lineOf(stop));
    }
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

const COST_ROWS_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
const CostRowsParams = filterParams(COST_ROWS_FILTERS);
type CostRowsParams = z.infer<typeof CostRowsParams>;

/**
 * `cost.rows` — a row per day, plus unscheduled, plus the total.
 *
 * Wide this is `costs.table` as lines rather than as a bordered block. It sums
 * the SELECTED stops rather than reading `day.costSubtotal`, because unlike
 * `day.rows` it accepts the content dimensions: `cost.rows{tag: "meal"}` is
 * "what each day's meals came to", and a precomputed subtotal cannot answer
 * that. Unfiltered the two agree exactly, since `costOfStops` sums what
 * `rollupCosts` sums.
 *
 * Days that cost nothing are dropped, which is what `costs.table` already does:
 * a cost breakdown listing a run of zeroes is a table about days rather than
 * about money.
 */
export const costRows: MacroDef<CostRowsParams, RepeatPayload> = {
  name: "cost.rows", title: "Costs, broken down", shape: "repeat",
  params: CostRowsParams, inputs: filterInputs(COST_ROWS_FILTERS),
  selection: { entity: "stop", filters: COST_ROWS_FILTERS },
  description:
    "What each day of a selection costs, plus unscheduled stops, plus the total. Filter it to a tag or a kind for the breakdown of what matches.",
  emptyText: "no costs yet",
  preview: "each day's spend, and the total",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const { days, stops } = selection.value;
    const total = costOfStops(stops);
    if (total === 0) return empty();

    const byDay = new Map<number | null, SelectedStop[]>();
    for (const stop of stops) {
      const bucket = byDay.get(stop.dayIndex);
      if (bucket) bucket.push(stop);
      else byDay.set(stop.dayIndex, [stop]);
    }

    const rows: RepeatRow[] = [];
    for (const index of days) {
      const subtotal = costOfStops(byDay.get(index) ?? []);
      if (subtotal === 0) continue;
      const date = trip.days[index]!.date;
      rows.push({
        lead: rowLabel(date ? `Day ${index + 1} · ${date}` : `Day ${index + 1}`),
        values: [rowValue(formatMoney(subtotal, trip.currency))],
      });
    }
    const unscheduled = costOfStops(byDay.get(null) ?? []);
    if (unscheduled !== 0) {
      rows.push({ lead: rowLabel("Unscheduled"), values: [rowValue(formatMoney(unscheduled, trip.currency))] });
    }
    rows.push({ lead: rowLabel("Total"), values: [rowValue(formatMoney(total, trip.currency))] });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};
