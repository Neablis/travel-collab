import { z } from "zod";
import { unbound, ok } from "../result";
import { chip, ghost, inlineOf, text, type MacroDef } from "../registry-types";

// A two-part widget, for tests only: the framework spec's own example,
// *"We were at Kichi Kichi in Pontochō — $XXX."*, with each part waiting on its
// own param. No registered widget binds two parts independently yet, and per-
// part fill has to be provable before one does — a renderer that ghosted the
// whole widget whenever ANY part was missing would pass every test built on a
// one-part widget.
const Params = z.object({ place: z.string().optional(), cost: z.string().optional() });
type Params = z.infer<typeof Params>;

export const ghostProbe: MacroDef<Params, { place: string; cost: string }> = {
  name: "test.ghostProbe",
  title: "Ghost probe",
  shape: "single",
  params: Params,
  inputs: [],
  description: "Test-only: a sentence whose place and cost bind separately.",
  emptyText: "nothing",
  preview: "We were at a place — a cost.",
  resolve: (_ctx, { place, cost }) => {
    if (place !== undefined && cost !== undefined) return ok({ place, cost });
    return unbound("field", [
      text("We were at "),
      place === undefined ? ghost("text", "place") : chip("value", place),
      text(" — "),
      cost === undefined ? ghost("money", "cost") : chip("value", cost),
      text("."),
    ]);
  },
  render: ({ place, cost }) => inlineOf(text("We were at "), chip("value", place), text(" — "), chip("value", cost), text(".")),
};
