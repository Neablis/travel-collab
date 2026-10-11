import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMacro, type BlockPayload } from "@tc/pages";
import type { ActivityTag, TimeWindow, TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { TagBreakdownBlock } from "./TagBreakdownBlock";
import { TagsByDayBlock } from "./TagsByDayBlock";
import { TripDescriptionBlock } from "./TripDescriptionBlock";

// What a reader takes from the three tag blocks (M42 D11): the words and
// numbers each puts on screen or in its table. The counting is the resolvers'
// (`tagCharts.test.ts`); that every colour is a token is `ui/chart.test.tsx`'s.

// Loaded here so a lazy picture is drawn by React, not waiting on a cold transform.
beforeAll(async () => {
  await import("./TagCharts");
});

/** Two dated days of two stops, each untagged and untimed until `set` says otherwise. */
function tripOf(): TripDetail {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2 } });
  trip.days = trip.days.map((day, i) => ({ ...day, date: `2026-08-0${i + 1}` }));
  for (const id of Object.keys(trip.activities)) {
    trip.activities[id] = { ...trip.activities[id]!, kind: "planned", tags: [], timeWindow: null };
  }
  return trip;
}

function set(trip: TripDetail, day: number, slot: number, tags: ActivityTag[], timeWindow: TimeWindow | null = null) {
  const id = trip.days[day]!.activityIds[slot]!;
  trip.activities[id] = { ...trip.activities[id]!, tags, timeWindow };
}

function payloadOf<K extends BlockPayload["kind"]>(
  trip: TripDetail, name: string, params: Record<string, unknown>, kind: K, globals: TripGlobals | null = null,
): Extract<BlockPayload, { kind: K }> {
  const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals, today: null }, name, params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== kind) {
    throw new Error(`expected a ${kind} block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block as Extract<BlockPayload, { kind: K }>;
}

describe("TagBreakdownBlock", () => {
  it("keys each tag that carries time with its hours and share, then the total, and names the untimed stops", () => {
    const trip = tripOf();
    set(trip, 0, 0, ["meal"], { start: "12:00", end: "13:00" });
    set(trip, 0, 1, ["outdoors"], { start: "09:00", end: "12:00" });
    set(trip, 1, 0, ["museum"]);
    render(<TagBreakdownBlock payload={payloadOf(trip, "tag.breakdown", { measure: "hours" }, "tag-breakdown")} />);

    const rows = within(screen.getByRole("table", { name: "Hours by tag" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(["Food1h25%", "Outdoors3h75%", "Total4h"]);
    expect(screen.getByText("Not charted: 2 stops with no time.")).toBeDefined();
  });
});

describe("TagsByDayBlock", () => {
  it("puts every day's stops and tags in the table a screen reader gets", () => {
    const trip = tripOf();
    set(trip, 0, 0, ["meal"]);
    set(trip, 0, 1, ["meal"]);
    set(trip, 1, 0, ["beach"]);
    render(<TagsByDayBlock payload={payloadOf(trip, "tag.byDay", {}, "tags-by-day")} />);

    const rows = within(screen.getByRole("table", { name: "Tags by day" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["Aug 1, 2026", "2", "Food 2"],
      ["Aug 2, 2026", "2", "Beach 1, Untagged 1"],
    ]);
  });
});

describe("TripDescriptionBlock", () => {
  it("shows the description, and each top tag as a chip with its share", () => {
    const globals: TripGlobals = {
      days: [], cities: [], tags: [], homeTimeZone: null,
      description: { text: "Beach & outdoors", counted: 8, tags: [{ tag: "beach", activityCount: 5 }, { tag: "outdoors", activityCount: 4 }] },
    };
    render(<TripDescriptionBlock payload={payloadOf(tripOf(), "trip.description", {}, "trip-description", globals)} />);

    expect(screen.getByText("Beach & outdoors")).toBeDefined();
    const chips = within(screen.getByRole("list", { name: "Share of 8 tagged stops" })).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Beach63%", "Outdoors50%"]);
  });
});
