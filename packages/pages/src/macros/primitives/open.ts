import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import type { Item, ItemsPayload, MacroDef, WidgetContext } from "../../registry-types";
import { itemsOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { dayLabel, formatShortDate } from "../../format";
import { dayCity } from "../../dayCity";
import type { ResolvedLinkTarget } from "../../linkTarget";

// `open` — "What needs you". SPEC §25's second half of the Overview page.
//
// **ADR-039's twelve primitives are still twelve.** This is a registered widget
// that is not a primitive, and the difference is the decision's own definition:
// a primitive is `entity + filters + shape`, and this has no entity to narrow.
// It is the trip's whole open list, always.
//
// That distinction was not obvious until the registry's own tests made it.
// Registering this as a thirteenth primitive failed three of them at once —
// `PRIMITIVE_NAMES` derives from `selection` being present, so a widget without
// one drops out of every primitive sweep, which is precisely what
// `PRIMITIVE_NAMES`' doc comment says should happen. The tests were right and
// the first draft of this file was wrong; ADR-039 needs no amendment.
//
// What the decision IS protecting still applies and is honoured here: a NAMED
// widget that is really an existing primitive plus params must be a preset,
// because seventeen names once hid four duplicate pairs. Nothing among the
// twelve resolves a conflict, an empty day or the backlog, so there is no
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
// **It declares no filters.** Every other repeat primitive narrows by day, city
// or tag; this one is the trip's whole open list by definition, and a
// "what needs you, on day 3 only" is a question nobody asked. `params` is
// therefore an empty object rather than `filterParams([])`, which keeps it out
// of the bind controls entirely: a widget with nothing to bind shows no bind
// row, and §26 wants the settings panel to say only true things.
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

const OpenParams = z.object({});
type OpenParams = z.infer<typeof OpenParams>;

const toDay = (day: TripDetail["days"][number]): ResolvedLinkTarget => ({ kind: "day", day: { kind: "dayId", dayId: day.dayId } });
// The rack is on the Plan, so that is where a parked idea is placed — and
// where a conflict that names no day (the budget) is fixed.
const PLAN: ResolvedLinkTarget = { kind: "view", view: "Plan" };

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
  inputs: [],
  selection: undefined,
  description: "Everything waiting on a decision: overlaps, empty days and parked ideas.",
  // The empty state is the good one here, and it should read like it. Every
  // other primitive's `emptyText` reports an absence the reader might not have
  // wanted ("no days to show"); this one reports that the trip is settled, in
  // the design's words (`openBlock`'s `emptyLine`).
  emptyText: "Nothing is waiting on you — every day has something on it and no two stops collide.",
  preview: "one row per thing waiting on a decision",
  resolve: ({ trip }: WidgetContext, _params): MacroResult<ItemsPayload> => {
    if (!trip) return needsTrip();

    const items: Item[] = [];

    // 1. Conflicts. Dismissed ones are NOT open items — dismissing one is the
    //    decision this widget is asking for, so a list that kept showing it
    //    would be asking twice. `dismissedConflictIds` is the same set the
    //    board filters on, read the same way.
    //
    //    A conflict is "on" the first day holding one of its stops. Over budget's
    //    subject is the trip itself, so it is on no day, and its own sentence
    //    takes the line a date and city would.
    const dismissed = new Set(trip.dismissedConflictIds);
    for (const conflict of trip.conflicts) {
      if (dismissed.has(conflict.id)) continue;
      const label = CONFLICT_LABEL[conflict.kind] ?? FALLBACK_CONFLICT_LABEL;
      const index = trip.days.findIndex((day) => conflict.subjects.some((id) => day.activityIds.includes(id)));
      const day = trip.days[index];
      items.push(
        day === undefined
          ? { label, sub: conflict.description, right: "Fix in Plan", tone: "warning", act: PLAN }
          : { label: `${label} on ${dayLabel(index)}`, sub: whereAndWhen(day, trip.activities), right: "Fix in Plan", tone: "warning", act: toDay(day) },
      );
    }

    // 2. Empty days. A day with no stops is a decision not yet made, and it is
    //    the one item here that is about a day rather than a thing on one.
    for (const [index, day] of trip.days.entries()) {
      if (day.activityIds.length > 0) continue;
      items.push({ label: `${dayLabel(index)} has nothing on it`, sub: whereAndWhen(day, trip.activities), right: "Plan it", tone: "info", act: toDay(day) });
    }

    // 3. Parked ideas — the unscheduled rack, as ONE row however long it is,
    //    so twenty saved places do not bury the two things that are broken.
    //    An id with no activity behind it is not counted: `activities` and
    //    `backlog` are two fields of one projection and can only disagree
    //    mid-write, which is a reason to say one fewer, not to name a blank.
    const parked = trip.backlog.flatMap((id) => trip.activities[id]?.title ?? []);
    if (parked.length > 0) {
      items.push({
        label: parked.length === 1 ? "1 idea is parked" : `${parked.length} ideas are parked`,
        sub: parked.slice(0, 2).join(" · "),
        right: "Place them",
        tone: "plain",
        act: PLAN,
      });
    }

    if (items.length === 0) return empty();
    return ok({ kind: "items", items });
  },
  render: itemsOf,
};

