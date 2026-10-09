import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand, SuggestionChange } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createSuggestion } from "@/server/suggestions/create";
import { MAX_ACCEPT_BODY_BYTES } from "@/server/suggestions/http";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

let currentUserId = "";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { POST } = await import("./route");

// The rules are proven in `server/suggestions/suggestions.int.test.ts`. This
// file proves the wire: the body's contract, and a refusal naming its change.
let OWNER = "";
let SUGGESTER = "";
let tripId = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `sugg-accept-owner-${run}`;
  SUGGESTER = `sugg-accept-sam-${run}`;
  // A free owner's granted roles cap to viewer (M20 link 6).
  await entitleAccounts([OWNER]);
  tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
  await grantMembership(db, { tripId, userId: SUGGESTER, role: "suggester", invitedBy: OWNER, now: new Date().toISOString() });
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

const accept = (body: unknown) =>
  POST(
    new Request(`http://test/api/trips/${tripId}/suggestions/changes/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tripId }) },
  );

describe("POST /api/trips/:id/suggestions/changes/accept", () => {
  it("200s with every change it accepted, parents first", async () => {
    const dayId = randomUUID();
    const [day, stop] = await suggest(
      [{ type: "AddDay", tripId, dayId }],
      [{ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Tea ceremony" }],
    );
    const res = await accept({ changeIds: [stop!.id, day!.id] });
    expect(res.status).toBe(200);
    const { changes } = (await res.json()) as { changes: SuggestionChange[] };
    expect(changes.map((c) => [c.id, c.status])).toEqual([
      [day!.id, "accepted"],
      [stop!.id, "accepted"],
    ]);
  });

  it("401s without a session", async () => {
    currentUserId = "";
    expect((await accept({ changeIds: [randomUUID()] })).status).toBe(401);
  });

  it("400s an empty, repeated or non-uuid list", async () => {
    const id = randomUUID();
    for (const changeIds of [[], [id, id], ["accept"]]) {
      expect((await accept({ changeIds })).status).toBe(400);
    }
  });

  it("413s a body over its byte ceiling", async () => {
    const res = await accept({ changeIds: [randomUUID()], pad: "x".repeat(MAX_ACCEPT_BODY_BYTES) });
    expect(res.status).toBe(413);
  });

  it("names the change a refusal is about", async () => {
    const [change] = await suggest([{ type: "SetTripName", tripId, name: "x" }]);
    const unknown = randomUUID();
    const res = await accept({ changeIds: [change!.id, unknown] });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not-found", changeId: unknown });
  });
});
