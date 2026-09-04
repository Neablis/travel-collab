import { describe, expect, it } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import { selectionTrip } from "../../test-support/selectionTrip";
import { formatMoney } from "../../format";

// The `single` primitives, and the claim that matters most about them: ADR-039
// opens by naming four pairs of widgets that are *"the same widget written
// twice"*, so three of these tests assert the primitive's output is **identical
// to the named widget's**, not merely similar. That is what makes the migration
// in spec §8 step 3 a rename rather than a behaviour change.

const contextOf = ({ trip, globals }: ReturnType<typeof selectionTrip>): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user: null,
  globals,
});

describe("cost", () => {
  it("is the trip's total when nothing is filtered — `cost.trip` exactly", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    expect(renderMacro(ctx, "cost", {})).toEqual(renderMacro(ctx, "cost.trip", {}));
    expect(renderMacro(ctx, "cost", {})).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: formatMoney(fixture.trip.tripCostTotal, "USD") }] },
    });
  });

  it("is one day's subtotal when a day is filtered — `cost.day` exactly", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    for (const index of [0, 1]) {
      expect(
        renderMacro(ctx, "cost", { day: { kind: "index", index } }),
        `day ${index + 1}`,
      ).toEqual(renderMacro(ctx, "cost.day", { dayRef: { kind: "index", index } }));
    }
  });

  it("sums what a tag or a kind leaves, which no named widget could", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    const booked = fixture.trip.activities[fixture.ids.s0]!.cost!.amountMinor
      + fixture.trip.activities[fixture.ids.s3]!.cost!.amountMinor;
    expect(renderMacro(ctx, "cost", { kind: "booked" })).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: formatMoney(booked, "USD") }] },
    });
  });

  it("says there are no costs rather than printing a formatted zero", () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 1, costed: false } });
    const ctx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals: null };
    expect(renderMacro(ctx, "cost", {}).status).toBe("empty");
  });

  it("needs a trip, and needs a person field", () => {
    const { globals } = selectionTrip();
    const noTrip: WidgetContext = { page: { tripId: "11111111-1111-1111-1111-111111111111" }, user: null, globals };
    expect(renderMacro(noTrip, "cost", {})).toEqual({ status: "unbound", needs: "trip" });
    const fixture = selectionTrip();
    expect(renderMacro(contextOf(fixture), "cost", { person: "dev-alice" })).toEqual({
      status: "unbound",
      needs: "person",
    });
  });
});

describe("count", () => {
  it("counts stops, days or cities from one primitive", () => {
    const ctx = contextOf(selectionTrip());
    const textOf = (params: Record<string, unknown>) => {
      const outcome = renderMacro(ctx, "count", params);
      if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") throw new Error(`not ok: ${outcome.status}`);
      return outcome.rendered.segs.map((s) => s.text).join("");
    };
    expect(textOf({})).toBe("7 stops");
    expect(textOf({ of: "day" })).toBe("3 days");
    expect(textOf({ of: "city" })).toBe("2 cities");
    expect(textOf({ kind: "booked" })).toBe("2 stops");
    expect(textOf({ day: { kind: "index", index: 0 } })).toBe("2 stops");
    // Singular, because "1 stops" is the kind of thing a reader notices instead
    // of the number.
    expect(textOf({ tag: "meal" })).toBe("1 stop");
  });

  it("answers zero rather than going empty", () => {
    // The one primitive with no `empty()` against a loaded trip. "0 booked" is
    // exactly what somebody asks a notebook, and `emptyText` would replace the
    // fact with a shrug — unlike `cost`, where a zero total means nothing has
    // been priced at all.
    const ctx = contextOf(selectionTrip());
    const outcome = renderMacro(ctx, "count", { tag: "ticketed", kind: "idea" });
    expect(outcome.status).toBe("ok");
    expect(outcome.status === "ok" && outcome.rendered.kind === "inline" && outcome.rendered.segs[0]!.text).toBe(
      "0 stops",
    );
  });
});

describe("dates", () => {
  it("is the trip's range wide, and one day's date when a day is filtered", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    // `day.date` exactly, for a filtered day.
    expect(renderMacro(ctx, "dates", { day: { kind: "index", index: 1 } })).toEqual(
      renderMacro(ctx, "day.date", { dayRef: { kind: "index", index: 1 } }),
    );
    // Wide, it spans the dated days — day 3 has no date, so the range ends at
    // day 2 rather than at an em dash presented as a date.
    const wide = renderMacro(ctx, "dates", {});
    expect(wide.status === "ok" && wide.rendered.kind === "inline" && wide.rendered.segs[0]!.text).toBe(
      "Jun 1, 2027 – Jun 2, 2027",
    );
  });

  it("collapses to a single date when the selection leaves one dated day", () => {
    const ctx = contextOf(selectionTrip());
    const one = renderMacro(ctx, "dates", { dates: { from: "2027-06-02", through: "2027-06-30" } });
    expect(one.status === "ok" && one.rendered.kind === "inline" && one.rendered.segs[0]!.text).toBe("Jun 2, 2027");
  });

  it("is empty when no selected day has a date", () => {
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "dates", { day: { kind: "index", index: 2 } }).status).toBe("empty");
  });
});

describe("hours", () => {
  it("is the extremes of the times, not the first and last stop in the column", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    // Day 2's train runs 06:00–14:00 and day 1's stops sit inside 09:00–13:00,
    // so the trip's window is the train's start and end. A widget reading the
    // first and last stop of the list would answer 09:00 – 13:00.
    const wide = renderMacro(ctx, "hours", {});
    expect(wide.status === "ok" && wide.rendered.kind === "inline" && wide.rendered.segs[0]!.text).toBe("06:00 – 14:00");
    // `day.window` exactly, for a filtered day.
    expect(renderMacro(ctx, "hours", { day: { kind: "index", index: 0 } })).toEqual(
      renderMacro(ctx, "day.window", { dayRef: { kind: "index", index: 0 } }),
    );
  });

  it("is empty when nothing selected carries a time", () => {
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "hours", { day: { kind: "index", index: 2 } }).status).toBe("empty");
  });
});

describe("city", () => {
  it("is one chip per city, in arrival order — `day.city` exactly when filtered", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    expect(renderMacro(ctx, "city", { day: { kind: "index", index: 1 } })).toEqual(
      renderMacro(ctx, "day.city", { dayRef: { kind: "index", index: 1 } }),
    );
    // Wide: every city the trip touches. One chip each rather than one joined
    // string, because each carries the trip's own colour and one string can only
    // wear one.
    expect(renderMacro(ctx, "city", {})).toEqual({
      status: "ok",
      rendered: {
        kind: "inline",
        segs: [
          { kind: "chip", name: "city", text: "Rome" },
          { kind: "text", text: " – " },
          { kind: "chip", name: "city", text: "Kyoto" },
        ],
      },
    });
  });

  it("is empty for a day that touches no city", () => {
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "city", { day: { kind: "index", index: 2 } }).status).toBe("empty");
  });
});
