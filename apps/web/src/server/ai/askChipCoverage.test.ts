// Every suggestion chip the rail can offer gets a substantive answer on the
// SIMULATED path.
//
// Why this test exists, and why it is worth its length. `suggestedQuestions.ts`
// states the rule the chips are built on:
//
//   > Never suggest a question whose honest answer is "there isn't one."
//
// The pure function honours it. The model on the other end did not, and nothing
// connected the two: the final branch review (2026-08-29) found four chips that
// were dead ends — the empty-trip chip, the empty-day chip, the day-scoped
// conflict chip and the day-scoped booking chip — each offered from real trip
// state and each answered with something that ignored the question. That matters
// more than its severity suggests, because `ai-live` is off in every Vercel
// environment: the simulated model is the ONLY path anyone experiences on a
// deployment.
//
// Fixing the four was the easy half. This is the half that keeps them fixed:
// the chips are ENUMERATED from the real function over representative trip
// states, and each one is driven through a real turn — the real
// `simulatedModel`, calling the real read tools against the real `TripDetail`.
// Nothing is stubbed but the write tools' `{ queued: true }`, which is what
// `planningTools` genuinely returns.
//
// The structural tie is the expectation TABLE below. A chip that matches no row
// fails the run and names itself, so rewording a chip — or adding a fifth — is
// caught here rather than on a deployment. A row that matches no chip fails too,
// so the table cannot rot into a list of questions the rail stopped asking.
//
// It lives under src/server (which may import UI, never the reverse) because
// three of its four subjects are server modules and only one is a component
// module — and that one is a pure `(TripDetail, day) => string[]` with no React
// in it.
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { suggestedQuestions } from "@/components/assistant/suggestedQuestions";
import { askScopeLine, type AskScope } from "@/server/ai/context";
import { findFreeTime, readDay, readTrip } from "@/server/ai/readTools";
import { simulatedModel } from "@/server/ai/simulatedModel";
import { witness } from "@/test-support/witness";

// ---------------------------------------------------------------------------
// The harness: one whole /ask turn, without the AI SDK
// ---------------------------------------------------------------------------

type ToolCallPart = { type: string; toolCallId: string; toolName: string; input: string };
type TextPart = { type: string; text: string };
type Generated = { content: (ToolCallPart | TextPart)[] };
type Probe = { doGenerate: (options: unknown) => Promise<Generated> };

// The tool set an EDITOR's turn is handed (`handleAskRequest` → read tools plus
// the derived write tools). Editors are the only role the rail asks on behalf
// of: `TripBoardScreen.submitAssistantAsk` refuses a viewer's ask outright.
const EDITOR_TOOLS = [
  { name: "read_trip" },
  { name: "read_day" },
  { name: "find_free_time" },
  { name: "AddDay" },
  { name: "AddActivity" },
];

/**
 * Run one tool call for real.
 *
 * These four lines mirror `buildReadTools()`'s `execute` bodies, including the
 * scope fallbacks — a day-scoped turn that omits `day` reads the day it is
 * about. The write tools are collect-only on the real path too (`planningTools`
 * pushes an intent and returns `{ queued: true }`), so standing in for them is
 * not a stub of behaviour, only of the array they push into.
 */
function runTool(detail: TripDetail, scope: AskScope, call: ToolCallPart): unknown {
  const input = JSON.parse(call.input) as { day?: number; days?: number };
  const scopedDay = scope.kind === "day" ? scope.dayIndex + 1 : undefined;
  switch (call.toolName) {
    case "read_trip":
      return readTrip(detail);
    case "read_day": {
      // `simulatedModel` only ever asks for its own scoped day (one number,
      // never a list), so this harness needs only the single-day shape —
      // `readTools.test.ts` covers the batched one directly.
      const day = input.days ?? scopedDay;
      return day === undefined
        ? { error: "Say which day: read_day takes a 1-based day number, or a list of them." }
        : readDay(detail, day);
    }
    case "find_free_time":
      return findFreeTime(detail, scope, input);
    default:
      return { queued: true };
  }
}

// Read, propose, speak — three steps at most, and one spare so a turn that
// somehow loops is reported as a loop rather than hanging the suite.
const MAX_STEPS = 4;

async function answerFor(detail: TripDetail, scope: AskScope, question: string): Promise<string> {
  const model = simulatedModel("ask") as unknown as Probe;
  const prompt: unknown[] = [
    { role: "system", content: ["You are the trip assistant.", askScopeLine(scope)].join("\n") },
    { role: "user", content: [{ type: "text", text: question }] },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const { content } = await model.doGenerate({ prompt, tools: EDITOR_TOOLS });
    const calls = content.filter((part): part is ToolCallPart => part.type === "tool-call");
    if (calls.length === 0) {
      return content
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("");
    }
    prompt.push({ role: "assistant", content: calls });
    prompt.push({
      role: "tool",
      content: calls.map((call) => ({
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "json", value: runTool(detail, scope, call) },
      })),
    });
  }
  throw new Error(`"${question}" never reached an answer in ${MAX_STEPS} steps`);
}

// ---------------------------------------------------------------------------
// Representative trip states
// ---------------------------------------------------------------------------

const setKinds = (trip: TripDetail, kinds: Record<number, TripDetail["activities"][string]["kind"]>): TripDetail => {
  const ids = trip.days.flatMap((day) => day.activityIds);
  for (const [position, kind] of Object.entries(kinds)) {
    const id = ids[Number(position)]!;
    trip.activities[id] = { ...trip.activities[id]!, kind };
  }
  return trip;
};

/**
 * A time-overlap conflict in the shape `detectConflicts` emits: two activity
 * `subjects` on one day, and a description that names the stops rather than the
 * day (packages/domain/src/trip/conflicts.ts). Written here rather than run
 * through the engine because the engine takes a `TripState`, and what these
 * cases need is a conflict on a KNOWN day.
 */
function overlapOn(trip: TripDetail, dayIndex: number, id: string): TripDetail["conflicts"][number] {
  const [a, b] = trip.days[dayIndex]!.activityIds;
  return {
    id,
    kind: "time-overlap",
    severity: "warn",
    subjects: [a!, b!],
    description: `"${trip.activities[a!]!.title}" and "${trip.activities[b!]!.title}" overlap in time on the same day.`,
    resolutions: ["Move one of them to another time."],
  };
}

interface Case {
  name: string;
  trip: TripDetail;
  focusedDay: number | null;
}

function cases(): Case[] {
  const empty = tripDetailFactory.build({ name: "Rome 2027" }, { transient: { dayCount: 0 } });

  const bare = tripDetailFactory.build(
    { name: "Kyoto 2027" },
    { transient: { dayCount: 3, activitiesPerDay: 0, startDate: "2027-04-01" } },
  );

  const busy = setKinds(
    tripDetailFactory.build(
      { name: "Paris 2027" },
      { transient: { dayCount: 3, activitiesPerDay: 2, startDate: "2027-06-01", costed: true } },
    ),
    // One booked and one in transit, so the trip's "to book" count is a real
    // subset rather than "all of them" — the case where a shared predicate and
    // a duplicated one would still agree. The rest are `hold`, not the
    // factory's default `planned`: `needsBooking` (KI-86) does not count a
    // `planned`/untagged stop, so a state meant to exercise "still needs
    // booking" has to put its stops in a kind that genuinely does.
    { 0: "booked", 1: "hold", 2: "hold", 3: "transit", 4: "hold", 5: "hold" },
  );

  const oneToBook = setKinds(
    tripDetailFactory.build(
      { name: "Lisbon 2027" },
      { transient: { dayCount: 2, activitiesPerDay: 2, startDate: "2027-05-01" } },
    ),
    { 0: "booked", 1: "booked", 2: "booked", 3: "hold" },
  );

  const oneConflict = tripDetailFactory.build(
    { name: "Oslo 2027" },
    { transient: { dayCount: 2, activitiesPerDay: 2, startDate: "2027-07-01" } },
  );
  oneConflict.conflicts = [overlapOn(oneConflict, 1, "conflict-a")];

  const twoConflicts = tripDetailFactory.build(
    { name: "Porto 2027" },
    { transient: { dayCount: 2, activitiesPerDay: 3, startDate: "2027-08-01" } },
  );
  twoConflicts.conflicts = [overlapOn(twoConflicts, 0, "conflict-b"), overlapOn(twoConflicts, 1, "conflict-c")];

  const mixedDays = tripDetailFactory.build(
    { name: "Split 2027" },
    { transient: { dayCount: 2, activitiesPerDay: 2, startDate: "2027-09-01" } },
  );
  // Day 2 emptied, so the same trip offers both "what's the plan for day 1?"
  // and "day 2 is empty — what could I do with it?".
  mixedDays.days[1] = { ...mixedDays.days[1]!, activityIds: [] };

  return [
    { name: "a trip with no days at all", trip: empty, focusedDay: null },
    { name: "days but nothing scheduled, whole trip", trip: bare, focusedDay: null },
    { name: "days but nothing scheduled, day 1 focused", trip: bare, focusedDay: 0 },
    { name: "a full trip, whole trip", trip: busy, focusedDay: null },
    { name: "a full trip, day 2 focused", trip: busy, focusedDay: 1 },
    { name: "exactly one stop left to book", trip: oneToBook, focusedDay: null },
    { name: "exactly one conflict, whole trip", trip: oneConflict, focusedDay: null },
    { name: "exactly one conflict, on the focused day", trip: oneConflict, focusedDay: 1 },
    { name: "two conflicts, whole trip", trip: twoConflicts, focusedDay: null },
    { name: "two conflicts, one on the focused day", trip: twoConflicts, focusedDay: 0 },
    { name: "a day with stops, focused", trip: mixedDays, focusedDay: 0 },
    { name: "an empty day, focused", trip: mixedDays, focusedDay: 1 },
  ];
}

// ---------------------------------------------------------------------------
// What "a substantive answer" means, per chip
// ---------------------------------------------------------------------------

interface Expectation {
  /** Matches the chip. Every emitted chip must match exactly one row. */
  chip: RegExp;
  /** What the answer to that chip has to actually contain. */
  answer: RegExp;
}

const EXPECTATIONS: Expectation[] = [
  // Ideation. The only honest response to "there is nothing here yet" is a
  // draft, which is the propose → review → approve loop M9 built.
  { chip: /^There are no days yet — how should I start planning this trip\?$/, answer: /I've drafted \d+ changes? for this trip\. Nothing is applied yet\./ },
  { chip: /^Day \d+ is empty — what could I do with it\?$/, answer: /I've drafted \d+ changes? for day \d+\. Nothing is applied yet\./ },

  // Facts about the plan.
  { chip: /^How is the trip looking\?$/, answer: /runs to \d+ days?/ },
  { chip: /^What's the plan for day \d+\?$/, answer: /^Day \d+.* has \d+ stops?\./ },
  { chip: /^Which day has the most free time\?$/, answer: /biggest open stretch|found no open time/ },
  { chip: /^Where's the most free time on day \d+\?$/, answer: /biggest open stretch|found no open time/ },

  // Conflicts, at both scopes. The day-scoped one was answered by silence.
  { chip: /^There(?:'s 1 conflict| are \d+ conflicts) still open — what should I do about (?:it|them)\?$/, answer: /conflicts? (?:is|are) still open: .+/ },
  { chip: /^There(?:'s 1 conflict| are \d+ conflicts) on day \d+ — how should I fix (?:it|them)\?$/, answer: /conflicts? on this day: .+/ },

  // Booking, at both scopes. Both were answered by silence.
  // The answer alternates the VERB the same way the chip does, rather than the
  // looser `still needs? booking` that would match either. It was the loose
  // form, and the `exactly one stop left to book` state below renders the
  // singular — so the pattern was quietly covering for "1 stop still need
  // booking" (re-review, 2026-08-29). A pattern that tolerates the sentence
  // being wrong is not covering the sentence.
  { chip: /^(?:1 stop still needs|\d+ stops still need) booking — which (?:is it|should I sort out first)\?$/, answer: /(?:1 stop still needs|\d+ stops still need) booking: day \d+ \(\d+\)/ },
  { chip: /^What on day \d+ still needs booking\?$/, answer: /Still to book: .+/ },
];

const SIMULATED_NOTICE = /AI is switched off on this deployment/;

describe("every derived suggestion chip is answerable on the simulated path", () => {
  it("answers each chip substantively, and knows every chip it can be asked", async () => {
    // Measured, not guessed (the witness helper's own rule). The twelve states
    // above emit 32 chips, 18 of them distinct — counted on 2026-08-29, and
    // deterministic, since nothing here is generated. The floor is half of that
    // measurement: vacuity would mean `suggestedQuestions` returning nothing,
    // which collapses the count toward zero rather than shaving it, and half
    // leaves room to retire a state without anyone having to bump a number.
    const asked = witness("chips driven through a simulated turn");
    const matchedRows = new Set<number>();
    const seen = new Set<string>();

    for (const { name, trip, focusedDay } of cases()) {
      const chips = suggestedQuestions(trip, focusedDay);
      const scope: AskScope = focusedDay === null ? { kind: "trip" } : { kind: "day", dayIndex: focusedDay };

      for (const chip of chips) {
        const rows = EXPECTATIONS.map((row, i) => [row, i] as const).filter(([row]) => row.chip.test(chip));
        // The structural tie. A chip nobody wrote an expectation for is a chip
        // nobody checked the answer to — which is exactly how the four dead
        // ends survived six task reviews.
        expect(rows.length, `[${name}] no expectation covers the chip "${chip}" — add a row to EXPECTATIONS`).toBe(1);
        const [row, index] = rows[0]!;
        matchedRows.add(index);

        const answer = await answerFor(trip, scope, chip);
        expect(answer, `[${name}] "${chip}" was answered with: ${answer}`).toMatch(row.answer);
        // Belt and braces on "substantive": never the give-up sentence, and
        // never only the kill-switch notice.
        expect(answer).not.toContain("I couldn't read anything about this trip.");
        expect(answer.replace(SIMULATED_NOTICE, "").trim().length).toBeGreaterThan(40);
        expect(answer).toMatch(SIMULATED_NOTICE);

        seen.add(chip);
        asked.tick();
      }
    }

    asked.atLeast(16);
    // …and the table cannot rot: a row that matches nothing is a question the
    // rail no longer asks, and should be deleted with the chip rather than left
    // as cover.
    const unused = EXPECTATIONS.filter((_, i) => !matchedRows.has(i)).map((row) => String(row.chip));
    expect(unused, "these EXPECTATIONS rows matched no chip any state can emit").toEqual([]);
    // Distinct phrasings, not the same chip twelve times.
    expect(seen.size).toBeGreaterThanOrEqual(EXPECTATIONS.length);
  });
});
