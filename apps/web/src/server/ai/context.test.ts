import { describe, expect, it } from "vitest";
import type { Conflict } from "@tc/contracts";
import { costedTripDetailFixture, tripDetailFixture } from "@tc/factories";
import { ASK_SCOPE_PREFIX, activeConflicts, askScopeLine, buildEnvelope, parseAskScope, type AskScope } from "./context";

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

describe("buildEnvelope", () => {
  it("page surface: includes macro catalog + summarized trip, tools: ['page']", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({ detail, surface: "page", pageContext: PAGE_CONTEXT });

    expect(envelope.surface).toBe("page");
    expect(envelope.tools).toEqual(["page"]);
    expect(envelope.macros.length).toBeGreaterThan(0);

    // Forbidden fields: no raw activities record, no conflicts array.
    expect(envelope.tripSummary).not.toHaveProperty("activities");
    expect(envelope.tripSummary).not.toHaveProperty("conflicts");
  });

  // The envelope itself no longer carries conflicts — that was the board and
  // combined surfaces, retired by ADR-033 Decision 4. `activeConflicts` is not
  // retired with them: it is the SINGLE source of `ref` numbering, and /ask's
  // `read_trip` (readTools.ts) and `batchResolver`'s `conflictRef` resolution
  // both read it. Asserted here directly, because nothing else asserts the
  // dismissal filter or the renumbering that follows it.
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

  it("summary is materially smaller than the full TripDetail: no activities record, no conflicts array", () => {
    const detail = costedTripDetailFixture();
    // Sanity: the fixture actually has nontrivial activities + conflicts-shaped data.
    expect(Object.keys(detail.activities).length).toBeGreaterThan(0);
    expect(detail.days.length).toBeGreaterThan(0);

    const envelope = buildEnvelope({ detail, surface: "page", pageContext: PAGE_CONTEXT });
    const summary = envelope.tripSummary as unknown as Record<string, unknown>;

    expect(summary).not.toHaveProperty("activities");
    expect(summary).not.toHaveProperty("conflicts");
    expect(summary).not.toHaveProperty("dismissedConflictIds");
    expect(summary).not.toHaveProperty("members");
    expect(summary).not.toHaveProperty("backlog");

    // Day list carries { id, title } per activity plus the day's dayId, so the
    // model can reference existing activities/days in Move/Update/Remove
    // planning tools (whose schemas require those UUIDs). It still omits the
    // full ActivityView record (location/notes/anchors/timeWindow).
    expect(summary.days).toEqual([
      {
        index: 0,
        dayId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
        date: "2027-06-01",
        activities: [
          { id: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e", title: "Colosseum tour" },
          { id: "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f", title: "Roman Forum" },
        ],
        cost: 4100,
      },
    ]);
    expect(summary.name).toBe("Rome 2027");
    expect(summary.currency).toBe("USD");
    expect(summary.tripCostTotal).toBe(detail.tripCostTotal);
  });

  it("page surface with a dayRef: includes boundDay resolved against detail.days", () => {
    const detail = costedTripDetailFixture();
    const dayId = detail.days[0]!.dayId;
    const envelope = buildEnvelope({
      detail,
      surface: "page",
      pageContext: { tripId: detail.tripId, dayRef: { kind: "dayId", dayId } },
    });

    expect(envelope.boundDay).toEqual({ index: 0, date: "2027-06-01" });
  });

  it("page surface with an index dayRef: resolves boundDay by position", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({
      detail,
      surface: "page",
      pageContext: { tripId: detail.tripId, dayRef: { kind: "index", index: 0 } },
    });

    expect(envelope.boundDay).toEqual({ index: 0, date: "2027-06-01" });
  });

  it("page surface without a dayRef: boundDay is absent", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({ detail, surface: "page", pageContext: PAGE_CONTEXT });

    expect(envelope.boundDay).toBeUndefined();
  });

  it("page surface with an unresolvable dayRef: boundDay is absent rather than wrong", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({
      detail,
      surface: "page",
      pageContext: { tripId: detail.tripId, dayRef: { kind: "index", index: 99 } },
    });

    expect(envelope.boundDay).toBeUndefined();
  });
});

// The /ask turn's scope travels to the model inside the system instruction, and
// `simulatedModel` reads it back out to decide whether to call `read_day`. The
// writer and the reader live in one module precisely so this round trip can be
// asserted; if it ever broke, a day-scoped question would silently be answered
// about the whole trip.
describe("the ask scope encoding", () => {
  const scopes: AskScope[] = [{ kind: "trip" }, { kind: "day", dayIndex: 0 }, { kind: "day", dayIndex: 13 }];

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
    expect(parseAskScope("The user mentioned a scope of day 4.")).toEqual({ kind: "trip" });
  });
});
