import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand, TripSuggestionsResponse } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

let currentUserId = "";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { GET, POST } = await import("./route");

// The module's rules are proven in `server/suggestions/suggestions.int.test.ts`
// (T4). This file proves only that each refusal reaches the wire as its status.
let OWNER = "";
let SUGGESTER = "";
let VIEWER = "";
let tripId = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `sugg-route-owner-${run}`;
  SUGGESTER = `sugg-route-sam-${run}`;
  VIEWER = `sugg-route-vera-${run}`;
  // A free owner's granted roles cap to viewer (M20 link 6).
  await entitleAccounts([OWNER]);
  tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
  for (const [userId, role] of [[SUGGESTER, "suggester"], [VIEWER, "viewer"]] as const) {
    await grantMembership(db, { tripId, userId, role, invitedBy: OWNER, now: new Date().toISOString() });
  }
  currentUserId = SUGGESTER;
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [OWNER]));
});

const at = () => ({ params: Promise.resolve({ tripId }) });
const rename = (name: string, trip = tripId): BatchableCommand => ({ type: "SetTripName", tripId: trip, name });

const list = () => GET(new Request(`http://test/api/trips/${tripId}/suggestions`), at());
const send = (body: unknown) =>
  POST(
    new Request(`http://test/api/trips/${tripId}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    at(),
  );

describe("POST /api/trips/:id/suggestions", () => {
  it("201s with one change per unit", async () => {
    const res = await send({ units: [{ commands: [rename("Kyoto in spring")] }] });
    expect(res.status).toBe(201);
    const { changes } = await res.json();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ tripId, authorId: SUGGESTER, status: "pending" });
  });

  it("401s without a session", async () => {
    currentUserId = "";
    expect((await send({ units: [{ commands: [rename("x")] }] })).status).toBe(401);
  });

  it("400s a body the contract refuses, and one that is not JSON", async () => {
    expect((await send({ units: [] })).status).toBe(400);
    expect((await send("{not json")).status).toBe(400);
  });

  it.each([
    ["not-found", 404, () => `sugg-route-stranger-${randomUUID()}`, () => [rename("x")]],
    ["forbidden", 403, () => OWNER, () => [rename("x")]],
    ["invalid", 400, () => SUGGESTER, () => [rename("x", randomUUID())]],
  ] as const)("maps %s to %i", async (code, status, actor, commands) => {
    currentUserId = actor();
    const res = await send({ units: [{ commands: commands() }] });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it("maps does-not-apply to 422, naming the unit", async () => {
    const res = await send({
      units: [
        { commands: [rename("Kyoto in spring")] },
        { commands: [{ type: "RemoveActivity", tripId, activityId: randomUUID() }] },
      ],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "does-not-apply", index: 1 });
  });
});

describe("GET /api/trips/:id/suggestions", () => {
  it("serves the reader's changes and their rev", async () => {
    await send({ units: [{ commands: [rename("Kyoto in spring")] }] });
    const res = await list();
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripSuggestionsResponse;
    expect(body.changes).toHaveLength(1);
    expect(body.rev).toEqual(expect.any(String));
  });

  it("401s without a session", async () => {
    currentUserId = "";
    expect((await list()).status).toBe(401);
  });

  // Plan T5: a viewer is answered as if there were nothing here.
  it("404s a viewer", async () => {
    currentUserId = VIEWER;
    const res = await list();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not-found" });
  });
});
