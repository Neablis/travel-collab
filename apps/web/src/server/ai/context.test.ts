import { describe, expect, it } from "vitest";
import type { Conflict } from "@tc/contracts";
import { costedTripDetailFixture, tripDetailFixture } from "@tc/factories";
import {
  ASK_SCOPE_PREFIX,
  activeConflicts,
  askScopeLine,
  parseAskScope,
  resolveBoundDay,
  type AskScope,
} from "./context";

const PAGE_CONTEXT = { tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" };

// Two conflicts with compound, UUID-embedding ids (as detectConflicts emits) —
// exactly the ids the model must NEVER be asked to copy.
const OVERLAP: Conflict = {
  id: "time-overlap:1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d:2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e:3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f",
  kind: "time-overlap",
  severity: "warn",
  subjects: ["2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e", "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f"],
  description: '"Colosseum tour" and "Roman Forum" overlap in time on the same day.',
  resolutions: ["Change one activity's time window"],
};
const OVER_BUDGET: Conflict = {
  id: "over-budget:6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  kind: "over-budget",
  severity: "warn",
  subjects: ["6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f"],
  description: "Trip total exceeds the budget.",
  resolutions: ["Raise the budget"],
};

// `activeConflicts` is the SINGLE source of conflict `ref` numbering: /ask's
// `read_trip` (readTools.ts) and `batchResolver`'s `conflictRef` resolution both
// read it, so the number the model is shown and the id the server resolves it
// back to cannot drift. Asserted here directly, because nothing else asserts the
// dismissal filter or the renumbering that follows it.
//
// It used to sit under a `buildEnvelope` describe. That envelope went with the
// command endpoint (ADR-033 Decision 4) and its tests with it; this did not.
describe("activeConflicts", () => {
  it("keeps input order and carries the id for the resolver", () => {
    const detail = tripDetailFixture({ conflicts: [OVERLAP, OVER_BUDGET], dismissedConflictIds: [] });

    expect(activeConflicts(detail)).toEqual([
      { ref: 1, id: OVERLAP.id, kind: "time-overlap", description: OVERLAP.description },
      { ref: 2, id: OVER_BUDGET.id, kind: "over-budget", description: OVER_BUDGET.description },
    ]);
  });

  it("excludes dismissed conflicts and renumbers refs over what remains", () => {
    const detail = tripDetailFixture({
      conflicts: [OVERLAP, OVER_BUDGET],
      dismissedConflictIds: [OVERLAP.id],
    });

    expect(activeConflicts(detail)).toEqual([
      { ref: 1, id: OVER_BUDGET.id, kind: "over-budget", description: OVER_BUDGET.description },
    ]);
  });

  it("is empty when every conflict is dismissed", () => {
    const detail = tripDetailFixture({
      conflicts: [OVERLAP, OVER_BUDGET],
      dismissedConflictIds: [OVERLAP.id, OVER_BUDGET.id],
    });

    expect(activeConflicts(detail)).toEqual([]);
  });
});

// A page-authoring turn is told which day its page is bound to, and that answer
// comes from the STORED page row resolved against the trip — never from a
// `pageContext` the client sent, which is what the command endpoint accepted
// (ADR-033 Decision 2). These are the envelope's `boundDay` cases, kept whole:
// the resolution rule did not change, only who supplies its input.
describe("resolveBoundDay", () => {
  it("resolves a dayId ref against detail.days", () => {
    const detail = costedTripDetailFixture();
    const dayId = detail.days[0]!.dayId;

    expect(resolveBoundDay(detail, { tripId: detail.tripId, dayRef: { kind: "dayId", dayId } })).toEqual({
      index: 0,
      date: "2027-06-01",
    });
  });

  it("resolves an index ref by position", () => {
    const detail = costedTripDetailFixture();

    expect(resolveBoundDay(detail, { tripId: detail.tripId, dayRef: { kind: "index", index: 0 } })).toEqual({
      index: 0,
      date: "2027-06-01",
    });
  });

  it("is undefined for a page bound to no day", () => {
    expect(resolveBoundDay(costedTripDetailFixture(), PAGE_CONTEXT)).toBeUndefined();
  });

  // A day deleted under a bound page. Silently no binding, never a guessed one:
  // writing the page about day 1 because day 100 is gone is a confident wrong
  // answer, which is the failure class this whole area exists to remove.
  it("is undefined for an unresolvable ref rather than wrong", () => {
    const detail = costedTripDetailFixture();

    expect(
      resolveBoundDay(detail, { tripId: detail.tripId, dayRef: { kind: "index", index: 99 } }),
    ).toBeUndefined();
  });
});

// The /ask turn's scope travels to the model inside the system instruction, and
// `simulatedModel` reads it back out to decide whether to call `read_day`. The
// writer and the reader live in one module precisely so this round trip can be
// asserted; if it ever broke, a day-scoped question would silently be answered
// about the whole trip.
describe("the ask scope encoding", () => {
  const scopes: AskScope[] = [
    { kind: "trip" },
    { kind: "day", dayIndex: 0 },
    { kind: "day", dayIndex: 13 },
    // The page member (ADR-033 Decision 4). The id round-trips unread — the
    // page was resolved server-side before this line was written — but it has
    // to SURVIVE, because `simulatedModel` decides to compose rather than
    // answer from `kind` alone and a scope that degraded to `trip` here would
    // make a page turn answer a question instead.
    { kind: "page", pageId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" },
  ];

  it("round-trips every scope through an instruction", () => {
    for (const scope of scopes) {
      const instructions = ["You are the assistant.", askScopeLine(scope), "Answer briefly."].join("\n");
      expect(parseAskScope(instructions)).toEqual(scope);
    }
  });

  // Total by design: a narrowing that silently failed would answer about one
  // day without saying it had. The whole trip is the wider, safer reading.
  it("reads anything it cannot parse as the whole trip", () => {
    // Built from the real prefix, not a hard-coded "Scope: " — otherwise a
    // prefix change would silently stop these from reaching the
    // JSON.parse catch branch (and the invalid-dayIndex rejection below it)
    // they claim to cover, and still pass by matching parseAskScope's own
    // "anything unparseable" default.
    expect(parseAskScope("")).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}not json`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"day"}`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"day","dayIndex":"2"}`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"page"}`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"page","pageId":""}`)).toEqual({ kind: "trip" });
    expect(parseAskScope("The user mentioned a scope of day 4.")).toEqual({ kind: "trip" });
  });
});
