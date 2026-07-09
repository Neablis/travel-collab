import type { TripDetail, TripHistory } from "@tc/contracts";

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

// Newest first: an undo entry, the undone "add to backlog" entry, then the
// creation entry — matches how the real history endpoint orders things.
export function historyFixture(tripId: string): TripHistory {
  return {
    tripId,
    canUndo: true,
    canRedo: true,
    entries: [
      {
        batchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a83",
        fromSeq: 2,
        toSeq: 2,
        actorId: "dev-alice",
        occurredAt: "2026-07-08T12:02:00.000Z",
        origin: { kind: "undo", undoesBatchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a82" },
        description: 'Undid: Added "Colosseum" to the backlog',
        undone: false,
      },
      {
        batchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a82",
        fromSeq: 2,
        toSeq: 2,
        actorId: "dev-alice",
        occurredAt: "2026-07-08T12:01:00.000Z",
        origin: { kind: "user" },
        description: 'Added "Colosseum" to the backlog',
        undone: true,
      },
      {
        batchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81",
        fromSeq: 1,
        toSeq: 1,
        actorId: "dev-alice",
        occurredAt: "2026-07-08T12:00:00.000Z",
        origin: { kind: "user" },
        description: 'Created trip "Rome 2027"',
        undone: false,
      },
    ],
  };
}
