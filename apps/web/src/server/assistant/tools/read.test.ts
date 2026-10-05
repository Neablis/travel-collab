import { describe, expect, it } from "vitest";
import { rollupCosts } from "@tc/domain";
import { tripDetailFactory } from "@tc/factories";
import { readDay, readDayTool, readTrip, readTripTool, searchPlaybooksTool } from "./read";

// ADR-060: a price is for one person. The read tools hand the model money, so
// they say so too — a "total cost" read as a group total would be priced
// again by however many people the model thinks are going.
describe("read tools describe money per person", () => {
  it.each([
    ["read_day", readDayTool.description],
    ["search_playbooks", searchPlaybooksTool.description],
  ])("%s says its cost is for one person", (_name, description) => {
    expect(description).toMatch(/for one person/);
  });
});

// Travellers spec §5 (invariant 7): a total prices a stop nobody picked for the
// travellers, so the model is told how many that is — or it would divide the
// total by every member and hand an adviser a share of the hotel.
describe("read_trip says who the totals are for", () => {
  it("reports the travellers alongside the members", () => {
    const trip = tripDetailFactory.build({
      members: [
        { userId: "u1", role: "owner" },
        { userId: "u2", role: "editor" },
        { userId: "u3", role: "suggester", travelling: false },
      ],
    });
    expect(readTrip(trip)).toMatchObject({ members: 3, travellers: 2 });
  });

  it("read_day says a stop nobody picked is priced for the travellers", () => {
    expect(readDayTool.description).toMatch(/travellers/);
  });

  // D5: with nobody travelling the totals still price one person, and
  // `travellers: 0` alone reads as "free" or as a division by zero.
  it("read_trip says who travels, that a member may not, and the one-person floor", () => {
    expect(readTripTool.description).toMatch(/travellers/);
    expect(readTripTool.description).toMatch(/not travelling/);
    expect(readTripTool.description).toMatch(/at least one person/);
  });
});

// The headcount rides on the stop so the model reads the multiplier the totals
// used rather than rebuilding it as `cost × travellers` — wrong for any stop
// with picks, and wrong twice when a pick is not travelling (D6: it counts).
describe("read_day reports the headcount each stop is priced for", () => {
  const trip = tripDetailFactory.build(
    {
      members: [
        { userId: "u1", role: "owner" },
        { userId: "u2", role: "editor" },
        { userId: "u3", role: "editor" },
        { userId: "u4", role: "suggester", travelling: false },
      ],
    },
    { transient: { dayCount: 1, activitiesPerDay: 2, costed: true } },
  );
  const [pickedId, nobodyId] = trip.days[0]!.activityIds;
  trip.activities[pickedId!]!.participants = ["u1", "u4"];
  // The factory rolled up before the pick existed; roll up again so
  // `costSubtotal` is what the projection would hold for this trip.
  trip.days[0]!.costSubtotal = rollupCosts(trip, 3).dayCostSubtotals[0]!;
  const day = readDay(trip, 1);
  if ("error" in day) throw new Error(day.error);

  it("counts the picks, a picked non-traveller included, and every traveller when nobody is picked", () => {
    expect(trip.activities[nobodyId!]!.participants).toEqual([]);
    expect(day.stops.map((stop) => stop.headcount)).toEqual([2, 3]);
  });

  it("is the multiplier the day's costSubtotal used", () => {
    const sum = day.stops.reduce((total, stop) => total + stop.cost!.amountMinor * stop.headcount!, 0);
    expect(sum).toBe(day.costSubtotal);
  });

  it("read_day tells the model to read the totals rather than recompute them", () => {
    expect(readDayTool.description).toMatch(/headcount/);
    expect(readDayTool.description).toMatch(/costSubtotal/);
  });
});
