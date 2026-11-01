import type { z } from "zod";
import { OpenClass, OpenClassRef, type FilterDimension, type TripDetail } from "@tc/contracts";
import type { Item, ItemsPayload, MacroDef, WidgetContext } from "../../registry-types";
import { itemsOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { dayLabel, formatShortDate } from "../../format";
import { dayCity } from "../../dayCity";
import type { ActTarget } from "../../linkTarget";
import { filterInputs, filterParams } from "../../filters";
import { narrow } from "../../select";

// `open` — "What needs you". SPEC §25's second half of the Overview page.
//
// **A day primitive since M43 decision 5.** It shipped with no `selection`,
// the trip's whole open list; filtering by days gave it the entity and filter
// ADR-039 decision 1 defines a primitive by, so it now sits in every primitive
// sweep. A NAMED widget that is an existing primitive plus params must still
// be a preset, because seventeen names once hid four duplicate pairs; nothing
// else resolves a conflict, an empty day or the backlog, so there is no
// primitive for this to be a preset of.
//
// **It reads only what the trip already says.** §25: *"Everything on it is
// derived from the same trip state the other tabs read. An Overview that can
// disagree with Plan is worse than no Overview."* So there is no "open items"
// projection and no new field: an overlap is a `Conflict` the board already
// draws, an empty day is a day with no `activityIds`, and a parked idea is a
// `backlog` entry — the three things the unscheduled rack, the conflict banner
// and the day columns are each already showing somewhere else.
//
// **It filters by class and by days** (M43 decision 5). The class is one of
// its three kinds of row, never a `Conflict.kind`; the days are the `dates`
// dimension every day-selecting widget offers, so a page's date scope fills it
// when the author left it open, as it does theirs (`followsDateScope`). A
// parked idea is on no day and the budget is the whole trip's, so a Days
// filter places neither: only the class filter hides them.

/**
 * What each conflict kind is CALLED at the start of its row.
 *
 * Every row here said "Overlap", which was true of one of the four kinds
 * `detectConflicts` emits and a lie about the other three: an impossible
 * journey between two cities, a stop that broke the day it was anchored to, and
 * a trip over its budget were all announced as overlaps (CodeRabbit, PR 170).
 * The description beside them was always right, so the effect was a label
 * arguing with the sentence next to it.
 *
 * `Conflict.kind` is `z.string()` in the contract rather than an enum, so this
 * cannot be exhaustive by type — hence the fallback below, which is a word that
 * is true of anything the domain might add later. `open.test.ts` asserts this
 * map covers every kind `packages/domain` actually emits, which is the check
 * the type cannot make.
 */
const CONFLICT_LABEL: Record<string, string> = {
  "time-overlap": "Overlap",
  "impossible-geography": "Too far",
  "anchor-violation": "Anchor",
  "over-budget": "Over budget",
};

/**
 * For a kind this file has not heard of.
 *
 * "Conflict" rather than the raw `kind`: a stored identifier printed into a
 * page is how `time-overlap` would end up as a label somebody reads, and the
 * row still says which day it is on.
 */
const FALLBACK_CONFLICT_LABEL = "Conflict";

/**
 * The same kinds, counted: "3 overlaps on Day 1".
 *
 * `detectConflicts` raises one overlap per PAIR of stops, so three stops that
 * all collide are three conflicts. One row each drew three identical lines with
 * one link, and nobody could tell why there were three (PR 660 review). So
 * conflicts fold to one row per day and kind (Mitchell, 2026-11-01); the row's
 * link already lands on the day where every one of them is visible.
 */
const CONFLICT_PLURAL: Record<string, string> = {
  "time-overlap": "overlaps",
  "impossible-geography": "journeys too far",
  "anchor-violation": "anchors broken",
  "over-budget": "over budget",
};
const FALLBACK_CONFLICT_PLURAL = "conflicts";

const OPEN_FILTERS = ["dates"] as const satisfies readonly FilterDimension[];

const OpenParams = filterParams(OPEN_FILTERS, { class: OpenClassRef.optional() });
type OpenParams = z.infer<typeof OpenParams>;

/** What each class is called in the settings, in `OpenClass` order, which is the order the rows come in. */
const CLASS_LABEL: Record<OpenClass, string> = { conflict: "Conflicts", "empty-day": "Empty days", parked: "Parked ideas" };

const toDay = (day: TripDetail["days"][number]): ActTarget => ({ kind: "day", day: { kind: "dayId", dayId: day.dayId } });
// Where a conflict that names no day (the budget) is fixed.
const PLAN: ActTarget = { kind: "view", view: "Plan" };
// Where a parked idea is placed: the rack, opened — not plain Plan, which
// lands with the rack shut and the ideas this row named off screen.
const RACK: ActTarget = { kind: "rack" };

/** "Aug 1 · Kyoto": whichever of the two the day has, so a missing one leaves no stray dot. */
function whereAndWhen(day: TripDetail["days"][number], activities: TripDetail["activities"]): string {
  return [formatShortDate(day.date), dayCity(day, activities)].filter((part) => part !== null).join(" · ");
}

export const open: MacroDef<OpenParams, ItemsPayload> = {
  name: "open",
  title: "What needs you",
  // Still `repeat` to the picker and the editor: one line per thing is what it
  // is to someone choosing it. Only its payload left `RepeatPayload` (M43
  // decision 4), and `WidgetShape` is a contract this change does not touch.
  shape: "repeat",
  params: OpenParams,
  inputs: [
    { name: "class", type: "choices", label: "Show", options: OpenClass.options.map((value) => ({ value, label: CLASS_LABEL[value] })) },
    ...filterInputs(OPEN_FILTERS),
  ],
  // `day` is the entity because the Days filter selects days: a conflict is on
  // the day holding its stops and an empty day is one.
  selection: { entity: "day", filters: OPEN_FILTERS },
  description: "Everything waiting on a decision: overlaps, empty days and parked ideas.",
  // The empty state is the good one here, and it should read like it. Every
  // other primitive's `emptyText` reports an absence the reader might not have
  // wanted ("no days to show"); this one reports that the trip is settled, in
  // the design's words (`openBlock`'s `emptyLine`).
  emptyText: "Nothing is waiting on you — every day has something on it and no two stops collide.",
  emptyIsGood: true,
  preview: "one row per thing waiting on a decision",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<ItemsPayload> => {
    if (!trip) return needsTrip();
    const shows = new Set<OpenClass>(params.class ?? OpenClass.options);
    // The days the Days filter, or the page's scope, leaves (`narrow`).
    const selection = narrow(trip, globals, { dates: params.dates }, item);
    if (selection.status !== "ok") return selection;
    const onDays = new Set(selection.value.days);

    const items: Item[] = [];

    // 1. Conflicts. Dismissed ones are NOT open items — dismissing one is the
    //    decision this widget is asking for, so a list that kept showing it
    //    would be asking twice. `dismissedConflictIds` is the same set the
    //    board filters on, read the same way.
    //
    //    A conflict is "on" the first day holding one of its stops. Over budget's
    //    subject is the trip itself, so it is on no day, and its own sentence
    //    takes the line a date and city would.
    //
    //    One row per day and kind, in the order each first appears. Conflicts
    //    on no day fold by kind alone and keep the first one's sentence.
    const dismissed = new Set(trip.dismissedConflictIds);
    const folded = new Map<string, { kind: string; index: number; description: string; count: number }>();
    for (const conflict of shows.has("conflict") ? trip.conflicts : []) {
      if (dismissed.has(conflict.id)) continue;
      const index = trip.days.findIndex((day) => conflict.subjects.some((id) => day.activityIds.includes(id)));
      const key = `${index}:${conflict.kind}`;
      const seen = folded.get(key);
      if (seen) seen.count += 1;
      else folded.set(key, { kind: conflict.kind, index, description: conflict.description, count: 1 });
    }
    for (const { kind, index, description, count } of folded.values()) {
      const day = trip.days[index];
      if (day !== undefined && !onDays.has(index)) continue;
      const label = count === 1
        ? CONFLICT_LABEL[kind] ?? FALLBACK_CONFLICT_LABEL
        : `${count} ${CONFLICT_PLURAL[kind] ?? FALLBACK_CONFLICT_PLURAL}`;
      items.push(
        day === undefined
          ? { label, sub: description, right: "Fix in Plan", tone: "warning", act: PLAN }
          : { label: `${label} on ${dayLabel(index)}`, sub: whereAndWhen(day, trip.activities), right: "Fix in Plan", tone: "warning", act: toDay(day) },
      );
    }

    // 2. Empty days. A day with no stops is a decision not yet made, and it is
    //    the one item here that is about a day rather than a thing on one.
    for (const [index, day] of shows.has("empty-day") ? trip.days.entries() : []) {
      if (day.activityIds.length > 0 || !onDays.has(index)) continue;
      items.push({ label: `${dayLabel(index)} has nothing on it`, sub: whereAndWhen(day, trip.activities), right: "Plan it", tone: "info", act: toDay(day) });
    }

    // 3. Parked ideas — the unscheduled rack, as ONE row however long it is,
    //    so twenty saved places do not bury the two things that are broken.
    //    An id with no activity behind it is not counted: `activities` and
    //    `backlog` are two fields of one projection and can only disagree
    //    mid-write, which is a reason to say one fewer, not to name a blank.
    const parked = shows.has("parked") ? trip.backlog.flatMap((id) => trip.activities[id]?.title ?? []) : [];
    if (parked.length > 0) {
      items.push({
        label: parked.length === 1 ? "1 idea is parked" : `${parked.length} ideas are parked`,
        sub: parked.slice(0, 2).join(" · "),
        right: "Place them",
        tone: "plain",
        act: RACK,
      });
    }

    // `emptyText` vouches for every day and every conflict, which is only
    // known when no filter hid any: Parked alone, or a Days filter, would
    // otherwise tell the reader a clash it skipped is not there.
    const filtered = shows.size < OpenClass.options.length || onDays.size < trip.days.length;
    if (items.length === 0) return filtered ? empty("Nothing here needs you.") : empty();
    return ok({ kind: "items", items });
  },
  render: itemsOf,
};

