import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoTripDetail } from "@/server/demoTrip";
import { DAYTIME_END_MINUTES, DAYTIME_START_MINUTES, summarizeFreeDays } from "@tc/domain";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import { OVERVIEW_ABOVE_DAYS } from "@/server/assistant/tools/read";
import { expectationFor, mostFreeDays } from "./cases";
import { EVAL_TRIPS, LONG_TRIP_DAYS, longTripCommands } from "./trips";
import { grade, namesAmount, namesDayNumber, reviewedChanges, type EvalTurn } from "./grade";

// The fields `grade` reads, on an otherwise ordinary completed turn.
function turn(over: Partial<AskAnalyticsRecord> = {}, text = "Day 3 is the most open.", proposalCommands = 0): EvalTurn {
  const record = {
    outcome: "completed",
    answered: true,
    cause: null,
    toolCalls: [{ name: "read_trip", input: {} }, { name: "find_free_time", input: {} }],
    latencyMs: 4_000,
    usage: { inputTokens: 3_000, outputTokens: 200, totalTokens: 3_200 },
    ...over,
  } as AskAnalyticsRecord;
  return { record, text, proposalCommands };
}

const failing = (checks: ReturnType<typeof grade>) => checks.filter((check) => !check.pass).map((check) => check.name);

describe("grade", () => {
  it("passes a turn that meets every expectation", () => {
    const checks = grade(turn(), {
      maxToolCalls: 3,
      mustCall: ["find_free_time"],
      maxCallsOf: { find_free_time: 1 },
      proposes: false,
      maxLatencyMs: 60_000,
      maxInputTokens: 10_000,
      namesOneOfDays: [3],
    });
    expect(checks).toHaveLength(8);
    expect(failing(checks)).toEqual([]);
  });

  // The 2026-10-04 production turn, as the eval would have seen it.
  it("fails the per-day fan-out, the slow turn and the wrong day", () => {
    const fanOut = [
      { name: "read_trip", input: {} },
      ...Array.from({ length: 9 }, (_, i) => ({ name: "find_free_time", input: { day: i + 1 } })),
    ];
    const checks = grade(turn({ toolCalls: fanOut, latencyMs: 162_307 }, "Day 8 has the most free time with 21 hours."), {
      maxToolCalls: 3,
      maxCallsOf: { find_free_time: 1 },
      maxLatencyMs: 60_000,
      namesOneOfDays: [5],
    });
    expect(failing(checks)).toEqual(["≤ 3 tool calls", "≤ 1 × find_free_time", "≤ 60s", "names day 5"]);
  });

  it("fails a turn that errored or said nothing", () => {
    expect(failing(grade(turn({ outcome: "error", cause: { name: "TimeoutError", message: "deadline", statusCode: null } }), {}))).toEqual(["completes"]);
    expect(failing(grade(turn({ answered: false }), {}))).toEqual(["completes"]);
  });

  it("holds a question to proposing nothing and a change to proposing something", () => {
    expect(failing(grade(turn({}, "ok", 2), { proposes: false }))).toEqual(["proposes nothing"]);
    expect(failing(grade(turn({}, "ok", 0), { proposes: true }))).toEqual(["proposes a change"]);
    expect(failing(grade(turn({}, "ok", 1), { proposes: true }))).toEqual([]);
  });

  it("fails a forbidden tool and a missing one", () => {
    expect(failing(grade(turn(), { mustNotCall: ["find_free_time"], mustCall: ["read_day"] }))).toEqual([
      "calls read_day",
      "never calls find_free_time",
    ]);
  });

  it("treats unreported input tokens as a failure, not as zero", () => {
    expect(failing(grade(turn({ usage: { inputTokens: null, outputTokens: null, totalTokens: null } }), { maxInputTokens: 10 }))).toEqual([
      "≤ 10 input tokens",
    ]);
  });
});

describe("namesDayNumber", () => {
  it("matches the day as a word, in either case, and not as part of another number or word", () => {
    expect(namesDayNumber("Day 7 is quietest", 7)).toBe(true);
    expect(namesDayNumber("on day  7.", 7)).toBe(true);
    expect(namesDayNumber("Day 17 is quietest", 1)).toBe(false);
    expect(namesDayNumber("Day 1 and day 17", 17)).toBe(true);
    expect(namesDayNumber("today 7 people", 7)).toBe(false);
  });
});

describe("namesAmount", () => {
  it("matches the amount in major units, grouped or not, with or without cents", () => {
    expect(namesAmount("That's $990 each.", 99000)).toBe(true);
    expect(namesAmount("$990.00 per person", 99000)).toBe(true);
    expect(namesAmount("about 1,980 USD for the group", 198000)).toBe(true);
    expect(namesAmount("$9,900 each", 99000)).toBe(false);
    expect(namesAmount("$792 each", 99000)).toBe(false);
  });

  it("fails a turn whose answer names none of the amounts", () => {
    expect(failing(grade(turn({}, "Each of you pays $792."), { namesOneOfAmounts: [99000] }))).toEqual(["names 990.00"]);
    expect(failing(grade(turn({}, "Each of you pays $990."), { namesOneOfAmounts: [99000] }))).toEqual([]);
  });
});

describe("the cases", () => {
  const japan = demoTripDetail();

  // Travellers spec D1: the demo roster has a member who is not travelling, so
  // the split over travellers ($990) and the split over members ($792) differ,
  // and only the first is right.
  it("splits a day over the travellers, not the members", () => {
    const travellers = japan.members.filter((m) => m.travelling !== false).length;
    expect(japan.members.length).toBeGreaterThan(travellers);
    const split = expectationFor("q-split-travellers", japan)!.namesOneOfAmounts!;
    expect(split).toEqual([japan.days[0]!.costSubtotal / travellers]);
    expect(split).not.toContain(japan.days[0]!.costSubtotal / japan.members.length);
  });

  it("has an expectation for every prompt in the live set", () => {
    const set = JSON.parse(readFileSync(join(import.meta.dirname, "live-set.json"), "utf8")) as { prompts: { id: string }[] };
    for (const prompt of set.prompts) expect(expectationFor(prompt.id, japan), prompt.id).toBeDefined();
  });

  // A prompt that names a trip the runner cannot seed would fail only on a
  // paid run, after every prompt before it had spent; so would a "long" trip
  // that was not long enough to get the overview it exists to test.
  it("names only trips the runner can seed, and the long one is past the overview line", () => {
    const set = JSON.parse(readFileSync(join(import.meta.dirname, "live-set.json"), "utf8")) as {
      prompts: { id: string; trip?: string }[];
    };
    const named = set.prompts.filter((prompt) => prompt.trip !== undefined);
    expect(named.map((prompt) => prompt.id)).toEqual(["q-summarise-long-trip"]);
    for (const prompt of named) expect(EVAL_TRIPS as readonly string[], prompt.id).toContain(prompt.trip);

    const dates = longTripCommands("00000000-0000-4000-8000-000000000000").find((c) => c.type === "SetTripDates");
    expect(dates?.type === "SetTripDates" && dates.newDayIds.length).toBe(LONG_TRIP_DAYS);
    expect(LONG_TRIP_DAYS).toBeGreaterThan(OVERVIEW_ABOVE_DAYS);
  });

  // The summary is the overview's job: one look at a stay is fine, a read of
  // the whole trip is the failure, and the turn's tokens say which it was.
  it("holds the long-trip summary to read_trip, one read_day call and a token ceiling", () => {
    const expected = expectationFor("q-summarise-long-trip", japan)!;
    const skimmed = turn({ toolCalls: [{ name: "read_trip", input: {} }, { name: "read_day", input: { days: [1, 16] } }] }, "100 days.");
    expect(failing(grade(skimmed, expected))).toEqual([]);
    const readEverything = turn(
      {
        toolCalls: [{ name: "read_trip", input: {} }, ...[1, 6, 11].map((d) => ({ name: "read_day", input: { days: [d] } }))],
        usage: { inputTokens: 64_000, outputTokens: 400, totalTokens: 64_400 },
      },
      "100 days.",
    );
    expect(failing(grade(readEverything, expected))).toEqual(["≤ 1 × read_day", "≤ 30000 input tokens"]);
  });

  // Computed from the trip, never typed in: the right answer moves when the
  // seed does, and a tie admits every tied day.
  it("takes the most free day from the domain's own ranking of the seeded trip", () => {
    const ranked = summarizeFreeDays(japan, { afterMinutes: DAYTIME_START_MINUTES, beforeMinutes: DAYTIME_END_MINUTES });
    const days = mostFreeDays(japan);
    expect(days).toContain(ranked[0]!.dayIndex + 1);
    for (const day of days) {
      const row = ranked.find((r) => r.dayIndex === day - 1)!;
      expect(row.freeMinutes).toBe(ranked[0]!.freeMinutes);
    }
    expect(expectationFor("q-most-free", japan)!.namesOneOfDays).toEqual(days);
  });
});

// ADR-067: a change prompt that ends with its changes stored on the board
// proposed them as much as one that ends with a card, and must pass on it.
describe("reviewedChanges", () => {
  const finish = (messageMetadata: unknown) => [{ type: "text-delta", delta: "Done." }, { type: "finish", messageMetadata }];

  it("counts a card's commands", () => {
    expect(reviewedChanges(finish({ proposal: { commands: [{}, {}] } }))).toBe(2);
  });

  it("counts a stored suggestion's changes, so a multi-change case passes on it", () => {
    const chunks = finish({ suggested: { suggestionId: "s", changeCount: 4, snapshotId: null, snapshotName: null } });
    expect(reviewedChanges(chunks)).toBe(4);
    expect(failing(grade(turn({}, "Put them on the board.", reviewedChanges(chunks)), { proposes: true }))).toEqual([]);
  });

  it("counts nothing for a turn that proposed nothing", () => {
    expect(reviewedChanges([{ type: "finish" }])).toBe(0);
  });
});
