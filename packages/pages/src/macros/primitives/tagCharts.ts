import { z } from "zod";
import type { FilterDimension, TimeWindow } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type {
  SpendSeriesKey, TagBreakdownPayload, TagBreakdownSlice, TagMeasure, TagsByDayBar, TagsByDayPayload,
  TripDescriptionPayload,
} from "../../chartPayloads";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { datesLabel, narrow, type Narrowed, type SelectedStop } from "../../select";
import { dayLabel, formatDate, ordinal } from "../../format";
import { VALUE_KIND_FORMATS } from "../../kinds";
import { TAG_LABEL } from "../../enumLabels";
import { apportionPercents, shareLabel } from "../../shares";
import { SPEND_SERIES, SPEND_SERIES_LABEL, isSpendSeries, seriesOf } from "./spendSeries";

// The tag widgets (M42 D11, ADR-070): what a trip is made of, counted rather
// than priced. Three registrations behind four presets:
//
// - `tag.breakdown`: "Activities by tag" (`measure: "count"`) and "Hours by
//   tag" (`measure: "hours"`), a donut or a bar per tag, with "Spend by
//   day"'s "Variation" choice between the two.
// - `tag.byDay`: "Tags by day", a bar per day stacked by tag.
// - `trip.description`: "Trip description", the words and the top tags.
//
// **Ticketed is never counted** (ADR-070 decision 2): the charts file a stop
// under `seriesOf`, the spend charts' rule, which knows only categories, so a
// stop tagged only Ticketed is Untagged here as it is there. The description
// is the server's, from `describeByTags`, which leaves Ticketed out itself.
//
// **Travel stops are left out of the charts**, as `describeByTags` leaves them
// out: a transfer is how a trip gets between the things it is about. Spend
// keeps them, because a train ticket is money; a train is not an activity.

/** The stops a tag chart counts: every selected one but travel. */
const counted = (stops: readonly SelectedStop[]) => stops.filter((s) => s.activity.kind !== "transit");

const zeroes = (): Record<SpendSeriesKey, number> =>
  Object.fromEntries(SPEND_SERIES.map((key) => [key, 0])) as Record<SpendSeriesKey, number>;

const stopsText = (n: number) => `${VALUE_KIND_FORMATS.count.format(n, { currency: "" })} ${n === 1 ? "stop" : "stops"}`;

const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
// The contract refuses a window that ends before it starts, so this is positive.
const minutesOf = (window: TimeWindow) => toMinutes(window.end) - toMinutes(window.start);

/** What each measure is called, and how a value of it reads. */
const MEASURES: { readonly [M in TagMeasure]: { title: string; heading: string; text: (value: number) => string } } = {
  count: { title: "Activities by tag", heading: "Stops", text: stopsText },
  hours: { title: "Hours by tag", heading: "Time", text: (minutes) => VALUE_KIND_FORMATS.duration.format(minutes, { currency: "" }) },
};
const MEASURE_NAMES = Object.keys(MEASURES) as [TagMeasure, ...TagMeasure[]];

/** "Activities by tag · Kyoto · Day 3": what it is, and what it is narrowed to. */
function titleOf(measure: TagMeasure, selection: Narrowed): string {
  const { filters } = selection;
  const parts = [MEASURES[measure].title];
  if (filters.city !== undefined) parts.push(filters.city);
  if (filters.day !== undefined && selection.days.length === 1) parts.push(dayLabel(selection.days[0]!));
  if (filters.dates !== undefined) parts.push(datesLabel(filters.dates));
  return parts.join(" · ");
}

// `tag` is not declared: the slices ARE the tags, so a tag filter would make a
// one-slice pie ("Spend by tag" withholds it for the same reason). Nor is
// `kind`, since travel is already out and the other two kinds are both "an
// activity" here.
const TAG_BREAKDOWN_FILTERS = ["day", "dates", "city"] as const satisfies readonly FilterDimension[];
const TagBreakdownParams = filterParams(TAG_BREAKDOWN_FILTERS, {
  // Absent is "count", and "pie".
  measure: z.enum(MEASURE_NAMES).optional(),
  view: z.enum(["pie", "bars"]).optional(),
});
type TagBreakdownParams = z.infer<typeof TagBreakdownParams>;

const TAG_BREAKDOWN_INPUTS: readonly WidgetInput[] = [
  {
    name: "measure", type: "choice", label: "Measure", default: "count",
    options: [{ value: "count", label: "Activities" }, { value: "hours", label: "Hours" }],
  },
  ...filterInputs(TAG_BREAKDOWN_FILTERS),
  // "Spend by day"'s word for a choice of picture over the same numbers.
  {
    name: "view", type: "choice", label: "Variation", default: "pie",
    options: [{ value: "pie", label: "Pie" }, { value: "bars", label: "Bars" }],
  },
];

export const tagBreakdown: MacroDef<TagBreakdownParams, TagBreakdownPayload> = {
  name: "tag.breakdown", title: "Tag breakdown", shape: "block",
  params: TagBreakdownParams, inputs: TAG_BREAKDOWN_INPUTS,
  selection: { entity: "stop", filters: TAG_BREAKDOWN_FILTERS },
  description:
    "How many stops carry each tag (Food, Lodging, Outdoors, Drinks, Nightlife, Museum, Sight, Beach, Shopping, Show, Tour, Wellness, Untagged), or how many hours they take, as a pie or a bar per tag, with each tag's share. A stop with several tags counts under its first; Ticketed is never counted, and travel stops are left out. For hours, a stop with no time is left out and named. Filter it to a day, dates or a city.",
  emptyText: "no stops to count yet",
  // Fixed, never computed (ADR-037 decision 5). The presets carry their own.
  preview: "a pie of how many stops carry each tag",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<TagBreakdownPayload> => {
    if (!trip) return needsTrip();
    const measure: TagMeasure = params.measure ?? "count";
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const stops = counted(selection.value.stops);

    const charted = measure === "hours" ? stops.filter((s) => s.activity.timeWindow) : stops;
    const untimed = stops.length - charted.length;
    const valueOf = (s: SelectedStop) => (measure === "hours" ? minutesOf(s.activity.timeWindow!) : 1);
    const values = SPEND_SERIES.map((key) =>
      charted.filter((s) => seriesOf(s) === key).reduce((sum, s) => sum + valueOf(s), 0),
    );
    const percents = apportionPercents(values);
    const notCharted = untimed === 0 ? null : `Not charted: ${stopsText(untimed)} with no time.`;
    if (percents === null) return untimed === 0 ? empty() : empty(`no stop has a time yet: ${stopsText(untimed)} with none`);

    const { text, heading } = MEASURES[measure];
    const slices: TagBreakdownSlice[] = SPEND_SERIES.map((key, i) => ({
      key,
      label: SPEND_SERIES_LABEL[key],
      value: values[i]!,
      text: values[i] === 0 ? null : text(values[i]!),
      share: shareLabel(values[i]!, percents[i]!),
    }));
    const title = titleOf(measure, selection.value);
    const total = text(values.reduce((sum, value) => sum + value, 0));
    return ok({
      kind: "tag-breakdown",
      measure,
      view: params.view ?? "pie",
      title,
      valueHeading: heading,
      slices,
      total,
      summary:
        `${title}: ${total} — ` +
        slices.filter((s) => s.text !== null).map((s) => `${s.label} ${s.text} (${s.share})`).join(", ") + ".",
      notCharted,
    });
  },
  render: blockOf,
};

// `dates` only: a chart of days is cut by a run of them, as "Spend by day" is.
const TAGS_BY_DAY_FILTERS = ["dates"] as const satisfies readonly FilterDimension[];
const TagsByDayParams = filterParams(TAGS_BY_DAY_FILTERS);
type TagsByDayParams = z.infer<typeof TagsByDayParams>;

/** The count axis: 0 to the tallest bar in at most five whole steps. */
function ticksFor(tallest: number): number[] {
  const step = Math.max(1, Math.ceil(tallest / 4));
  const ticks: number[] = [];
  for (let value = 0; value < tallest + step; value += step) ticks.push(value);
  return ticks;
}

export const tagsByDay: MacroDef<TagsByDayParams, TagsByDayPayload> = {
  name: "tag.byDay", title: "Tags by day", shape: "block",
  params: TagsByDayParams, inputs: filterInputs(TAGS_BY_DAY_FILTERS),
  selection: { entity: "stop", filters: TAGS_BY_DAY_FILTERS },
  description:
    "A bar per day for how many stops it has, stacked by tag. A stop with several tags counts under its first; Ticketed is never counted, and travel stops are left out. Filter it to a date range.",
  emptyText: "no stops to count yet",
  preview: "a bar per day of its stops, stacked by tag",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<TagsByDayPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const stops = counted(selection.value.stops);
    const unscheduled = stops.filter((s) => s.dayIndex === null).length;
    const notCharted = unscheduled === 0 ? null : `Not charted: ${stopsText(unscheduled)} not on a day yet.`;
    if (stops.length === unscheduled) return unscheduled === 0 ? empty() : empty(`nothing on a day yet: ${stopsText(unscheduled)} unscheduled`);

    const days: TagsByDayBar[] = selection.value.days.map((index) => {
      const counts = zeroes();
      for (const stop of stops) if (stop.dayIndex === index) counts[seriesOf(stop)] += 1;
      const date = trip.days[index]!.date;
      const parts = SPEND_SERIES.filter((key) => counts[key] > 0).map((key) => `${SPEND_SERIES_LABEL[key]} ${counts[key]}`);
      return {
        label: dayLabel(index),
        tick: ordinal(index + 1),
        date: date === null ? null : formatDate(date),
        counts,
        total: SPEND_SERIES.reduce((sum, key) => sum + counts[key], 0),
        breakdown: parts.join(", ") || null,
      };
    });
    const series = SPEND_SERIES.filter((key) => days.some((day) => day.counts[key] > 0)).map((key) => ({
      key, label: SPEND_SERIES_LABEL[key],
    }));
    const onDays = days.reduce((sum, day) => sum + day.total, 0);
    return ok({
      kind: "tags-by-day",
      series,
      days,
      ticks: ticksFor(Math.max(...days.map((day) => day.total))),
      summary: `Tags by day: ${stopsText(onDays)} over ${days.length} ${days.length === 1 ? "day" : "days"} — ${series.map((s) => s.label).join(", ")}.`,
      notCharted,
    });
  },
  render: blockOf,
};

/** How many of the top tags the description shows beside its words. */
const TOP_TAGS = 3;

const TripDescriptionParams = z.object({});
type TripDescriptionParams = z.infer<typeof TripDescriptionParams>;

// **A registered widget, not a primitive**, on `trip.strip`'s terms: it
// describes the whole trip, and a description of some of it would contradict
// the one on the trip's home card.
//
// **The words are not worked out here.** `TripGlobals.description` carries
// them, from `describeByTags` over every activity, the backlog's too, on the
// server: the rule is in `@tc/domain`, which this package may not import, and
// reading the days alone gives another answer (Iceland is "Outdoorsy" by its
// activities and "Outdoors & food" by its days).
export const tripDescription: MacroDef<TripDescriptionParams, TripDescriptionPayload> = {
  name: "trip.description",
  title: "Trip description",
  shape: "block",
  params: TripDescriptionParams,
  inputs: [],
  selection: undefined,
  description:
    "What kind of trip this is, in words, worked out from its stops' tags (the ones the home card shows), with its top tags and the share of tagged stops each is on. Ticketed, Lodging and travel stops are not counted.",
  emptyText: "tag a few more stops to see this",
  preview: "what kind of trip this is, and its top tags",
  resolve: ({ trip, globals }: WidgetContext): MacroResult<TripDescriptionPayload> => {
    if (!trip) return needsTrip();
    const description = globals?.description;
    if (!description) return empty();
    const { counted: of } = description;
    // `isSpendSeries` narrows the type only: the server lists no Ticketed here.
    const tags = description.tags.flatMap(({ tag, activityCount }) =>
      isSpendSeries(tag)
        ? [{
            key: tag,
            label: TAG_LABEL[tag],
            // Not apportioned, unlike a pie's: a stop that is a meal and a bar
            // is on both, so each share is of the same whole and they need not
            // add up to 100.
            share: shareLabel(activityCount, Math.round((activityCount * 100) / of))!,
          }]
        : [],
    ).slice(0, TOP_TAGS);
    const basis = `${VALUE_KIND_FORMATS.count.format(of, { currency: "" })} tagged ${of === 1 ? "stop" : "stops"}`;
    return ok({
      kind: "trip-description",
      text: description.text,
      tags,
      basis: `Share of ${basis}`,
      summary: `${description.text}: ${tags.map((t) => `${t.label} on ${t.share}`).join(", ")} of ${basis}.`,
    });
  },
  render: blockOf,
};
