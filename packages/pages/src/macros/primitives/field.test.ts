import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import { selectionTrip } from "../../test-support/selectionTrip";
import { formatMoney } from "../../format";

// `field` — the inline field widget (M14 field widget, build step 6). The
// selection is `narrow`'s, the field is the manifest's, and the printing is
// `kinds.ts`'s; what is tested here is that the three are joined, and that the
// join goes through the manifest rather than around it.

const contextOf = ({ trip, globals }: ReturnType<typeof selectionTrip>): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user: null,
  globals,
  today: null,
});

// The one chip an inline widget renders, or the outcome it gave instead.
function valueOf(ctx: WidgetContext, params: Record<string, unknown>): string | ReturnType<typeof renderMacro> {
  const outcome = renderMacro(ctx, "field", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") return outcome;
  return outcome.rendered.segs.map((seg) => seg.text).join("");
}

describe("field", () => {
  it("asks for a field when none is chosen", () => {
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "field", {})).toEqual({ status: "unbound", needs: "field" });
  });

  it("cannot reach a stop field the manifest does not publish, however the path is spelled", () => {
    // Gap 6 of the 2026-09-24 review: `bookedBy` holds a user id and is not
    // annotated, so a resolver indexing the stop by the stored string would
    // print it into a shared page. Set on every stop here so that a raw read
    // WOULD find something.
    const fixture = selectionTrip();
    for (const activity of Object.values(fixture.trip.activities)) activity.bookedBy = "user-secret-id";
    const ctx = contextOf(fixture);
    for (const field of ["stop.bookedBy", "stop.participants", "stop.timeWindow", "stop.nope", "trip.name", "bookedBy"]) {
      expect(renderMacro(ctx, "field", { field }), field).toEqual({ status: "unbound", needs: "field" });
    }
  });

  it("prints one stop's value by its kind", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    const colosseum = fixture.trip.activities[fixture.ids.s0]!;
    // `tag: ticketed` narrows to the Colosseum alone.
    const one = { tag: "ticketed" };
    expect(valueOf(ctx, { ...one, field: "stop.cost" })).toBe(
      formatMoney(colosseum.cost!.amountMinor, colosseum.cost!.currency),
    );
    expect(valueOf(ctx, { ...one, field: "stop.location" })).toBe("Colosseum, Rome, Italy");
    expect(valueOf(ctx, { ...one, field: "stop.kind" })).toBe("booked");
    expect(valueOf(ctx, { ...one, field: "stop.tags" })).toBe("ticketed");
    expect(valueOf(ctx, { ...one, field: "stop.title" })).toBe("Colosseum");
  });

  it("adds up money across several stops — the trip's own total when nothing is filtered", () => {
    const fixture = selectionTrip();
    // The factory's rollup, not a sum done here: backlog included, as `cost`'s is.
    expect(valueOf(contextOf(fixture), { field: "stop.cost" })).toBe(formatMoney(fixture.trip.tripCostTotal, "USD"));
  });

  it("lists every value across several stops, and each once when asked for distinct", () => {
    const ctx = contextOf(selectionTrip());
    // Board order: day 1, day 2, day 3, then the backlog.
    expect(valueOf(ctx, { field: "stop.kind" })).toBe("booked, planned, transit, booked, planned, idea, idea");
    expect(valueOf(ctx, { field: "stop.kind", distinct: true })).toBe("booked, planned, transit, idea");
    // A list field is its elements, across stops.
    expect(valueOf(ctx, { field: "stop.tags", day: { kind: "index", index: 0 } })).toBe("ticketed, meal");
  });

  it("is empty when the filters leave no stop, and says so when no stop has the value", () => {
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "field", { field: "stop.cost", tag: "meal", kind: "booked" })).toEqual({ status: "empty" });
    // Day 3's two stops are both unlocated.
    expect(renderMacro(ctx, "field", { field: "stop.location", day: { kind: "index", index: 2 } })).toEqual({
      status: "empty",
      because: "no place",
    });
  });

  it("needs a trip", () => {
    const { globals } = selectionTrip();
    const ctx: WidgetContext = { page: { tripId: "t" }, user: null, globals, today: null };
    expect(renderMacro(ctx, "field", { field: "stop.cost" })).toEqual({ status: "unbound", needs: "trip" });
  });
});
