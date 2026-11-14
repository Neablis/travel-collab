import { describe, expect, it } from "vitest";
import { BatchableCommand } from "@tc/contracts";
import { costedTripDetailFixture } from "@tc/factories";
import { describeCommand, summarizeBatch } from "./planSummary";

// costedTripDetailFixture: one day (dayId below) holding "Colosseum tour" and
// "Roman Forum", plus "Flight to Rome" in the backlog.
const DAY_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const COLOSSEUM_ID = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
const FORUM_ID = "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f";

describe("summarizeBatch", () => {
  const detail = costedTripDetailFixture();
  const tripId = detail.tripId;

  it("names the moved activity and its target day (the user's 'move X' case)", () => {
    const calls: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: COLOSSEUM_ID, toDayId: DAY_ID, position: 0 },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — moved “Colosseum tour” to day 1.");
  });

  it("says 'the backlog' when toDayId is null", () => {
    const calls: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: FORUM_ID, toDayId: null, position: 0 },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — moved “Roman Forum” to the backlog.");
  });

  it("joins two commands with 'and' (the user's 'move X then add Y' case)", () => {
    const calls: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: COLOSSEUM_ID, toDayId: DAY_ID, position: 1 },
      { type: "AddActivity", tripId, activityId: "9a9a9a9a-1111-4222-8333-444455556666", title: "Dinner in Oakland" },
    ];
    expect(summarizeBatch(calls, detail)).toBe(
      "Done — moved “Colosseum tour” to day 1 and added “Dinner in Oakland” to the backlog.",
    );
  });

  it("uses an Oxford comma for three or more commands", () => {
    const calls: BatchableCommand[] = [
      { type: "AddDay", tripId, dayId: "aaaaaaaa-1111-4222-8333-444455556666" },
      { type: "RemoveActivity", tripId, activityId: FORUM_ID },
      { type: "SetTripBudget", tripId, budget: null },
    ];
    expect(summarizeBatch(calls, detail)).toBe(
      "Done — added a day, removed “Roman Forum”, and cleared the budget.",
    );
  });

  it("falls back gracefully when an activity id isn't in the trip detail", () => {
    const calls: BatchableCommand[] = [
      { type: "RemoveActivity", tripId, activityId: "00000000-0000-4000-8000-000000000000" },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — removed “an activity”.");
  });

  it("names the new trip name (rename)", () => {
    const calls: BatchableCommand[] = [{ type: "SetTripName", tripId, name: "Rome & Florence" }];
    expect(summarizeBatch(calls, detail)).toBe('Done — renamed the trip to "Rome & Florence".');
  });

  it("states the new date range when both dates are set", () => {
    const calls: BatchableCommand[] = [
      { type: "SetTripDates", tripId, startDate: "2027-06-01", endDate: "2027-06-08", newDayIds: [] },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — set the trip dates to 2027-06-01 – 2027-06-08.");
  });

  it("falls back to a generic phrase when a date bound is cleared", () => {
    const calls: BatchableCommand[] = [
      { type: "SetTripDates", tripId, startDate: null, endDate: null, newDayIds: [] },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — set the trip dates.");
  });
});

// KI-80: one command per `BatchableCommand` type, said in both moods, plus the
// fallbacks where the two have always differed: an unknown day is "a day" in
// the receipt and "a new day" on the card (a proposal's day can be one the same
// batch adds), and a rename is quoted straight in one and curly in the other.
// The applied column is `summarizeBatch`'s phrasing byte for byte; the proposed
// column is the card's text, which was `describeProposedChange`'s (writeTools.ts)
// until the two switches became this one. Both columns were run against the two
// old functions before the switch moved, so the refactor changed no output.
const UNKNOWN_DAY_ID = "dddddddd-1111-4222-8333-444455556666";
const bothMoods = (tripId: string): [BatchableCommand, string, string][] => [
  [{ type: "AddDay", tripId, dayId: "aaaaaaaa-1111-4222-8333-444455556666" }, "added a day", "Add a day"],
  [{ type: "RemoveDay", tripId, dayId: DAY_ID }, "removed day 1", "Remove day 1"],
  [{ type: "RemoveDay", tripId, dayId: UNKNOWN_DAY_ID }, "removed a day", "Remove a new day"],
  [{ type: "SetTripStartDate", tripId, startDate: "2027-06-02" }, "set the start date to 2027-06-02", "Set the start date to 2027-06-02"],
  [{ type: "SetTripStartDate", tripId, startDate: null }, "cleared the start date", "Clear the start date"],
  [
    { type: "AddActivity", tripId, activityId: "bbbbbbbb-1111-4222-8333-444455556666", dayId: DAY_ID, title: "Gelato" },
    "added “Gelato” to day 1",
    "Add “Gelato” to day 1",
  ],
  [
    { type: "AddActivity", tripId, activityId: "bbbbbbbb-1111-4222-8333-444455556667", dayId: UNKNOWN_DAY_ID, title: "Gelato" },
    "added “Gelato” to a day",
    "Add “Gelato” to a new day",
  ],
  [
    { type: "AddActivity", tripId, activityId: "bbbbbbbb-1111-4222-8333-444455556668", title: "Gelato" },
    "added “Gelato” to the backlog",
    "Add “Gelato” to the backlog",
  ],
  [{ type: "UpdateActivity", tripId, activityId: COLOSSEUM_ID, title: "Colosseum" }, "updated “Colosseum tour”", "Update “Colosseum tour”"],
  [
    { type: "MoveActivity", tripId, activityId: COLOSSEUM_ID, toDayId: DAY_ID, position: 0 },
    "moved “Colosseum tour” to day 1",
    "Move “Colosseum tour” to day 1",
  ],
  [
    { type: "MoveActivity", tripId, activityId: FORUM_ID, toDayId: null, position: 0 },
    "moved “Roman Forum” to the backlog",
    "Move “Roman Forum” to the backlog",
  ],
  [{ type: "RemoveActivity", tripId, activityId: COLOSSEUM_ID }, "removed “Colosseum tour”", "Remove “Colosseum tour”"],
  [
    { type: "RemoveActivity", tripId, activityId: "00000000-0000-4000-8000-000000000000" },
    "removed “an activity”",
    "Remove “an activity”",
  ],
  [{ type: "DismissConflict", tripId, conflictId: "cccccccc-1111-4222-8333-444455556666" }, "dismissed a conflict", "Dismiss a conflict"],
  [{ type: "SetTripCurrency", tripId, currency: "EUR" }, "set the currency to EUR", "Set the currency to EUR"],
  [{ type: "SetTripBudget", tripId, budget: null }, "cleared the budget", "Clear the budget"],
  [{ type: "SetTripBudget", tripId, budget: { amountMinor: 100000, currency: "EUR" } }, "set the budget", "Set the budget"],
  [{ type: "SetTripName", tripId, name: "Rome" }, 'renamed the trip to "Rome"', "Rename the trip to “Rome”"],
  [
    { type: "SetTripDates", tripId, startDate: "2027-06-01", endDate: "2027-06-04", newDayIds: [] },
    "set the trip dates to 2027-06-01 – 2027-06-04",
    "Set the trip dates to 2027-06-01 – 2027-06-04",
  ],
  [{ type: "SetTripDates", tripId, startDate: null, endDate: null, newDayIds: [] }, "set the trip dates", "Set the trip dates"],
];

describe("describeCommand", () => {
  const detail = costedTripDetailFixture();
  const rows = bothMoods(detail.tripId);

  it.each(rows)("says %o as %s, and proposes it as %s", (command, applied, proposed) => {
    expect(describeCommand(command, detail, "applied")).toBe(applied);
    expect(describeCommand(command, detail, "proposed")).toBe(proposed);
    // The receipt is the applied phrase and nothing else.
    expect(summarizeBatch([command], detail)).toBe(`Done — ${applied}.`);
  });

  // The witness for the table: without it a thirteenth command is absent from
  // the rows and every row keeps passing while covering less.
  it("covers every BatchableCommand type, with a command the contract accepts", () => {
    const covered = [...new Set(rows.map(([command]) => command.type))].sort();
    const all = BatchableCommand.options.map((o) => o.shape.type.value as string).sort();
    expect(covered).toEqual(all);
    for (const [command] of rows) expect(BatchableCommand.safeParse(command).success).toBe(true);
  });
});
