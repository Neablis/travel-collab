import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { executeTripCommand } from "@/server/commands";
import { effectiveMembers, grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

// M26 link 6b, SPEC §27: "a trip someone shared with you offers Leave this
// trip". The sibling route (`members/[userId]`) is owner-only and could not
// express this; `members.ts` says so in as many words.

const OWNER = "membership-route-owner";
const GUEST = "membership-route-guest";
const STRANGER = "membership-route-stranger";

let currentUserId: string | null = GUEST;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { DELETE } = await import("./route");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — the convention every sibling route int test uses.
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER);
  return tripId;
}

async function addMember(tripId: string, userId: string, role: "viewer" | "editor" = "editor") {
  await grantMembership(db, { tripId, userId, role, invitedBy: OWNER, now: new Date().toISOString() });
}

const leave = (tripId: string) =>
  DELETE(new Request("http://test/x", { method: "DELETE" }), { params: Promise.resolve({ tripId }) });

async function memberIds(tripId: string): Promise<string[]> {
  return (await effectiveMembers(db, tripId, [{ userId: OWNER, role: "owner" }])).map((m) => m.userId);
}

// The trip's owner has to be able to collaborate at all, or granted members cap
// to `viewer` on read — the entitlements gate working, and not what this suite
// is about. Same reason as the sibling suite's.
beforeAll(async () => {
  await entitleAccounts([OWNER]);
});

beforeEach(() => {
  currentUserId = GUEST;
});

describe("DELETE /api/trips/:tripId/membership", () => {
  it("takes the caller off a trip they were invited to", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);
    expect(await memberIds(tripId)).toContain(GUEST);

    const res = await leave(tripId);
    expect(res.status).toBe(200);
    // Not the trip's member list: whoever just left is no longer entitled to
    // read it, and the caller's next act is to drop the card.
    expect(await res.json()).toEqual({ ok: true });
    expect(await memberIds(tripId)).not.toContain(GUEST);
  });

  it("leaves everyone else on the trip exactly where they were", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);
    await addMember(tripId, "membership-route-other", "viewer");

    expect((await leave(tripId)).status).toBe(200);

    const after = await memberIds(tripId);
    expect(after).toContain(OWNER);
    expect(after).toContain("membership-route-other");
    expect(after).not.toContain(GUEST);
  });

  it("refuses the owner with 409 and names the verb that would work", async () => {
    const tripId = await seedTrip();
    currentUserId = OWNER;

    const res = await leave(tripId);
    // 409, not 403: the caller IS allowed to act on this trip. It is this
    // particular membership that cannot be expressed as a row — it comes from
    // `TripCreated` — so a 403 would send an owner looking for a permission.
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Delete it instead/);
    expect(await memberIds(tripId)).toContain(OWNER);
  });

  it("refuses somebody who is not on the trip at all", async () => {
    const tripId = await seedTrip();
    currentUserId = STRANGER;

    // The access check answers first, and it answers 403 — a stranger cannot
    // even see this trip, so they are told nothing about it.
    expect((await leave(tripId)).status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const tripId = await seedTrip();
    currentUserId = null;

    expect((await leave(tripId)).status).toBe(401);
  });
});
