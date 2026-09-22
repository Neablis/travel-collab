import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { tripDetails } from "@/server/db/schema";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { GET } = await import("./route");

async function seedTrip() {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

// No DB truncation: every test seeds its own randomUUID() tripId and every
// assertion reads back through that trip's response body — see
// eventStore.int.test.ts's comment and docs/testing-baseline.md (Phase 2
// Task 2.6). currentUserId still resets every test — that's mock auth state,
// not DB state.
describe("GET /api/trips/:id", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
  });

  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(401);
  });

  it("403s for a non-member", async () => {
    const tripId = await seedTrip();
    currentUserId = OUTSIDER_ID;
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(403);
  });

  it("404s when the trip does not exist", async () => {
    const tripId = randomUUID();
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(404);
  });

  it("returns a trip detail for a member", async () => {
    const tripId = await seedTrip();
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trip.tripId).toBe(tripId);
    expect(body.trip.name).toBe("Rome 2027");
  });

  it("returns a deleted trip with status rather than 404", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Doomed" }, ACTOR_ID);
    await executeTripCommand({ type: "DeleteTrip", tripId }, ACTOR_ID);

    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trip.status).toBe("deleted");
  });
});

// M13 link 5 — the gate box's "set through the UI, and read back off the API".
// This covers the read-back half against the real command path; the UI half is
// `ActivityEditor.test.tsx`.
describe("per-stop attribution round-trips through the API (M13 link 5)", () => {
  it("reads back who booked a stop and who is going", async () => {
    const tripId = randomUUID();
    const activityId = randomUUID();
    const created = await executeTripCommand(
      { type: "CreateTrip", tripId, name: "Attribution" },
      ACTOR_ID,
    );
    expect(created.ok).toBe(true);
    const added = await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId,
        title: "Colosseum",
        bookedBy: ACTOR_ID,
        participants: [ACTOR_ID, "bob"],
      },
      ACTOR_ID,
    );
    expect(added.ok).toBe(true);

    const res = await GET(new Request("http://test/x"), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trip: { activities: Record<string, unknown> } };
    expect(body.trip.activities[activityId]).toMatchObject({
      bookedBy: ACTOR_ID,
      participants: [ACTOR_ID, "bob"],
    });
  });

  // A stop stored before attribution existed has neither key, and a row is only
  // rewritten when its trip next changes — so the contract's defaults are what
  // let it be read at all. This is the #71 shape (a required `kind` taking out
  // every untouched pre-M18 trip), one field later.
  it("reads a pre-attribution activity back as unattributed rather than 500ing", async () => {
    const tripId = randomUUID();
    const activityId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Legacy" }, ACTOR_ID);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId, title: "Forum" },
      ACTOR_ID,
    );
    // Strip the keys from the stored projection, exactly as a document written
    // before this field existed would have them.
    const [row] = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
    const doc = row!.doc as unknown as {
      activities: Record<string, Record<string, unknown>>;
    };
    delete doc.activities[activityId]!.bookedBy;
    delete doc.activities[activityId]!.participants;
    await db.update(tripDetails).set({ doc: doc as never }).where(eq(tripDetails.tripId, tripId));

    const res = await GET(new Request("http://test/x"), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trip: { activities: Record<string, unknown> } };
    expect(body.trip.activities[activityId]).toMatchObject({ bookedBy: null, participants: [] });
  });
});
