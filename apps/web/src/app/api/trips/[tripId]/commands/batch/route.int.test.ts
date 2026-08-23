import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";

const ACTOR_ID = "user-1";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: ACTOR_ID } })),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { POST } = await import("./route");

async function seedTrip() {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

// No beforeEach truncation: every test seeds its own randomUUID() tripId and
// every assertion reads back through that trip's response body — see
// eventStore.int.test.ts's comment and docs/testing-baseline.md (Phase 2
// Task 2.6).
describe("POST /api/trips/:id/commands/batch", () => {
  it("applies a batch and returns detail + history", async () => {
    const tripId = await seedTrip();
    const req = new Request(`http://test/api/trips/${tripId}/commands/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { type: "AddDay", tripId, dayId: randomUUID() },
          { type: "AddDay", tripId, dayId: randomUUID() },
        ],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.detail.days).toHaveLength(2);
    expect(
      body.history.entries.some((e: { description: string }) => e.description === "Added Day 1; Added Day 2"),
    ).toBe(true);
  });

  it("rejects a batch containing a non-batchable command", async () => {
    const tripId = await seedTrip();
    const req = new Request(`http://test/api/trips/${tripId}/commands/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ type: "UndoLastChange", tripId }] }),
    });
    const res = await POST(req, { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(400);
  });

  it("rejects a batch with a command tripId that doesn't match the URL", async () => {
    const tripId = await seedTrip();
    const req = new Request(`http://test/api/trips/${tripId}/commands/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ type: "AddDay", tripId: randomUUID(), dayId: randomUUID() }] }),
    });
    const res = await POST(req, { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(400);
  });
});
