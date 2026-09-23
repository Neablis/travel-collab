import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { events } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";

const ACTOR_ID = "user-1";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: ACTOR_ID } })),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { POST } = await import("./route");

// Adds a day and returns the batch that did it — the id an assistant card
// records on apply and later sends as its Undo's precondition.
async function addDay(tripId: string) {
  const result = await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, ACTOR_ID);
  if (!result.ok) throw new Error(`AddDay refused: ${result.error.code}`);
  return result.history.entries[0]!.batchId;
}

const undo = (tripId: string, undoesBatchId: string) =>
  POST(
    new Request(`http://test/api/trips/${tripId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "UndoLastChange", tripId, undoesBatchId }),
    }),
    { params: Promise.resolve({ tripId }) },
  );

const eventsOf = (tripId: string) => db.select().from(events).where(eq(events.streamId, tripId));

// M27 D17, enforced where the decision is made: the client's "is it still the
// last change?" reads a history that can be a poll interval old.
describe("POST /api/trips/:id/commands — UndoLastChange with undoesBatchId", () => {
  it("refuses 409 undo-target-changed, appending nothing, once another change is on top", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
    const mine = await addDay(tripId);
    await addDay(tripId); // lands between the card's render and its Undo
    const before = await eventsOf(tripId);

    const res = await undo(tripId, mine);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("undo-target-changed");
    expect(await eventsOf(tripId)).toHaveLength(before.length);
  });

  it("undoes the named batch while it is on top, and records it as the origin", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
    const mine = await addDay(tripId);

    const res = await undo(tripId, mine);

    expect(res.status).toBe(200);
    const rows = await eventsOf(tripId);
    expect(rows.at(-1)!.origin).toEqual({ kind: "undo", undoesBatchId: mine });
  });
});
