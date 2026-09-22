import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripEventsPage } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { appendToStream } from "@/server/eventStore";
import { db } from "@/server/db/client";
import { MAX_EVENTS_PER_POLL } from "@/server/broadcast";
import { createInvite, acceptInvite } from "@/server/access/invites";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";

const OWNER = "events-owner";
const GUEST = "events-guest";
const STRANGER = "events-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { GET } = await import("./route");

// No DB truncation: every test seeds its own randomUUID() trip — same
// convention as the sibling route int tests.
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Events" }, OWNER);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function addDay(tripId: string): Promise<void> {
  const result = await executeTripCommand(
    { type: "AddDay", tripId, dayId: randomUUID() },
    OWNER,
  );
  if (!result.ok) throw new Error("failed to add day");
}

async function join(tripId: string, role: "viewer" | "editor"): Promise<void> {
  const invite = await createInvite(tripId, OWNER, { email: null, role });
  const accepted = await acceptInvite(invite.token, GUEST);
  if (!accepted.ok) throw new Error(`failed to accept: ${accepted.error.message}`);
}

const params = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

function poll(tripId: string, after: number | string | null) {
  const qs = after === null ? "" : `?after=${after}`;
  return GET(new Request(`http://test/api/trips/${tripId}/events${qs}`), params(tripId));
}

async function pollBody(tripId: string, after: number): Promise<TripEventsPage> {
  const res = await poll(tripId, after);
  expect(res.status).toBe(200);
  return (await res.json()) as TripEventsPage;
}

// Seeding a trip by command mints no `users` row, so without this the owner's
// granted members cap to `viewer` on read and `POST /invites` refuses with 402.
// That is the entitlements gate working; this suite is about broadcast.
beforeAll(async () => {
  await entitleAccounts([OWNER]);
});

beforeEach(() => {
  currentUserId = OWNER;
});

describe("GET /api/trips/:id/events — access", () => {
  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    expect((await poll(tripId, 0)).status).toBe(401);
  });

  // ADR-049: receiving an event is reading, so it is the same question the
  // trip GET asks — and because every poll is a fresh request, this is also
  // what makes revocation mid-session bite on the next poll.
  it("403s a stranger", async () => {
    const tripId = await seedTrip();
    currentUserId = STRANGER;
    expect((await poll(tripId, 0)).status).toBe(403);
  });

  it("serves a viewer — receiving an edit is reading, not editing", async () => {
    const tripId = await seedTrip();
    await join(tripId, "viewer");
    currentUserId = GUEST;
    expect((await poll(tripId, 0)).status).toBe(200);
  });

  // M13's third gate box, at the route layer: the poll re-asks AccessPolicy
  // every time, so losing access stops delivery with no teardown path.
  it("stops serving a member whose membership is revoked between polls", async () => {
    const tripId = await seedTrip();
    await join(tripId, "editor");
    currentUserId = GUEST;
    expect((await poll(tripId, 0)).status).toBe(200);

    currentUserId = OWNER;
    const { DELETE } = await import("../members/[userId]/route");
    const removed = await DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, userId: GUEST }),
    });
    expect(removed.status).toBe(200);

    currentUserId = GUEST;
    expect((await poll(tripId, 0)).status).toBe(403);
  });
});

describe("GET /api/trips/:id/events — the cursor", () => {
  it("reports the head and hands back nothing when the caller is at it", async () => {
    const tripId = await seedTrip();
    const created = await pollBody(tripId, 0);
    expect(created.headSeq).toBe(1); // TripCreated
    expect(created.events).toHaveLength(1);

    const caughtUp = await pollBody(tripId, created.headSeq);
    expect(caughtUp).toEqual({ headSeq: 1, events: [], resync: false });
  });

  it("hands back only what committed after the cursor, in seq order", async () => {
    const tripId = await seedTrip();
    const before = await pollBody(tripId, 0);
    await addDay(tripId);
    await addDay(tripId);

    const page = await pollBody(tripId, before.headSeq);
    expect(page.headSeq).toBe(3);
    expect(page.resync).toBe(false);
    expect(page.events.map((e) => e.seq)).toEqual([2, 3]);
    expect(page.events.map((e) => e.type)).toEqual(["DayAdded", "DayAdded"]);
    // Every envelope is after the cursor — the cursor is exclusive.
    expect(page.events.every((e) => e.seq > before.headSeq)).toBe(true);
  });

  it("carries the fields a subscriber reconciles against, and no global_seq", async () => {
    const tripId = await seedTrip();
    const [envelope] = (await pollBody(tripId, 0)).events;
    expect(envelope).toBeDefined();
    expect(envelope).toMatchObject({ streamId: tripId, seq: 1, type: "TripCreated", version: 1 });
    expect(envelope!.batchId).toEqual(expect.any(String));
    expect(envelope!.origin).toEqual({ kind: "user" });
    // ADR-049 Decision 1: `global_seq` is not the cursor and is not on the
    // wire. If it ever appears here, the contract grew a field whose
    // commit-order visibility the client would be entitled to trust.
    expect(envelope).not.toHaveProperty("globalSeq");
    expect(envelope).not.toHaveProperty("global_seq");
  });

  // A revert can leave a client holding a seq the trip no longer has. The
  // honest answer is the head to resynchronise to, not a 4xx.
  it("answers a cursor ahead of the head with the head, not an error", async () => {
    const tripId = await seedTrip();
    const page = await pollBody(tripId, 999);
    expect(page).toEqual({ headSeq: 1, events: [], resync: false });
  });

  it("tells a caller further behind than one poll to resync, and sends no events", async () => {
    const tripId = await seedTrip();
    // Written through `appendToStream` rather than MAX+1 command round-trips:
    // this test is about the cap, and the cap counts envelopes on the stream.
    const extra = Array.from({ length: MAX_EVENTS_PER_POLL }, () => ({
      type: "DayAdded",
      version: 1,
      payload: { tripId, dayId: randomUUID() },
    }));
    const appended = await appendToStream(db, {
      streamId: tripId,
      expectedSeq: 1,
      events: extra,
      actorId: OWNER,
      occurredAt: new Date().toISOString(),
      batchId: randomUUID(),
      origin: { kind: "user" },
    });
    expect(appended.ok).toBe(true);

    const page = await pollBody(tripId, 0);
    expect(page.headSeq).toBe(MAX_EVENTS_PER_POLL + 1);
    expect(page.resync).toBe(true);
    expect(page.events).toEqual([]);

    // One inside the cap is served normally — the boundary is not off by one.
    const atCap = await pollBody(tripId, 1);
    expect(atCap.resync).toBe(false);
    expect(atCap.events).toHaveLength(MAX_EVENTS_PER_POLL);
  });
});

describe("GET /api/trips/:id/events — the `after` parameter", () => {
  // `Number("x")` is NaN and `seq > NaN` matches no row, so a coerced bad
  // cursor would be answered "nothing has happened" — a silent wrong answer.
  it.each([
    ["missing", null],
    ["empty", ""],
    ["not a number", "abc"],
    ["negative", "-1"],
    ["fractional", "1.5"],
  ])("400s an `after` that is %s", async (_label, value) => {
    const tripId = await seedTrip();
    expect((await poll(tripId, value)).status).toBe(400);
  });

  it("accepts 0 — a trip whose caller holds no cursor yet", async () => {
    const tripId = await seedTrip();
    expect((await poll(tripId, 0)).status).toBe(200);
  });
});

describe("GET /api/trips/:id/events — the demo trip", () => {
  // ADR-031: the demo is a fixture, not rows. It never moves, so there is
  // nothing to broadcast — but it still has a head, and a reader at that head
  // must be told it is caught up rather than handed a 0 it would read as being
  // behind forever.
  it("reports the fixture's head and never any events", async () => {
    currentUserId = "";
    const res = await poll(DEMO_TRIP_ID, 0);
    expect(res.status).toBe(200);
    const page = (await res.json()) as TripEventsPage;
    expect(page.headSeq).toBeGreaterThan(0);
    expect(page.events).toEqual([]);
    expect(page.resync).toBe(true);

    const caughtUp = (await (await poll(DEMO_TRIP_ID, page.headSeq)).json()) as TripEventsPage;
    expect(caughtUp).toEqual({ headSeq: page.headSeq, events: [], resync: false });
  });
});
