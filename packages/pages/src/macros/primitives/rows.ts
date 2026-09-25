import { z } from "zod";
import type { FilterDimension, KindRef } from "@tc/contracts";
import type { MacroDef, RepeatPayload, RepeatRow, RepeatValue, WidgetContext, WidgetInput } from "../../registry-types";
import { chip, rowCity, rowLabel, rowValue, rowsOf, text } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { cityDayOrdinals, costOfStops, narrow, stopsInCity, type SelectedStop } from "../../select";
import { dayLabel, formatMoney, formatDate } from "../../format";
import { readerClock, toClockRange } from "../../clockLabel";
import { needsBooking } from "../../needsBooking";
import { fieldAt, formatStopField } from "../../fields";

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
// Cells, not one flattened line. `RepeatRow` has always carried `{ lead,
// values }` and this seam used to throw the boundary away — which is why a
// table looked like it needed a new cell model when it only needed the one
// already upstream. See `RenderedRow`.
/**
 * A repeat payload as rendered rows, cell for cell: a label as text, every
 * other value as a chip. Exported so every repeat widget renders one way —
 * `day.sun` (`time.ts`) is the first outside this file.
 */
export const renderRows = (payload: RepeatPayload) =>
  rowsOf(
    payload.rows.map((row) => ({
      lead: [segOf(row.lead)],
      // A cell holding several values (a day in two cities) lists them with a
      // comma between, not run together (Mitchell, PR 221 preview).
      cells: row.cells.map((cell) => cell.flatMap((value, i) => (i === 0 ? [segOf(value)] : [text(", "), segOf(value)]))),
      ...(row.kind === undefined ? {} : { kind: row.kind }),
    })),
    payload.headings,
  );

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
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    if (selection.value.days.length === 0) return empty();
    // Three columns, always the same three, and empty where a day has no
    // answer: date, cities, cost. Mitchell, 2026-09-06: *"The date and the city
    // and the text shouldnt all be rolled into each other. Introduce real
    // columns"*. A day with no date still leaves its date column open, because
    // a column that appears and disappears per row is not a column.
    const rows: RepeatRow[] = selection.value.days.map((index) => {
      const day = trip.days[index]!;
      // One value PER CITY inside the city cell, not one joined string: a day
      // that touches two cities wears two colours on the board, and one value
      // can only wear one.
      const cities = (globals?.days[index]?.cities ?? []).map(rowCity);
      return {
        lead: rowLabel(dayLabel(index)),
        cells: [
          day.date === null ? [] : [rowValue(formatDate(day.date))],
          cities,
          day.costSubtotal === 0 ? [] : [rowValue(formatMoney(day.costSubtotal, trip.currency))],
        ],
      };
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
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const cities = selection.value.cities;
    if (cities.length === 0) return empty();
    const { days, stops } = selection.value;
    const rows: RepeatRow[] = cities.map((entry) => {
      // Two columns: which days, and how many stops.
      //
      // **Both are scoped to the selection.** `TripGlobalsCity` carries
      // the whole trip's answer, so a date-filtered line was showing one
      // selected day beside a stop count that included the days the filter had
      // just excluded (CodeRabbit, PR 141).
      //
      // Day NUMBERS, not indexes: the projection counts from 0 and a person
      // counts from 1.
      const ordinals = cityDayOrdinals(entry, days);
      const count = stopsInCity(stops, entry.name).length;
      return {
        lead: rowCity(entry.name),
        cells: [
          ordinals.length === 0 ? [] : [rowValue(ordinals.map((ordinal) => `Day ${ordinal}`).join(", "))],
          count === 0 ? [] : [rowValue(count === 1 ? "1 stop" : `${count} stops`)],
        ],
      };
    });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

const STOP_ROWS_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
// **A derived selection, not a filter dimension.** "Still to book" is not a
// value of any one field — it is `needsBooking` over `kind` AND `tags`, the
// rule Mitchell decided on 2026-08-29 — so it cannot be a `{dimension: value}`
// binding without inventing a dimension no other entity could use. It is a
// non-filter param instead, the treatment `count`'s `of` gets: chosen once by
// the preset, no control of its own, and listed to the assistant by
// `primitiveCatalog` straight off this enum. It narrows AFTER `narrow`, so it
// composes with every filter rather than replacing one.
const StopRowsOnly = z.enum(["needsBooking"]);
// **Field columns** (M14 field widget, build step 6; Mitchell's answer 4). Paths,
// in the order the reader chose, each checked at resolve time like any `field`
// param — so a stale one drops out of the table rather than blocking the save.
//
// `stop.rows` only. `day.rows` and `city.rows` iterate `TripGlobals`
// collections, and every field those publish is either a column the row
// already has (date, cities, cost; days, stop count) or a 0-based `index` that
// would print "Day 0" beside a lead reading "Day 1".
const StopRowsParams = filterParams(STOP_ROWS_FILTERS, {
  only: StopRowsOnly.optional(),
  columns: z.array(z.string()).optional(),
});
type StopRowsParams = z.infer<typeof StopRowsParams>;
const STOP_ROWS_INPUTS: readonly WidgetInput[] = [
  ...filterInputs(STOP_ROWS_FILTERS),
  { name: "columns", type: "field", label: "Columns", of: "stop", multiple: true },
];

// The header a group of stops sits under: a row whose lead is a label and which
// has no cells at all, which `renderRows` turns into a single text segment and
// the renderer widens across the whole row.
//
// A header is a row AND carries `kind: "header"`, as of 2026-09-06.
//
// This comment used to argue the opposite — that giving `RepeatRow` a `kind`
// "would push a grouping concept through the render seam and into `apps/web`
// for one widget's benefit", and that a label-only line said the same thing
// with what already existed. That held while a repeat rendered as a list of
// lines. It stopped holding when Mitchell asked for the table these were
// always meant to be: a renderer that must not put a group header in the
// value column has to know which rows are headers, and "its values array is
// empty" is the guess that reasoning was avoiding, not an answer.
const headerRow = (label: string): RepeatRow => ({ lead: rowLabel(label), cells: [], kind: "header" });

/**
 * What an empty `stop.rows` says when a `kind` filter is what emptied it.
 *
 * Only the kinds that make a sentence. "nothing left to book" is a fact about
 * the trip that says there is no next thing to do; "nothing planned" would
 * read as an empty trip when it only means an empty filter, so `planned` and
 * `transit` fall back to the blanket `emptyText`, deliberately, rather than
 * being a gap.
 *
 * This is the limitation `emptyText`'s own comment above describes — a fixed
 * string that cannot see the params — retired for the one case where the
 * params make the difference a reader cares about. It said "nothing booked
 * yet" for `booked` until M28 retired that kind (ADR-054).
 */
const NOTHING_MATCHED: Partial<Record<KindRef, string>> = {
  pending: "nothing left to book",
};

/**
 * `stop.rows` — one line per stop: when it is, and what it cost.
 *
 * Wide this is `stop.line` over the whole trip; with a `kind` it is what
 * `booking.line` was. The fourth row of ADR-039's table of widgets written
 * twice, and the one that needed no new data at all — "booking" was already an
 * `ActivityKind` member (`booked`, until M28 folded it into `planned`).
 *
 * **Stops are grouped under day headers when the selection spans more than one
 * day**, which is the spec's own wording. One day needs no header (the widget is
 * pointed at that day and the chrome row says so), and the backlog gets an
 * "Unscheduled" header for the same reason a day gets a numbered one: a line
 * with no heading over it reads as belonging to whatever came before it.
 */
export const stopRows: MacroDef<StopRowsParams, RepeatPayload> = {
  name: "stop.rows", title: "A line for every stop", shape: "repeat",
  params: StopRowsParams, inputs: STOP_ROWS_INPUTS,
  selection: { entity: "stop", filters: STOP_ROWS_FILTERS },
  description:
    "One line per selected stop: when it is, and what it cost. Filter it to a day, a tag, or a kind — booked, for instance, gives a line for every booking. `only: needsBooking` keeps just the stops still to book. `columns` adds a column per chosen field, in order.",
  // True whether the selection held no stops at all or the filters matched none
  // of them. `emptyText` is a fixed string on the definition and cannot see the
  // params, so "no stops on this day" would be a claim the widget cannot keep.
  //
  // **The resolver can now say more when it knows more** (`MacroResult.because`,
  // added 2026-09-13 for `attribute`'s five fields). See `NOTHING_MATCHED`
  // below: this stays the answer for a selection whose filters the widget
  // cannot phrase, and a `kind` filter gets its own words.
  emptyText: "no stops to show",
  preview: "one line per stop, with its time and cost",
  resolve: ({ trip, globals, user }: WidgetContext, params, item): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const format = readerClock(user);
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const stops = params.only === "needsBooking"
      ? selection.value.stops.filter(({ activity }) => needsBooking(activity))
      : selection.value.stops;
    if (stops.length === 0) {
      // The rule outranks a kind filter for the words: under "Still to book"
      // an empty list is the good news, whatever else narrowed it.
      if (params.only === "needsBooking") return empty("nothing left to book");
      return empty(params.kind === undefined ? undefined : NOTHING_MATCHED[params.kind]);
    }

    // Only what the manifest publishes; see `StopRowsParams`.
    const columns = (params.columns ?? []).flatMap((path) => fieldAt("stop", path) ?? []);
    const headings = columns.length === 0 ? undefined : ["Stop", "Time", "Cost", ...columns.map((c) => c.label)];
    const kindCtx = { currency: trip.currency };

    // Two columns: when it is, and what it cost. A stop with no time still
    // leaves the time column open, so the costs stay in one line down the page.
    // Then one per chosen field, empty where the stop has no value, for the
    // same reason.
    const lineOf = ({ activity }: SelectedStop): RepeatRow => ({
      lead: rowLabel(activity.title),
      cells: [
        activity.timeWindow ? [rowValue(toClockRange(activity.timeWindow.start, activity.timeWindow.end, format))] : [],
        activity.cost ? [rowValue(formatMoney(activity.cost.amountMinor, activity.cost.currency))] : [],
        ...columns.map((choice) => {
          const value = formatStopField(choice, [activity], kindCtx);
          return value === null ? [] : [rowValue(value)];
        }),
      ],
    });

    // Group only when there is more than one group to tell apart. `stops` is
    // already in board order — the selected days in order, then the backlog —
    // so a header is due whenever the day changes.
    const groups = new Set(stops.map((stop) => stop.dayIndex));
    if (groups.size <= 1) return ok({ kind: "repeat-rows", rows: stops.map(lineOf), ...(headings ? { headings } : {}) });

    const rows: RepeatRow[] = [];
    let current: number | null | undefined;
    for (const stop of stops) {
      if (stop.dayIndex !== current) {
        current = stop.dayIndex;
        rows.push(headerRow(stop.dayIndex === null ? "Unscheduled" : dayLabel(stop.dayIndex)));
      }
      rows.push(lineOf(stop));
    }
    return ok({ kind: "repeat-rows", rows, ...(headings ? { headings } : {}) });
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
  // "nothing priced yet", not "no costs yet" — which is `cost`'s wording, and
  // the two sit on the same page: the Overview's "What it costs" is a `cost`
  // summary line over this breakdown. The same three words twice, one under the
  // other, reads as a rendering fault rather than as two widgets agreeing.
  emptyText: "nothing priced yet",
  preview: "each day's spend, and the total",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
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
        // Day and date in their own columns, not joined on a `·`. They were
        // joined when the lead was the only place either could go; *"the date
        // and the city and the text shouldnt all be rolled into each other"*
        // is the same complaint one widget over, and the join here is the same
        // mistake.
        //
        // `formatDate`, not the raw ISO. Mitchell, 2026-09-06 on the preview:
        // *"these should be human readable strings, march 10, 2026 rather than
        // 2026-03-10"*. `day.rows` on the same page already went through
        // `formatDate` and drew no complaint, which is why this keeps the
        // abbreviated month it produces rather than inventing a second date
        // format for one widget.
        lead: rowLabel(dayLabel(index)),
        cells: [date ? [rowValue(formatDate(date))] : [], [rowValue(formatMoney(subtotal, trip.currency))]],
      });
    }
    const unscheduled = costOfStops(byDay.get(null) ?? []);
    if (unscheduled !== 0) {
      rows.push({ lead: rowLabel("Unscheduled"), cells: [[], [rowValue(formatMoney(unscheduled, trip.currency))]] });
    }
    rows.push({
      lead: rowLabel("Total"),
      cells: [[], [rowValue(formatMoney(total, trip.currency))]],
      kind: "total",
    });
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};
