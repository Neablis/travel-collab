import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { acceptInvite, createInvite } from "@/server/access/invites";

const OWNER = "saved-route-owner";
const GUEST = "saved-route-guest";
const STRANGER = "saved-route-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, POST } = await import("./route");
const { DELETE } = await import("./[savedDayId]/route");
const { POST: INSERT } = await import("../trips/[tripId]/saved-days/[savedDayId]/route");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — the convention the sibling route int tests use.
async function seedDay(owner = OWNER): Promise<{ tripId: string; dayId: string }> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Saved" }, owner);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, owner);
  await executeTripCommand(
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Ramen" },
    owner,
  );
  return { tripId, dayId };
}

const post = (body: unknown) =>
  POST(new Request("http://test/x", { method: "POST", body: JSON.stringify(body) }));

async function save(tripId: string, dayId: string, name = "A day"): Promise<string> {
  const res = await post({ name, tripId, dayId });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { savedDay: { savedDayId: string } };
  return body.savedDay.savedDayId;
}

beforeEach(() => {
  currentUserId = OWNER;
});

describe("POST /api/saved-days", () => {
  it("401s when unauthenticated", async () => {
    const { tripId, dayId } = await seedDay();
    currentUserId = "";
    expect((await post({ name: "A day", tripId, dayId })).status).toBe(401);
  });

  it("400s a malformed body before it looks at any trip", async () => {
    expect((await post({ name: "" })).status).toBe(400);
  });

  it("403s someone who has never been let into the trip", async () => {
    const { tripId, dayId } = await seedDay();
    currentUserId = STRANGER;
    expect((await post({ name: "A day", tripId, dayId })).status).toBe(403);
  });

  // `viewer`, matching cloning (ADR-028): saving copies what you can already
  // read and takes nothing from the source.
  it("lets a viewer keep a day out of a trip they can read", async () => {
    const { tripId, dayId } = await seedDay();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    await acceptInvite(invite.token, GUEST);
    currentUserId = GUEST;
    expect((await post({ name: "Theirs, kept by me", tripId, dayId })).status).toBe(201);
  });
});

describe("GET /api/saved-days", () => {
  it("serves only the caller's own library", async () => {
    const { tripId, dayId } = await seedDay();
    await save(tripId, dayId, `Mine ${Date.now()}`);

    currentUserId = STRANGER;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { savedDays: { name: string }[] };
    expect(body.savedDays.every((d) => !d.name.startsWith("Mine "))).toBe(true);
  });

  it("401s when unauthenticated", async () => {
    currentUserId = "";
    expect((await GET()).status).toBe(401);
  });
});

describe("DELETE /api/saved-days/:id", () => {
  it("404s someone else's saved day, and deletes your own", async () => {
    const { tripId, dayId } = await seedDay();
    const savedDayId = await save(tripId, dayId);

    currentUserId = STRANGER;
    const del = (id: string) =>
      DELETE(new Request("http://test/x", { method: "DELETE" }), {
        params: Promise.resolve({ savedDayId: id }),
      });
    expect((await del(savedDayId)).status).toBe(404);

    currentUserId = OWNER;
    expect((await del(savedDayId)).status).toBe(200);
    expect((await del(savedDayId)).status).toBe(404);
  });
});

describe("POST /api/trips/:tripId/saved-days/:savedDayId", () => {
  const insert = (tripId: string, savedDayId: string) =>
    INSERT(new Request("http://test/x", { method: "POST" }), {
      params: Promise.resolve({ tripId, savedDayId }),
    });

  it("appends the saved day to a trip you can edit", async () => {
    const { tripId, dayId } = await seedDay();
    const savedDayId = await save(tripId, dayId);

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Target" }, OWNER);

    const res = await insert(targetId, savedDayId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { detail: { days: unknown[] } };
    expect(body.detail.days).toHaveLength(1);
  });

  // Two different checks: `editor` on the target trip, and ownership of the
  // saved day. Each is exercised on its own.
  it("403s a viewer on the target trip", async () => {
    const { tripId, dayId } = await seedDay();
    const savedDayId = await save(tripId, dayId);

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Theirs" }, STRANGER);
    const invite = await createInvite(targetId, STRANGER, { email: null, role: "viewer" });
    await acceptInvite(invite.token, OWNER);

    expect((await insert(targetId, savedDayId)).status).toBe(403);
  });

  it("404s a saved day that is not yours, even on your own trip", async () => {
    const { tripId, dayId } = await seedDay();
    const savedDayId = await save(tripId, dayId);

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Mine" }, GUEST);
    currentUserId = GUEST;
    expect((await insert(targetId, savedDayId)).status).toBe(404);
  });
});
