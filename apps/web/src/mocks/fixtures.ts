import type { TripDetail } from "@tc/contracts";

export function tripDetailFixture(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Rome 2027",
    startDate: null,
    members: [{ userId: "dev-alice", role: "owner" }],
    days: [],
    backlog: [],
    activities: {},
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2026-07-08T12:00:00.000Z",
    ...overrides,
  };
}
