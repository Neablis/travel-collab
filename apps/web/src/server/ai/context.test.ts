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

    // Day list carries titles only (looked up from detail.activities), not full activity objects.
    expect(summary.days).toEqual([
      {
        index: 0,
        date: "2027-06-01",
        activities: ["Colosseum tour", "Roman Forum"],
        cost: 4100,
      },
    ]);
    expect(summary.name).toBe("Rome 2027");
    expect(summary.currency).toBe("USD");
    expect(summary.tripCostTotal).toBe(detail.tripCostTotal);
  });
});
