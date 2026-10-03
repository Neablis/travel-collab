import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand, SuggestionChange } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createSuggestion } from "@/server/suggestions/create";
import { MAX_RESOLVE_BODY_BYTES } from "@/server/suggestions/http";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

let currentUserId = "";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { POST } = await import("./route");

// The module's rules are proven in `server/suggestions/suggestions.int.test.ts`
// (T4). This file proves only that each refusal reaches the wire as its status.
let OWNER = "";
let SUGGESTER = "";
let VIEWER = "";
let tripId = "";
let stopId = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `sugg-change-owner-${run}`;
  SUGGESTER = `sugg-change-sam-${run}`;
  VIEWER = `sugg-change-vera-${run}`;
  // A free owner's granted roles cap to viewer (M20 link 6).
  await entitleAccounts([OWNER]);
  tripId = randomUUID();
  stopId = randomUUID();
  const dayId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
  const seeded = await executeTripCommandBatch(
    [
      { type: "AddDay", tripId, dayId },
      { type: "AddActivity", tripId, activityId: stopId, dayId, title: "Fushimi Inari" },
    ],
    OWNER,
  );
  expect(seeded.ok).toBe(true);
  for (const [userId, role] of [[SUGGESTER, "suggester"], [VIEWER, "viewer"]] as const) {
    await grantMembership(db, { tripId, userId, role, invitedBy: OWNER, now: new Date().toISOString() });
  }
  currentUserId = OWNER;
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [OWNER]));
});

async function suggest(...units: BatchableCommand[][]): Promise<SuggestionChange[]> {
  const created = await createSuggestion(tripId, SUGGESTER, { units: units.map((commands) => ({ commands })) });
  if (!created.ok) throw new Error(`seeding a suggestion failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

/** A day, then a stop on it: the second depends on the first (spec W9). */
function dependentPair(): Promise<SuggestionChange[]> {
  const dayId = randomUUID();
  return suggest(
    [{ type: "AddDay", tripId, dayId }],
    [{ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Tea ceremony" }],
  );
}

const resolve = (changeId: string, body: unknown) =>
  POST(
    new Request(`http://test/api/trips/${tripId}/suggestions/changes/${changeId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tripId, changeId }) },
  );

async function expectRefusal(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ code });
}

describe("POST /api/trips/:id/suggestions/changes/:changeId", () => {
  it("200s with every change it resolved, the named one first", async () => {
    const [day, stop] = await dependentPair();
    const res = await resolve(day!.id, { action: "dismiss" });
    expect(res.status).toBe(200);
    const { changes } = (await res.json()) as { changes: SuggestionChange[] };
    expect(changes.map((c) => [c.id, c.status])).toEqual([
      [day!.id, "dismissed"],
      [stop!.id, "dismissed"],
    ]);
  });

  it("401s without a session", async () => {
    const [change] = await suggest([{ type: "SetTripName", tripId, name: "x" }]);
    currentUserId = "";
    expect((await resolve(change!.id, { action: "accept" })).status).toBe(401);
  });

  it("400s an action the contract does not name", async () => {
    const [change] = await suggest([{ type: "SetTripName", tripId, name: "x" }]);
    expect((await resolve(change!.id, { action: "approve" })).status).toBe(400);
  });

  // Spec W54. Padding the body past the ceiling with a field the contract
  // would strip: without the cap this is an ordinary dismiss.
  it("413s a body over its byte ceiling and resolves nothing", async () => {
    const [change] = await suggest([{ type: "SetTripName", tripId, name: "x" }]);
    const res = await resolve(change!.id, { action: "dismiss", pad: "x".repeat(MAX_RESOLVE_BODY_BYTES) });
    expect(res.status).toBe(413);
    expect((await resolve(change!.id, { action: "dismiss" })).status).toBe(200);
  });

  it("maps not-found to 404", async () => {
    await expectRefusal(await resolve(randomUUID(), { action: "accept" }), 404, "not-found");
  });

  it("maps forbidden to 403", async () => {
    const [change] = await suggest([{ type: "SetTripName", tripId, name: "x" }]);
    currentUserId = VIEWER;
    await expectRefusal(await resolve(change!.id, { action: "accept" }), 403, "forbidden");
  });

  it("maps dependency-pending to 409", async () => {
    const [, stop] = await dependentPair();
    await expectRefusal(await resolve(stop!.id, { action: "accept" }), 409, "dependency-pending");
  });

  it("maps already-resolved to 409", async () => {
    const [change] = await suggest([{ type: "SetTripName", tripId, name: "x" }]);
    expect((await resolve(change!.id, { action: "dismiss" })).status).toBe(200);
    await expectRefusal(await resolve(change!.id, { action: "dismiss" }), 409, "already-resolved");
  });

  it("maps no-longer-applies to 409", async () => {
    const [change] = await suggest([{ type: "RemoveActivity", tripId, activityId: stopId }]);
    expect((await executeTripCommand({ type: "RemoveActivity", tripId, activityId: stopId }, OWNER)).ok).toBe(true);
    await expectRefusal(await resolve(change!.id, { action: "accept" }), 409, "no-longer-applies");
  });
});
