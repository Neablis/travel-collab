import { describe, expect, it } from "vitest";
import type { ActivityKind, ActivityTag, TimeWindow, TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { BlockPayload, WidgetContext } from "../../registry-types";

// The tag widgets' own rules (M42 D11). That none of them counts Ticketed, and
// that "Trip description" says what `describeByTags` says, are held against a
// real bundled trip in `apps/web/src/server/tagWidgets.test.ts`, where the
// server's description is built.

const contextOf = (trip: TripDetail, globals: TripGlobals | null = null): WidgetContext => ({
  trip, page: { tripId: trip.tripId }, user: null, globals, today: null,
});

/** Two dated days of three stops and one parked stop, every one untagged, planned and untimed. */
function tripOf(): TripDetail {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 3, unscheduledCount: 1 } });
  trip.days = trip.days.map((day, i) => ({ ...day, date: `2026-08-0${i + 1}` }));
  for (const id of Object.keys(trip.activities)) {
    trip.activities[id] = { ...trip.activities[id]!, kind: "planned", tags: [], timeWindow: null };
  }
  return trip;
}

/** Set stop `slot` of day `day` (the backlog when `day` is null). */
function stop(trip: TripDetail, day: number | null, slot: number, tags: ActivityTag[], extra: { kind?: ActivityKind; timeWindow?: TimeWindow } = {}) {
  const id = day === null ? trip.backlog[slot]! : trip.days[day]!.activityIds[slot]!;
  trip.activities[id] = { ...trip.activities[id]!, tags, ...extra };
}

function block<K extends BlockPayload["kind"]>(ctx: WidgetContext, name: string, params: Record<string, unknown>, kind: K) {
  const outcome = renderMacro(ctx, name, params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== kind) {
    throw new Error(`expected a ${kind} block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block as Extract<BlockPayload, { kind: K }>;
}

const rows = (slices: readonly { key: string; text: string | null; share: string | null }[]) =>
  slices.filter((s) => s.text !== null).map((s) => [s.key, s.text, s.share]);

describe("Activities by tag", () => {
  it("files each stop once under its first category, a Ticketed-only one as Untagged, and leaves travel out", () => {
    const trip = tripOf();
    stop(trip, 0, 0, ["meal", "drinks"]);
    stop(trip, 0, 1, ["ticketed", "museum"]);
    stop(trip, 0, 2, ["ticketed"]);
    stop(trip, 1, 0, ["outdoors"], { kind: "transit" });
    stop(trip, null, 0, ["museum"]);
    const pie = block(contextOf(trip), "tag.breakdown", { measure: "count" }, "tag-breakdown");
    expect(rows(pie.slices)).toEqual([
      ["meal", "1 stop", "17%"],
      ["museum", "2 stops", "33%"],
      ["untagged", "3 stops", "50%"],
    ]);
    expect(pie.total).toBe("6 stops");
    expect(pie.view).toBe("pie");
  });
});

describe("Hours by tag", () => {
  it("adds up each tag's timed stops, and names the untimed ones it left out", () => {
    const trip = tripOf();
    stop(trip, 0, 0, ["meal"], { timeWindow: { start: "12:00", end: "13:30" } });
    stop(trip, 0, 1, ["outdoors"], { timeWindow: { start: "09:00", end: "12:00" } });
    stop(trip, 1, 0, ["outdoors"], { timeWindow: { start: "14:00", end: "14:45" } });
    const bars = block(contextOf(trip), "tag.breakdown", { measure: "hours", view: "bars" }, "tag-breakdown");
    expect(rows(bars.slices)).toEqual([
      ["meal", "1h 30m", "29%"],
      ["outdoors", "3h 45m", "71%"],
    ]);
    expect(bars.notCharted).toBe("Not charted: 4 stops with no time.");
    expect(bars.view).toBe("bars");
  });
});

describe("Tags by day", () => {
  it("stacks each day's stops by tag, and names the unscheduled ones", () => {
    const trip = tripOf();
    stop(trip, 0, 0, ["meal"]);
    stop(trip, 0, 1, ["meal"]);
    stop(trip, 1, 0, ["beach"]);
    stop(trip, 1, 1, ["beach"], { kind: "transit" });
    const chart = block(contextOf(trip), "tag.byDay", {}, "tags-by-day");
    expect(chart.days.map((d) => [d.label, d.total, d.breakdown])).toEqual([
      ["Day 1", 3, "Food 2, Untagged 1"],
      ["Day 2", 2, "Beach 1, Untagged 1"],
    ]);
    expect(chart.series.map((s) => s.key)).toEqual(["meal", "beach", "untagged"]);
    expect(chart.notCharted).toBe("Not charted: 1 stop not on a day yet.");
  });
});

describe("Trip description", () => {
  const globals = (description: TripGlobals["description"]): TripGlobals => ({
    days: [], cities: [], tags: [], description, homeTimeZone: null,
  });

  it("shows the server's words and its top three tags, each as a share of the stops counted", () => {
    const trip = tripOf();
    const out = block(
      contextOf(trip, globals({
        text: "Beach & outdoors",
        counted: 8,
        tags: [
          { tag: "beach", activityCount: 5 }, { tag: "outdoors", activityCount: 4 },
          { tag: "meal", activityCount: 3 }, { tag: "drinks", activityCount: 1 },
        ],
      })),
      "trip.description", {}, "trip-description",
    );
    expect(out.text).toBe("Beach & outdoors");
    expect(out.tags.map((t) => [t.label, t.share])).toEqual([["Beach", "63%"], ["Outdoors", "50%"], ["Food", "38%"]]);
    expect(out.basis).toBe("Share of 8 tagged stops");
  });

  it("has nothing to say when the server has no description", () => {
    expect(renderMacro(contextOf(tripOf(), globals(null)), "trip.description", {}).status).toBe("empty");
  });
});
