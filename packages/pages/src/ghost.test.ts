import { describe, expect, it } from "vitest";
import type { PageContext } from "@tc/contracts";
import { MACRO_NAMES, renderMacro } from "./registry";
import { ghost, text, type Seg } from "./registry-types";
import { VALUE_KIND_FORMATS } from "./kinds";

// The ghost's SHAPE (notebook-widget-framework spec, "The ghost"): what an
// unbound widget hands the renderer so Editing can print the format of the
// value that is coming. The rendering half is `MacroView.ghost.test.tsx`.

const page: PageContext = { tripId: "11111111-1111-1111-1111-111111111111" };
// No trip: the one unbound state every trip-reading resolver can reach.
const tripless = { page, user: null, globals: null, today: null };

function shapeOf(name: string, params: Record<string, unknown> = {}): readonly Seg[] {
  const outcome = renderMacro(tripless, name, params);
  if (outcome.status !== "unbound") throw new Error(`${name} resolved ${outcome.status}, not unbound`);
  return outcome.shape;
}

describe("an unbound widget's shape", () => {
  it("is a resolver's own shape when it supplies one: `cost` is money", () => {
    expect(shapeOf("cost")).toEqual([ghost("money", "cost")]);
  });

  it("keeps the words a resolver would have printed around the ghosted number", () => {
    // `count` resolves to "3 days", so its ghost is "NN days" — the noun is
    // known before anything is bound, and only the number is not.
    expect(shapeOf("count", { of: "day" })).toEqual([ghost("count", "number of days"), text(" days")]);
  });

  it("falls back to the widget's shape when the resolver supplies none", () => {
    // A repeat or block: "NN rows", in the spec's words for a ghost caption —
    // `NN` rather than a number, so the count is never mistaken for a fact.
    expect(shapeOf("day.rows")).toEqual([ghost("count", "A line for every day"), text(" rows")]);
  });

  it("gives every registered widget a shape with a ghost in it", () => {
    let witnessed = 0;
    for (const name of MACRO_NAMES) {
      const outcome = renderMacro(tripless, name, name === "attribute" ? { field: "trip.name" } : {});
      if (outcome.status !== "unbound") continue;
      witnessed += 1;
      const ghosts = outcome.shape.filter((seg) => seg.kind === "ghost");
      expect(ghosts.length, `${name}'s shape has no ghost part`).toBeGreaterThan(0);
      for (const seg of ghosts) expect(seg.label, name).not.toBe("");
    }
    // Every registered widget reads the trip, so every one of them is unbound
    // here; a floor below that means a resolver started answering something
    // else without a trip and this sweep stopped looking at it.
    expect(witnessed).toBe(MACRO_NAMES.length);
  });
});

describe("the date ghost", () => {
  // kinds.ts reconciles the spec's `Ddd Mmm N` toward what `formatDate`
  // prints ("Aug 1, 2026"): a ghost must be the shape of the value that will
  // replace it, and that formatter prints no weekday.
  it("has formatDate's shape", () => {
    const shape = (s: string) => s.replace(/[A-Za-z0-9]+/g, "a");
    expect(shape(VALUE_KIND_FORMATS.date.ghost)).toBe(shape(VALUE_KIND_FORMATS.date.format("2026-08-01", { currency: "USD" })));
  });
});
