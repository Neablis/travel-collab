import { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../../registry-types";
import { chip, ghost, inlineOf } from "../../registry-types";
import { ok, empty, needsTrip, unbound, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow } from "../../select";
import { fieldAt, formatStopField } from "../../fields";

// `field` — the inline field widget (M14 field widget, build step 6; Mitchell's
// answer 4, *"inline first: a field chip inside a sentence"*). A selection of
// stops, like `cost`, and ANY published stop field read off it, where `cost`
// reads one.
//
// **Stops only, and `attribute` is left as it is.** `attribute`'s fields are
// the trip and the account: one of each, nothing to narrow, and two of its five
// are computed against things a manifest path cannot carry (`countdown` needs
// the reader's today, `budgetRemaining` is a domain rollup). Folding them in
// here would give a stop widget five filters that mean nothing for them, and
// giving `attribute` a picker would offer the same five facts its presets
// already name. What is new is a SET of items and a reader-chosen field, which
// is exactly a stop.
//
// Which stop is the filters' business and `narrow`'s, never a key of this
// widget's own (gap 4 of the 2026-09-24 review), and which field is the
// manifest's: the stored path is looked up with `fieldAt`, so an unannotated
// field such as `bookedBy` cannot be printed however the path was written
// (gap 6).

const FIELD_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
const FieldParams = filterParams(FIELD_FILTERS, {
  // A plain string, checked at RESOLVE time (`fieldAt`) and never at write
  // time, so a page naming a field this build no longer publishes still saves.
  field: z.string().optional(),
  // "Each value once" (answer 3). Meaningful for the kinds that list — text,
  // enum, place — and ignored by the ones that sum or span.
  distinct: z.boolean().optional(),
});
type FieldParams = z.infer<typeof FieldParams>;

// The field first: it is the question the widget cannot answer without, where
// every filter left alone already means "every stop".
const FIELD_INPUTS: readonly WidgetInput[] = [
  { name: "field", type: "field", label: "Field", of: "stop" },
  ...filterInputs(FIELD_FILTERS),
];

export const field: MacroDef<FieldParams, string> = {
  name: "field", title: "A detail of the stops", shape: "single",
  params: FieldParams, inputs: FIELD_INPUTS,
  selection: { entity: "stop", filters: FIELD_FILTERS },
  description:
    "Any published detail of the selected stops — name, place, notes, status, tags or cost. One stop shows its own value; several show every value, with costs added up. `distinct: true` lists a repeated value once.",
  emptyText: "no stops to show",
  preview: "one detail of a stop, like its cost or its place",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<string> => {
    if (!trip) return needsTrip();
    const choice = fieldAt("stop", params.field);
    // No kind until a field is chosen, so the ghost claims none: `———`.
    if (!choice) return unbound("field", [ghost("text", "field")]);
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const { stops } = selection.value;
    if (stops.length === 0) return empty();
    const text = formatStopField(
      choice,
      stops.map((stop) => stop.activity),
      { currency: trip.currency },
      { distinct: params.distinct },
    );
    return text === null ? empty(`no ${choice.label.toLowerCase()}`) : ok(text);
  },
  render: (value) => inlineOf(chip("value", value)),
};
