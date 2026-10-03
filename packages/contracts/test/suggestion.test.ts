import { describe, expect, it } from "vitest";
import {
  CreateSuggestionInput,
  EventEnvelope,
  Origin,
  ResolveSuggestionChangeInput,
  SuggestionChange,
  TripEventsPage,
  TripSuggestionsResponse,
} from "../src";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const suggestionId = "1b3d5f70-1111-4222-8333-444455556666";
const changeId = "1b3d5f70-1111-4222-8333-777788889999";
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

const addDay = (n: number) => ({ type: "AddDay", tripId, dayId: uuid(n) });
const dismiss = { type: "DismissConflict", tripId, conflictId: "overlap:a:b" };
const unit = (...commands: unknown[]) => ({ commands });

describe("CreateSuggestionInput", () => {
  it("accepts units of batchable commands, with no note", () => {
    const input = { units: [unit(addDay(1)), unit(addDay(2), addDay(3))] };
    expect(CreateSuggestionInput.parse(input)).toEqual(input);
  });

  // W3: dismissing a warning is a judgement on the trip as it stands, and the
  // conflict it targets may not exist by the time anyone reviews it.
  it("refuses a DismissConflict anywhere in any unit, and says why at its path", () => {
    const result = CreateSuggestionInput.safeParse({ units: [unit(addDay(1)), unit(addDay(2), dismiss)] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]!.path).toEqual(["units", 1, "commands", 1]);
    expect(result.error.issues[0]!.message).toMatch(/cannot dismiss a conflict/);
  });

  it("is bounded: 1..100 units, 1..50 commands per unit", () => {
    const units = (n: number) => Array.from({ length: n }, (_, i) => unit(addDay(i)));
    const commands = (n: number) => unit(...Array.from({ length: n }, (_, i) => addDay(i)));
    expect(CreateSuggestionInput.safeParse({ units: [] }).success).toBe(false);
    expect(CreateSuggestionInput.safeParse({ units: units(100) }).success).toBe(true);
    expect(CreateSuggestionInput.safeParse({ units: units(101) }).success).toBe(false);
    expect(CreateSuggestionInput.safeParse({ units: [commands(0)] }).success).toBe(false);
    expect(CreateSuggestionInput.safeParse({ units: [commands(50)] }).success).toBe(true);
    expect(CreateSuggestionInput.safeParse({ units: [commands(51)] }).success).toBe(false);
  });

  it("trims the note, reads a blank one as none, and refuses one past 500 characters", () => {
    const parse = (note: string) => CreateSuggestionInput.parse({ units: [unit(addDay(1))], note }).note;
    expect(parse("  move the museum to Tuesday  ")).toBe("move the museum to Tuesday");
    expect(parse("   ")).toBeNull();
    expect(parse(`  ${"x".repeat(500)}  `)).toHaveLength(500);
    expect(CreateSuggestionInput.safeParse({ units: [unit(addDay(1))], note: "x".repeat(501) }).success).toBe(false);
  });

  it("refuses a command that is not batchable", () => {
    const create = { type: "CreateTrip", tripId, name: "x", forkedFrom: null };
    expect(CreateSuggestionInput.safeParse({ units: [unit(create)] }).success).toBe(false);
  });
});

describe("ResolveSuggestionChangeInput", () => {
  it("takes accept, dismiss or withdraw and nothing else", () => {
    for (const action of ["accept", "dismiss", "withdraw"]) {
      expect(ResolveSuggestionChangeInput.parse({ action })).toEqual({ action });
    }
    expect(ResolveSuggestionChangeInput.safeParse({ action: "approve" }).success).toBe(false);
  });
});

describe("SuggestionChange / TripSuggestionsResponse", () => {
  const change = {
    id: changeId,
    suggestionId,
    tripId,
    authorId: "dev-bob",
    note: null,
    createdAt: "2026-10-03T00:00:00.000Z",
    commands: [addDay(1)],
    description: "Added Day 1",
    status: "pending",
    dependsOn: [],
    resolvedBy: null,
    resolvedAt: null,
  };

  it("round-trips a pending change inside a list response", () => {
    const response = { changes: [change], rev: "a1b2c3" };
    expect(TripSuggestionsResponse.parse(response)).toEqual(response);
  });

  // `expired`: pending for longer than the server keeps a change (Mitchell, 2026-10-03).
  it("knows the five statuses", () => {
    for (const status of ["pending", "accepted", "dismissed", "withdrawn", "expired"]) {
      expect(SuggestionChange.safeParse({ ...change, status }).success).toBe(true);
    }
    expect(SuggestionChange.safeParse({ ...change, status: "stale" }).success).toBe(false);
  });
});

// ADR-064: an accepted change is replayed by the reviewer, and the envelope's
// origin is the only place the author survives.
describe("Origin: suggestion", () => {
  const origin = { kind: "suggestion", suggestionId, changeId, authorId: "dev-bob" };

  it("round-trips on an event envelope", () => {
    const envelope = {
      streamId: tripId,
      seq: 4,
      type: "DayAdded",
      version: 1,
      payload: {},
      actorId: "dev-alice",
      occurredAt: "2026-10-03T00:00:00.000Z",
      batchId: uuid(9),
      origin,
    };
    expect(EventEnvelope.parse(envelope).origin).toEqual(origin);
  });

  it("requires the suggestion, the change and the author", () => {
    for (const key of ["suggestionId", "changeId", "authorId"] as const) {
      const { [key]: _, ...missing } = origin;
      expect(Origin.safeParse(missing).success).toBe(false);
    }
    expect(Origin.safeParse({ ...origin, authorId: "" }).success).toBe(false);
  });
});

describe("TripEventsPage.suggestionsRev", () => {
  it("is optional, and non-empty when present", () => {
    const page = { headSeq: 0, events: [], resync: false };
    expect(TripEventsPage.parse(page)).toEqual(page);
    expect(TripEventsPage.parse({ ...page, suggestionsRev: "r1" }).suggestionsRev).toBe("r1");
    expect(TripEventsPage.safeParse({ ...page, suggestionsRev: "" }).success).toBe(false);
  });
});
