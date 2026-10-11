import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TripCommand, type TripDetail } from "@tc/contracts";
import { describeByTags, decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "@tc/domain";
import { bundleTripCommandGroups, TripImportBundle } from "@tc/fixtures";
import { presetCatalog, renderMacro, type WidgetContext } from "@tc/pages";
import { buildTripGlobals } from "./tripGlobals";

// M42 D11's four tag widgets, against a real bundled trip, here because the
// server is the one place both halves meet: `@tc/pages` draws the widgets, and
// `buildTripGlobals` hands them the description `@tc/domain` worked out.

const TRIP_ID = "11111111-1111-4111-8111-111111111111";

/** A bundled trip folded through the real deciders, as the importer would write it. */
function bundledTrip(file: string): TripDetail {
  const json = JSON.parse(readFileSync(new URL(`../../../../content/trips/${file}`, import.meta.url), "utf8"));
  const trip = TripImportBundle.parse(json).trips[0]!;
  let n = 0;
  const mintId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const groups = bundleTripCommandGroups("tag-widgets", trip, { today: "2026-10-11", tripId: TRIP_ID, mintId });
  let state: TripState | null = null;
  for (const raw of [{ type: "CreateTrip", tripId: TRIP_ID, name: trip.name }, ...groups.flat()]) {
    const decision = decideTripCommand(state, TripCommand.parse(raw), { actorId: "someone" });
    if (!decision.ok) throw new Error(`the domain refused ${raw.type}: ${decision.rejection.message}`);
    for (const event of decision.events) state = evolveTrip(state, event);
  }
  return tripDetailFromState(state!, "2026-10-11T09:00:00.000Z");
}

const contextOf = (trip: TripDetail): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user: null,
  globals: buildTripGlobals(trip),
  today: null,
});

const render = (trip: TripDetail, widget: string, params: Readonly<Record<string, unknown>>) =>
  renderMacro(contextOf(trip), widget, params);

/** The trip with Ticketed added to every activity that lacks it, or taken off every one that has it. */
function withTicketed(trip: TripDetail, on: boolean): TripDetail {
  const activities = Object.fromEntries(
    Object.entries(trip.activities).map(([id, activity]) => {
      const others = activity.tags.filter((tag) => tag !== "ticketed");
      return [id, { ...activity, tags: on ? [...others, "ticketed" as const] : others }];
    }),
  );
  return { ...trip, activities };
}

// The four, by the preset ids the picker keys on, and the primitives they sit on.
const FOUR = ["activities-by-tag", "trip-description", "tags-by-day", "hours-by-tag"];

describe("the tag widgets (M42 D11)", () => {
  const iceland = bundledTrip("iceland-ring-road.json");

  it("never count Ticketed: every preset on their primitives draws the same with it on every stop or on none", () => {
    const catalogue = presetCatalog();
    const widgets = new Set(catalogue.filter((entry) => FOUR.includes(entry.name)).map((entry) => entry.widget));
    expect(catalogue.filter((entry) => FOUR.includes(entry.name)).map((entry) => entry.name).sort()).toEqual([...FOUR].sort());
    // Every preset on those primitives, not just the four, so a fifth cannot skip the sweep.
    const swept = catalogue.filter((entry) => widgets.has(entry.widget));
    expect(swept.length).toBeGreaterThanOrEqual(FOUR.length);
    // Iceland has Ticketed stops, so taking it off is a change to the trip.
    expect(Object.values(iceland.activities).some((a) => a.tags.includes("ticketed"))).toBe(true);
    for (const entry of swept) {
      const without = render(withTicketed(iceland, false), entry.widget, entry.params);
      expect(without.status, `${entry.name} drew nothing for Iceland`).toBe("ok");
      expect(render(withTicketed(iceland, true), entry.widget, entry.params), `${entry.name} counts Ticketed`).toEqual(without);
      expect(render(iceland, entry.widget, entry.params), `${entry.name} counts Ticketed`).toEqual(without);
    }
  });

  it("Trip description says what describeByTags says over every activity, the backlog's too", () => {
    const all = Object.values(iceland.activities);
    expect(describeByTags(all)?.text).toBe("Outdoorsy");
    // The backlog is what makes the difference: from the days alone it reads otherwise.
    const scheduled = iceland.days.flatMap((day) => day.activityIds.map((id) => iceland.activities[id]!));
    expect(describeByTags(scheduled)?.text).not.toBe("Outdoorsy");

    const outcome = render(iceland, "trip.description", {});
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-description") {
      throw new Error(`expected a trip-description block, got ${JSON.stringify(outcome)}`);
    }
    expect(outcome.rendered.block.text).toBe(describeByTags(all)!.text);
  });

  it("Trip description's shares are of the stops the description counted, by hand from the Iceland bundle", () => {
    // Counted by hand from `content/trips/iceland-ring-road.json`: 51 stops,
    // 39 of them with a category other than Lodging (travel left out). Ties
    // are in contract order.
    expect(buildTripGlobals(iceland).description).toEqual({
      text: "Outdoorsy",
      counted: 39,
      tags: [
        { tag: "meal", activityCount: 18 }, { tag: "outdoors", activityCount: 16 },
        { tag: "tour", activityCount: 3 }, { tag: "wellness", activityCount: 3 },
        { tag: "drinks", activityCount: 2 }, { tag: "sight", activityCount: 2 },
        { tag: "beach", activityCount: 2 }, { tag: "shopping", activityCount: 2 },
        { tag: "museum", activityCount: 1 },
      ],
    });
    const outcome = render(iceland, "trip.description", {});
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-description") {
      throw new Error(`expected a trip-description block, got ${JSON.stringify(outcome)}`);
    }
    // 18/39, 16/39, 3/39.
    expect(outcome.rendered.block.tags.map((t) => [t.label, t.share])).toEqual([["Food", "46%"], ["Outdoors", "41%"], ["Tour", "8%"]]);
    expect(outcome.rendered.block.basis).toBe("Share of 39 tagged stops");
  });
});
