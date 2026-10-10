import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { rollupCosts } from "@tc/domain";
import { tripDetailFactory } from "@tc/factories";
import { newDayReadBudget, type AssistantDeps } from "@/server/assistant/deps";
import { MAX_DAYS_READ_PER_TURN } from "@/server/assistant/limits";
import { untrusted } from "@/server/assistant/prompt";
import {
  OVERVIEW_ABOVE_DAYS,
  findDays,
  readDay,
  readDayTool,
  readTrip,
  readTripForModel,
  readTripTool,
  searchPlaybooksTool,
  type DayReadout,
  type ReadToolProblem,
  type TripOverviewReadout,
} from "./read";

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

/**
 * A trip whose day N's stops are in the cities `days[N - 1]` names, in time
 * order (the factory's hourly ladder) — `[]` is an empty day. Rolled up again
 * after the edit, so every subtotal is what the projection would hold.
 */
function tripThrough(days: readonly (readonly string[])[]): TripDetail {
  const trip = tripDetailFactory.build(
    {},
    { transient: { dayCount: days.length, activitiesPerDay: 3, located: true, costed: true, startDate: "2027-04-01" } },
  );
  trip.days = trip.days.map((day, index) => {
    const cities = days[index]!;
    day.activityIds.forEach((id, i) => {
      const city = cities[i];
      if (city !== undefined) trip.activities[id] = { ...trip.activities[id]!, location: { name: `${city} stop`, city, lat: 35, lng: 139 } };
      else delete trip.activities[id];
    });
    return { ...day, activityIds: day.activityIds.slice(0, cities.length) };
  });
  const { dayCostSubtotals, tripCostTotal } = rollupCosts(trip, 1);
  trip.days = trip.days.map((day, i) => ({ ...day, costSubtotal: dayCostSubtotals[i] ?? 0 }));
  trip.tripCostTotal = tripCostTotal;
  return trip;
}

const repeat = <T,>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

// 22 days, past the line: Tokyo, a travel day to Kyoto, Kyoto with a Nara day
// trip that comes back for dinner, an empty day, and Tokyo again.
const LONG = tripThrough([
  ...repeat(5, ["Tokyo", "Tokyo"]), // 1-5
  ["Tokyo", "Kyoto"], // 6: travel day
  ...repeat(3, ["Kyoto"]), // 7-9
  ["Kyoto", "Nara", "Kyoto"], // 10: day trip
  ...repeat(2, ["Kyoto"]), // 11-12
  [], // 13: empty
  ...repeat(9, ["Tokyo"]), // 14-22: a repeat visit
]);

describe("read_trip on a long trip", () => {
  // The line itself, from both sides: at OVERVIEW_ABOVE_DAYS the model gets
  // exactly what it always got, one day past it the overview.
  it("is the per-day readout, byte for byte, up to the line, and the overview past it", () => {
    const atLine = tripThrough(repeat(OVERVIEW_ABOVE_DAYS, ["Tokyo"]));
    expect(JSON.stringify(readTripForModel(atLine))).toBe(JSON.stringify(readTrip(atLine)));
    const past = readTripForModel(tripThrough(repeat(OVERVIEW_ABOVE_DAYS + 1, ["Tokyo"])));
    expect(past).not.toHaveProperty("days");
    expect(past).toHaveProperty("segments");
  });

  // The travel-day rule, and the reason it is the rule: a day sits in the city
  // it ENDS in, so a travel day opens the next city, a day trip that comes
  // back does not split the stay, and a repeat visit is its own segment.
  it("cuts the trip into runs of days by the city each day ends in", () => {
    const overview = readTripForModel(LONG) as TripOverviewReadout;
    expect(overview.segments.map(({ days, city, alsoTouches }) => ({ days, city, alsoTouches }))).toEqual([
      { days: "1–5", city: "Tokyo", alsoTouches: [] },
      { days: "6–12", city: "Kyoto", alsoTouches: ["Tokyo", "Nara"] },
      { days: "13", city: null, alsoTouches: [] },
      { days: "14–22", city: "Tokyo", alsoTouches: [] },
    ]);
    expect(overview.emptyDays).toBe("13");
  });

  // One segment per day is what makes the sums honest: a travel day counted in
  // both cities would make the segments add up to more than the trip.
  it("puts every day in exactly one segment, so the segments add up to the trip", () => {
    const overview = readTripForModel(LONG) as TripOverviewReadout;
    const sum = (field: "stops" | "costSubtotal") => overview.segments.reduce((total, s) => total + s[field], 0);
    expect(sum("stops")).toBe(overview.stopCount);
    expect(overview.stopCount).toBe(LONG.days.reduce((n, day) => n + day.activityIds.length, 0));
    expect(sum("costSubtotal")).toBe(LONG.tripCostTotal);
  });

  it("tells the model where to go next, in a field nobody can type into", () => {
    const overview = readTripForModel(LONG) as TripOverviewReadout;
    expect(overview.overview).toMatch(/find_days/);
    expect(overview.overview).toMatch(/read_day/);
    expect(readTripTool.description).toMatch(/find_days/);
  });
});

describe("find_days", () => {
  it("names the days that touch a city, a travel day included, however read_trip fenced it", () => {
    expect(findDays(LONG, { city: "Kyoto" })).toEqual({ count: 7, days: [6, 7, 8, 9, 10, 11, 12] });
    expect(findDays(LONG, { city: untrusted("nara") })).toEqual({ count: 1, days: [10] });
  });

  it("ANDs its filters", () => {
    expect(findDays(LONG, { city: "Tokyo", fromDay: 6, toDay: 15 })).toEqual({ count: 3, days: [6, 14, 15] });
    expect(findDays(LONG, { empty: true })).toEqual({ count: 1, days: [13] });
    expect(findDays(LONG, { empty: false, fromDay: 12, toDay: 14 }).days).toEqual([12, 14]);
  });

  it("filters on what a day's stops still need: a tag, a booking, a conflict", () => {
    const trip = structuredClone(LONG);
    const [onDay3] = trip.days[2]!.activityIds;
    const [onDay8] = trip.days[7]!.activityIds;
    trip.activities[onDay3!] = { ...trip.activities[onDay3!]!, tags: ["meal"] };
    trip.activities[onDay8!] = { ...trip.activities[onDay8!]!, kind: "pending", pendingReason: "book" };
    trip.conflicts = [
      { id: "c1", kind: "time-overlap", severity: "warn", subjects: [onDay8!], description: "clash", resolutions: [] },
    ];
    expect(findDays(trip, { tag: "meal" }).days).toEqual([3]);
    expect(findDays(trip, { toBook: true }).days).toEqual([8]);
    expect(findDays(trip, { hasConflicts: true }).days).toEqual([8]);
  });

  it("reads a date range off the days' own dates", () => {
    const trip = structuredClone(LONG);
    trip.days = trip.days.map((day, i) => ({ ...day, date: `2027-05-${String(i + 1).padStart(2, "0")}` }));
    expect(findDays(trip, { fromDate: "2027-05-20", toDate: "2027-05-21" }).days).toEqual([20, 21]);
  });
});

describe("the per-turn read cap", () => {
  const trip = tripThrough(repeat(30, ["Tokyo"]));
  const read = (budget: ReturnType<typeof newDayReadBudget>, days: number | number[]) =>
    readDayTool.invoke({ days }, { trip, scope: { kind: "trip" }, readBudget: budget } as unknown as AssistantDeps);

  // Fifteen distinct days across the turn's calls, and then a refusal the
  // model can act on — a RESULT, never a throw, so the turn carries on.
  it("reads fifteen distinct days across calls, then refuses the next one by name", async () => {
    const budget = newDayReadBudget(MAX_DAYS_READ_PER_TURN);
    for (const batch of [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]) {
      const { days } = (await read(budget, batch)) as { days: (DayReadout | ReadToolProblem)[] };
      expect(days.every((entry) => !("error" in entry))).toBe(true);
    }
    const refused = (await read(budget, 16)) as ReadToolProblem;
    expect(refused.error).toMatch(/Day 16 was not read/);
    expect(refused.error).toMatch(/find_days/);
  });

  // A day already read is already in the history: reading it again costs the
  // turn nothing new, and neither does a day that does not exist.
  it("does not count a day twice, or a day out of range at all", async () => {
    const budget = newDayReadBudget(2);
    const outcomes = async (days: number[]) =>
      ((await read(budget, days)) as { days: (DayReadout | ReadToolProblem)[] }).days.map((entry) =>
        "error" in entry ? entry.error.slice(0, 18) : entry.day,
      );
    // Day 99 is out of range: refused for that, and not charged.
    expect(await outcomes([1, 99])).toEqual([1, "This trip has 30 d"]);
    expect(await outcomes([2, 3])).toEqual([2, "Day 3 was not read"]);
    // At the cap, the days already read still come back.
    expect(await outcomes([1, 2])).toEqual([1, 2]);
    expect(budget.read()).toBe(2);
  });
});
