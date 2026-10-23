import { describe, expect, it, vi } from "vitest";
import type { ActivityView, BatchableCommand, TripDetail } from "@tc/contracts";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import { changeLine } from "./changeLine";

// The writes `announceChange` makes; `changeLine` itself is pure.
vi.mock("./messages", () => ({ postSystemLine: vi.fn() }));
vi.mock("../access/members", () => ({ collaboratorsEntitled: vi.fn() }));

// What a change line says (M52 decision 17), over trips built by hand: four
// dated days, at noon UTC on the second, so day 2 is today and day 3 tomorrow.
const AT = Date.UTC(2027, 4, 2, 12);
const tripId = uuidFrom(1, 52);
const DAY = [1, 2, 3, 4].map((n) => uuidFrom(10 + n, 52));
const LUNCH = uuidFrom(21, 52); // today
const TEMPLE = uuidFrom(22, 52); // tomorrow
const MARKET = uuidFrom(23, 52); // day 4, after tomorrow
const stop = (activityId: string, title: string, start = "12:00"): ActivityView =>
  activityFactory.build({ activityId, title, timeWindow: { start, end: "23:00" }, cost: null });

function trip(placed: Record<string, string[]>, activities: ActivityView[], days = DAY): TripDetail {
  return tripDetailFixture({
    tripId,
    startDate: "2027-05-01",
    days: days.map((dayId) => ({ dayId, activityIds: placed[dayId] ?? [], date: `2027-05-0${DAY.indexOf(dayId) + 1}`, costSubtotal: 0 })),
    activities: Object.fromEntries(activities.map((a) => [a.activityId, a])),
  });
}
const before = trip({ [DAY[1]!]: [LUNCH], [DAY[2]!]: [TEMPLE], [DAY[3]!]: [MARKET] }, [stop(LUNCH, "Lunch"), stop(TEMPLE, "Temple"), stop(MARKET, "Market")]);

describe("changeLine", () => {
  // Stored, and read the next morning "tomorrow" would name the wrong day.
  it("says a day by its number, never as today or tomorrow", () => {
    const after = trip({ [DAY[2]!]: [LUNCH, TEMPLE], [DAY[3]!]: [MARKET] }, [stop(LUNCH, "Lunch"), stop(TEMPLE, "Temple"), stop(MARKET, "Market")]);
    const move: BatchableCommand[] = [{ type: "MoveActivity", tripId, activityId: LUNCH, toDayId: DAY[2]!, position: 0 }];
    expect(changeLine(move, before, after, AT)).toEqual({ words: "moved “Lunch” to day 3", link: { kind: "stop", id: LUNCH } });
  });

  // Fresh review of PR 535: today is read from before the change as well, or
  // removing today's day finds its stops on no day ahead.
  it("announces removing today's day", () => {
    const after = trip({ [DAY[2]!]: [TEMPLE], [DAY[3]!]: [MARKET] }, [stop(LUNCH, "Lunch"), stop(TEMPLE, "Temple"), stop(MARKET, "Market")], [DAY[0]!, DAY[2]!, DAY[3]!]);
    expect(changeLine([{ type: "RemoveDay", tripId, dayId: DAY[1]! }], before, after, AT)?.words).toBe("moved “Lunch” to the backlog");
  });

  it("says the first stop and counts the others on today or tomorrow, and not one after tomorrow", () => {
    const BAR = uuidFrom(24, 52);
    const after = trip(
      { [DAY[1]!]: [LUNCH], [DAY[2]!]: [TEMPLE, BAR], [DAY[3]!]: [MARKET] },
      [stop(LUNCH, "Lunch", "13:00"), stop(TEMPLE, "Temple at dusk"), stop(BAR, "Bar"), stop(MARKET, "Night market")],
    );
    const commands: BatchableCommand[] = [
      { type: "UpdateActivity", tripId, activityId: LUNCH, timeWindow: { start: "13:00", end: "23:00" } },
      { type: "UpdateActivity", tripId, activityId: TEMPLE, title: "Temple at dusk" },
      { type: "AddActivity", tripId, activityId: BAR, dayId: DAY[2]!, title: "Bar" },
      { type: "UpdateActivity", tripId, activityId: MARKET, title: "Night market" },
    ];
    expect(changeLine(commands, before, after, AT)?.words).toBe("moved “Lunch” to 13:00, and changed 2 more stops");
  });

  // Fresh review of PR 535: `before` is read outside the batch, so another
  // member's edit to the same stop, or to another, can land in between.
  it("says only what the commands did: a time or a stop someone else changed meanwhile is not the actor's", () => {
    const after = trip(
      { [DAY[1]!]: [LUNCH], [DAY[2]!]: [TEMPLE], [DAY[3]!]: [MARKET] },
      [stop(LUNCH, "Long lunch", "14:00"), stop(TEMPLE, "Temple", "09:00"), stop(MARKET, "Market")],
    );
    const rename: BatchableCommand[] = [{ type: "UpdateActivity", tripId, activityId: LUNCH, title: "Long lunch" }];
    expect(changeLine(rename, before, after, AT)?.words).toBe("changed “Long lunch”");
  });

  // Review of PR 535: days are positional, so removing a past day or moving
  // the start puts another day's plan on today while naming no stop on it.
  it("announces a change of dates that puts another day's plan on today", () => {
    const dated = (days: string[], start: number) =>
      tripDetailFixture({
        ...before,
        days: before.days
          .filter((day) => days.includes(day.dayId))
          .map((day, index) => ({ ...day, date: `2027-05-0${start + index}` })),
      });
    const removed = dated([DAY[1]!, DAY[2]!, DAY[3]!], 1);
    expect(changeLine([{ type: "RemoveDay", tripId, dayId: DAY[0]! }], before, removed, AT)).toEqual({
      words: "changed the trip's days: day 2 now falls on May 2",
      link: { kind: "day", id: DAY[2]! },
    });
    const later = dated(DAY, 2);
    expect(changeLine([{ type: "SetTripStartDate", tripId, startDate: "2027-05-02" }], before, later, AT)?.words).toBe(
      "changed the trip's days: day 1 now falls on May 2",
    );
    // A start moved past today: the trip is no longer under way, so where it now begins.
    expect(changeLine([{ type: "SetTripStartDate", tripId, startDate: "2027-05-05" }], before, dated(DAY, 5), AT)?.words).toBe(
      "changed the trip's days: day 1 now falls on May 5",
    );
  });

  // Review round 3 of PR 535: a change of dates that moves only tomorrow
  // names tomorrow's new day, not today's, which did not move.
  it("names the day a change of dates put on tomorrow, and says when the trip now ends today", () => {
    const sparse = trip({ [DAY[1]!]: [LUNCH], [DAY[3]!]: [MARKET] }, [stop(LUNCH, "Lunch"), stop(MARKET, "Market")]);
    const closed = { ...sparse, days: sparse.days.filter((day) => day.dayId !== DAY[2]).map((day, index) => ({ ...day, date: `2027-05-0${index + 1}` })) };
    expect(changeLine([{ type: "RemoveDay", tripId, dayId: DAY[2]! }], sparse, closed, AT)).toEqual({
      words: "changed the trip's days: day 3 now falls on May 3",
      link: { kind: "day", id: DAY[3]! },
    });
    const home = { ...before, endDate: "2027-05-02", days: before.days.slice(0, 2) };
    expect(changeLine([{ type: "SetTripDates", tripId, startDate: "2027-05-01", endDate: "2027-05-02", newDayIds: [] }], before, home, AT)).toEqual({
      words: "changed the trip's days: the trip now ends on day 2, May 2",
      link: { kind: "day", id: DAY[1]! },
    });
  });

  // Review round 4 of PR 535: going home before today leaves no today, and
  // day 1 did not move; the news is that the trip has ended.
  it("says a trip cut short before today now ends on its last day", () => {
    const early = { ...before, endDate: "2027-05-01", days: before.days.slice(0, 1) };
    expect(changeLine([{ type: "SetTripDates", tripId, startDate: "2027-05-01", endDate: "2027-05-01", newDayIds: [] }], before, early, AT)).toEqual({
      words: "changed the trip's days: the trip now ends on day 1, May 1",
      link: { kind: "day", id: DAY[0]! },
    });
  });

  it("says nothing when a change of dates leaves today's and tomorrow's plans as they were", () => {
    const DAY5 = uuidFrom(15, 52);
    const longer = { ...before, endDate: "2027-05-05", days: [...before.days, { dayId: DAY5, activityIds: [], date: "2027-05-05", costSubtotal: 0 }] };
    const lastDay = Date.UTC(2027, 4, 4, 12);
    expect(changeLine([{ type: "SetTripDates", tripId, startDate: "2027-05-01", endDate: "2027-05-05", newDayIds: [DAY5] }], before, longer, lastDay)).toBeNull();
  });

  it("says nothing before the trip is under way", () => {
    const after = trip({ [DAY[1]!]: [], [DAY[2]!]: [TEMPLE], [DAY[3]!]: [MARKET] }, [stop(TEMPLE, "Temple"), stop(MARKET, "Market")]);
    expect(changeLine([{ type: "RemoveActivity", tripId, activityId: LUNCH }], before, after, Date.UTC(2027, 3, 1))).toBeNull();
    expect(changeLine([{ type: "RemoveActivity", tripId, activityId: LUNCH }], before, after, AT)).toEqual({ words: "removed “Lunch”", link: undefined });
  });
});
