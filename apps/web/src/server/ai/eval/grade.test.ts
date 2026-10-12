import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoTripDetail } from "@/server/demoTrip";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import { TripCommand } from "@tc/contracts";
import {
  DAYTIME_END_MINUTES,
  DAYTIME_START_MINUTES,
  decideTripCommand,
  evolveTrip,
  summarizeFreeDays,
  tripDetailFromState,
  type TripState,
} from "@tc/domain";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import { OVERVIEW_ABOVE_DAYS } from "@/server/assistant/tools/read";
import { accountExpectationFor, expectationFor, mostFreeDays, type SeededAccountTrip } from "./cases";
import { ACCOUNT_TRIPS, EVAL_TRIPS, LONG_TRIP_DAYS, accountTripCommands, longTripCommands } from "./trips";
import { grade, namesAmount, namesDayNumber, reviewedChanges, textBeforeToolCall, type EvalTurn } from "./grade";

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
  return { record, text, proposalCommands, textBeforeToolCall: false };
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
    // Seven asked for, and "no text before a tool call", which is always on.
    expect(checks).toHaveLength(8 + 1);
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

// M45: a fact the trips determine and no day or amount can name — the city
// visited most, how many countries. Case-insensitive, because "kyoto" at the
// start of a sentence is still Kyoto.
describe("mentionsOneOf", () => {
  it("passes an answer that names one of them, in any case, and fails one that names none", () => {
    expect(failing(grade(turn({}, "Mostly kyoto, three times."), { mentionsOneOf: ["Kyoto"] }))).toEqual([]);
    expect(failing(grade(turn({}, "Mostly Barcelona."), { mentionsOneOf: ["Kyoto", "Nara"] }))).toEqual([
      'mentions "Kyoto" or "Nara"',
    ]);
  });
});

// A place name inside another word is not the place: "romantic" is not Oman,
// "scuba" is not Cuba, "Indian" is not India.
describe("namesOneOf", () => {
  it("passes a whole name in any case, and fails one found only inside a word", () => {
    expect(failing(grade(turn({}, "Try oman, then Jordan."), { namesOneOf: ["Oman"] }))).toEqual([]);
    expect(failing(grade(turn({}, "Côte d'Ivoire next."), { namesOneOf: ["Côte d'Ivoire"] }))).toEqual([]);
    expect(failing(grade(turn({}, "A romantic return to Japan."), { namesOneOf: ["Oman"] }))).toEqual(['names "Oman"']);
    expect(failing(grade(turn({}, "Scuba off Okinawa, an Indian summer."), { namesOneOf: ["Cuba", "India"] }))).toEqual([
      'names "Cuba" or "India"',
    ]);
  });
});

describe("the cases", () => {
  const japan = demoTripDetail(DEMO_TRIP_ID);

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

  // The off-topic gate (2026-10-10): refused is read off the classification,
  // so a model that merely SAYS it cannot help still fails `offTopic: true`.
  it("checks whether the classifier refused the turn as off-topic", () => {
    const refused = turn({ steps: 0, classification: { offTopic: true, verdict: "{}" } as AskAnalyticsRecord["classification"] }, "I can only help with planning this trip.");
    const answered = turn({ steps: 1, classification: { offTopic: false, verdict: "{}" } as AskAnalyticsRecord["classification"] }, "A Phillips.");
    expect(failing(grade(refused, { offTopic: true }))).toEqual([]);
    expect(failing(grade(answered, { offTopic: true }))).toEqual(["refused as off-topic", "ran no agent step"]);
    expect(failing(grade(refused, { offTopic: false }))).toEqual(["not refused as off-topic"]);
  });

  // The refusal's whole saving is that the agent never runs: a classifier that
  // flagged the turn while the agent answered anyway must fail.
  it("fails an off-topic turn the agent still ran", () => {
    const ranAnyway = turn({ steps: 2, classification: { offTopic: true, verdict: "{}" } as AskAnalyticsRecord["classification"] }, "I can only help with planning this trip.");
    expect(failing(grade(ranAnyway, { offTopic: true }))).toEqual(["ran no agent step"]);
  });

  it("fails an answer that repeats a line of the instruction", () => {
    const leaked = turn({}, "Sure: Use ONLY what the tools return. You cannot see the trip any other way.");
    expect(failing(grade(leaked, { mustNotSay: ["Use ONLY what the tools return"] }))).toEqual([
      'does not say "Use ONLY what the tools return"',
    ]);
    expect(failing(grade(turn(), { mustNotSay: ["Use ONLY what the tools return"] }))).toEqual([]);
  });

  // The first eval on Claude (2026-10-10) failed two cases where the model was
  // right and the expectation was not: the seeded trip's day 2 is in Tokyo, so
  // a Gion walk there must NOT be drafted, and "plan me a six day trip to
  // Kyoto" may ask before drafting on a trip that already has Kyoto days.
  it("expects no Gion walk on a seeded day 2 that is not in Kyoto, and lets the six-day plan ask first", () => {
    expect(expectationFor("c-add-evening", japan)!.proposes).toBe(false);
    const plan = expectationFor("t-reads-and-says-nothing", japan)!;
    expect(plan.proposes).toBeUndefined();
    expect(plan.completes ?? true).toBe(true);
  });

  // Over a trip in Japan, every country but Japan is a right answer: one named
  // only inside "romantic" or "scuba" is not.
  it("fails a next country that names only one already visited", () => {
    const next = accountExpectationFor("a-next-country", [{ detail: japan, travelling: true }], japan.members[0]!.userId)!;
    const said = (text: string) => failing(grade(turn({ toolCalls: [{ name: "suggest_next_country", input: {} }] }, text), next));
    expect(said("A romantic return to Japan, with scuba off Okinawa and an Indian summer in Hokkaido.")).toEqual([
      `names one of ${next.namesOneOf!.length} places`,
    ]);
    expect(said("Portugal, for the food.")).toEqual([]);
  });

  // The trip the asker is not going on outranks the right answer to both: an
  // answer that ranks it too ("Barcelona, then Kyoto") counted it.
  it("fails an account answer that also ranks the trip the asker is not going on", () => {
    const asker = "eval-reader";
    const seeded = ACCOUNT_TRIPS.map((trip, i): SeededAccountTrip => {
      const tripId = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      let state: TripState | null = null;
      for (const command of [TripCommand.parse({ type: "CreateTrip", tripId, name: trip.name }), ...accountTripCommands(tripId, trip)]) {
        const decision = decideTripCommand(state, command, { actorId: asker });
        if (!decision.ok) throw new Error(`the domain refused ${command.type}: ${decision.rejection.message}`);
        for (const event of decision.events) state = evolveTrip(state, event);
      }
      return { detail: tripDetailFromState(state!, "2027-04-01T09:00:00.000Z"), travelling: trip.travelling };
    });
    const said = (id: string, tool: string, text: string) =>
      failing(grade(turn({ toolCalls: [{ name: tool, input: {} }] }, text), accountExpectationFor(id, seeded, asker)!));
    expect(said("a-city-most", "visit_counts", "Kyoto, 3 days.")).toEqual([]);
    expect(said("a-city-most", "visit_counts", "Barcelona (4 days), then Kyoto (3).")).toEqual(['does not say "Barcelona"']);
    expect(said("a-most-expensive-meal", "spend_by_category", "The Kaiseki dinner, at $180.")).toEqual([]);
    expect(said("a-most-expensive-meal", "spend_by_category", "Disfrutar at $300, ahead of the Kaiseki dinner ($180).")).toEqual([
      'does not say "Disfrutar"',
    ]);
  });

  it("has an expectation for every prompt in the live set", () => {
    const set = JSON.parse(readFileSync(join(import.meta.dirname, "live-set.json"), "utf8")) as {
      prompts: { id: string; surface?: string }[];
    };
    for (const prompt of set.prompts) {
      const expected =
        prompt.surface === "account" ? accountExpectationFor(prompt.id, [], "eval-reader") : expectationFor(prompt.id, japan);
      expect(expected, prompt.id).toBeDefined();
    }
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

// KI-20261012-e: a turn whose reply carried the model's note to itself passed
// every check, because none of them read the reply's text.
describe("no text before a tool call", () => {
  const LEAKED =
    'Gap 5:30–7 pm. Look up a cafe in Shibuya.I\'d add a "Coffee break in Shibuya" stop to day 1, from 5:45 to 6:30 pm. ' +
    "That fits the gap between the Trunk Hotel check-in, which ends at 5:30 pm, and dinner at Gonpachi at 7 pm. " +
    "The change is waiting for your approval.";

  it("fails the KI's reply on its seam, from the text alone", () => {
    expect(failing(grade(turn({}, LEAKED, 1), { proposes: true }))).toEqual(["no text before a tool call"]);
  });

  it("fails a stream that spoke before it called a tool, whatever the text looks like", () => {
    const chunks = [
      { type: "text-delta", delta: "Checking day 1. " },
      { type: "tool-input-start", toolName: "read_day" },
      { type: "text-delta", delta: "Day 3 is the most open." },
    ];
    expect(textBeforeToolCall(chunks)).toBe(true);
    expect(failing(grade({ ...turn(), textBeforeToolCall: textBeforeToolCall(chunks) }, {}))).toEqual(["no text before a tool call"]);
  });

  // The KI's own reproduction: step 1 reads silently, step 2 notes the gap
  // beside its call, step 3 answers. Text after the first call still leaked.
  it("fails text written beside a later tool call, not only before the first", () => {
    const chunks = [
      { type: "tool-input-start", toolName: "read_day" },
      { type: "text-delta", delta: "Gap 5:30–7 pm. Look up a cafe." },
      { type: "tool-input-start", toolName: "search_places" },
      { type: "text-delta", delta: "Day 1 is free from 5:30 to 7 pm." },
    ];
    expect(textBeforeToolCall(chunks)).toBe(true);
  });

  // An abbreviation is not a seam: two lowercase letters must end the sentence.
  it("reads a seam only after a word, not an abbreviation", () => {
    expect(failing(grade(turn({}, "Start at the shrine, e.g.Kyoto's Fushimi Inari, at 7 a.m.Breakfast after."), {}))).toEqual([]);
    expect(failing(grade(turn({}, "Look up a cafe in Shibuya.I'd add a stop."), {}))).toEqual(["no text before a tool call"]);
  });

  it("passes text that only follows the tool calls", () => {
    const chunks = [{ type: "tool-input-start", toolName: "read_day" }, { type: "text-delta", delta: "Day 3 is the most open." }];
    expect(textBeforeToolCall(chunks)).toBe(false);
    expect(failing(grade({ ...turn(), textBeforeToolCall: false }, {}))).toEqual([]);
  });
});
