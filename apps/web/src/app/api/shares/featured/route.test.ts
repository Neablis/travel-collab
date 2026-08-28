import { describe, expect, it, vi } from "vitest";
import { SharedTripView } from "@tc/contracts";
import { JAPAN_TRIP_NAME } from "@tc/fixtures";

// Same guard as demoTrip.test.ts, one level up: the route a stranger can hit
// as often as they like must not be able to reach Postgres. Before ADR-031
// this endpoint did a share lookup plus a full event-stream replay per view.
vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      throw new Error("GET /api/shares/featured must not reach the database");
    }
  },
}));

const { GET } = await import("./route");

describe("GET /api/shares/featured", () => {
  it("serves the demo trip, with no session and no database", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { trip: unknown };
    const trip = SharedTripView.parse(body.trip);
    expect(trip.name).toBe(JAPAN_TRIP_NAME);
    expect(trip.days).toHaveLength(14);
  });
});
