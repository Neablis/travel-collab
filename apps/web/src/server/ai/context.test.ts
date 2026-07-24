import { describe, expect, it } from "vitest";
import { costedTripDetailFixture } from "../../mocks/fixtures";
import { buildEnvelope } from "./context";

const PAGE_CONTEXT = { tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" };

describe("buildEnvelope", () => {
  it("page surface: includes macro catalog + summarized trip, tools: ['page']", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({ detail, surface: "page", pageContext: PAGE_CONTEXT });

    expect(envelope.surface).toBe("page");
    expect(envelope.tools).toEqual(["page"]);
    expect(envelope.macros).toBeDefined();
    expect(envelope.macros!.length).toBeGreaterThan(0);

    // Forbidden fields: no raw activities record, no conflicts array.
    expect(envelope.tripSummary).not.toHaveProperty("activities");
    expect(envelope.tripSummary).not.toHaveProperty("conflicts");
  });

  it("board surface: tools: ['planning'], no macro catalog", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({ detail, surface: "board" });

    expect(envelope.tools).toEqual(["planning"]);
    expect(envelope.macros).toBeUndefined();
  });

  it("combined surface: tools: ['planning', 'page'], includes macro catalog", () => {
    const detail = costedTripDetailFixture();
    const envelope = buildEnvelope({ detail, surface: "combined", pageContext: PAGE_CONTEXT });

    expect(envelope.tools).toEqual(["planning", "page"]);
    expect(envelope.macros).toBeDefined();
    expect(envelope.macros!.length).toBeGreaterThan(0);
  });

  it("summary is materially smaller than the full TripDetail: no activities record, no conflicts array", () => {
    const detail = costedTripDetailFixture();
    // Sanity: the fixture actually has nontrivial activities + conflicts-shaped data.
    expect(Object.keys(detail.activities).length).toBeGreaterThan(0);
    expect(detail.days.length).toBeGreaterThan(0);

    const envelope = buildEnvelope({ detail, surface: "board" });
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

  it("board surface: boundDay is absent even if pageContext.dayRef were somehow present", () => {
    const detail = costedTripDetailFixture();
    const dayId = detail.days[0]!.dayId;
    const envelope = buildEnvelope({
      detail,
      surface: "board",
      pageContext: { tripId: detail.tripId, dayRef: { kind: "dayId", dayId } },
    });

    expect(envelope.boundDay).toBeUndefined();
  });
});
