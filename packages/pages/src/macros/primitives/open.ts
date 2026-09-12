import { z } from "zod";
import type { MacroDef, RepeatPayload, RepeatRow, RepeatValue, WidgetContext } from "../../registry-types";
import { chip, rowLabel, rowValue, rowsOf, text } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";

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
const OpenParams = z.object({});
type OpenParams = z.infer<typeof OpenParams>;

const segOf = (v: RepeatValue) => (v.name === "label" ? text(v.text) : chip(v.name, v.text));
const renderRows = (payload: RepeatPayload) =>
  rowsOf(
    payload.rows.map((row) => ({
      lead: [segOf(row.lead)],
      cells: row.cells.map((cell) => cell.map(segOf)),
      ...(row.kind === undefined ? {} : { kind: row.kind }),
    })),
  );

export const open: MacroDef<OpenParams, RepeatPayload> = {
  name: "open",
  title: "What needs you",
  shape: "repeat",
  params: OpenParams,
  inputs: [],
  selection: undefined,
  description: "Everything waiting on a decision: overlaps, empty days and parked ideas.",
  // The empty state is the good one here, and it should read like it. Every
  // other primitive's `emptyText` reports an absence the reader might not have
  // wanted ("no days to show"); this one reports that the trip is settled.
  emptyText: "nothing is waiting on you",
  preview: "one row per thing waiting on a decision",
  resolve: ({ trip }: WidgetContext, _params): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();

    const rows: RepeatRow[] = [];

    // 1. Overlaps. Dismissed conflicts are NOT open items — dismissing one is
    //    the decision this widget is asking for, so a list that kept showing it
    //    would be asking twice. `dismissedConflictIds` is the same set the
    //    board filters on, read the same way.
    const dismissed = new Set(trip.dismissedConflictIds);
    for (const conflict of trip.conflicts) {
      if (dismissed.has(conflict.id)) continue;
      rows.push({
        lead: rowLabel("Overlap"),
        cells: [[rowValue(conflict.description)]],
      });
    }

    // 2. Empty days. A day with no stops is a decision not yet made, and it is
    //    the one item here that is about a day rather than a thing on one.
    for (const [index, day] of trip.days.entries()) {
      if (day.activityIds.length > 0) continue;
      rows.push({
        lead: rowLabel("Empty day"),
        cells: [[rowValue(`Day ${index + 1}`)]],
      });
    }

    // 3. Parked ideas — the unscheduled rack, by its other name. An id with no
    //    activity behind it is skipped rather than rendered as a blank row:
    //    `activities` and `backlog` are two fields of one projection and can
    //    only disagree if that projection is mid-write, which is a reason to
    //    show one fewer row, not a reason to show an empty one.
    for (const activityId of trip.backlog) {
      const activity = trip.activities[activityId];
      if (activity === undefined) continue;
      rows.push({
        lead: rowLabel("Parked"),
        cells: [[rowValue(activity.title)]],
      });
    }

    if (rows.length === 0) return empty();
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};
