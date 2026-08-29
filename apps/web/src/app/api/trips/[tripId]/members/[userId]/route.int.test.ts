import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TripAccess } from "@tc/contracts";
import { db } from "@/server/db/client";
import { executeTripCommand } from "@/server/commands";
import { effectiveMembers, grantMembership } from "@/server/access/members";

// KI-65. `revokeMembership` had exactly one production caller — `revokeInvite`
// — so a membership row from any other cause could only be cleared with SQL.
// The rows here are created by `grantMembership` directly, which is precisely
// the case the invite-revoke recovery path does NOT cover: there is no invite
// to revoke twice.

const OWNER = "members-route-owner";
const GUEST = "members-route-guest";
const EDITOR = "members-route-editor";
const STRANGER = "members-route-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { DELETE } = await import("./route");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — the convention the sibling route int tests use.
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Members" }, OWNER);
  return tripId;
}

async function addMember(tripId: string, userId: string, role: "viewer" | "editor" = "editor") {
  await grantMembership(db, {
    tripId,
    userId,
    role,
    invitedBy: OWNER,
    now: new Date().toISOString(),
  });
}

const remove = (tripId: string, userId: string) =>
  DELETE(new Request(`http://test/x`, { method: "DELETE" }), {
    params: Promise.resolve({ tripId, userId }),
  });

async function memberIds(tripId: string): Promise<string[]> {
  return (await effectiveMembers(db, tripId, [{ userId: OWNER, role: "owner" }])).map(
    (member) => member.userId,
  );
}

beforeEach(() => {
  currentUserId = OWNER;
});

describe("DELETE /api/trips/:tripId/members/:userId", () => {
  it("removes a membership that no invite can reach", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);
    expect(await memberIds(tripId)).toEqual([OWNER, GUEST]);

    const res = await remove(tripId, GUEST);

    expect(res.status).toBe(200);
    expect(await memberIds(tripId)).toEqual([OWNER]);
  });

  it("answers with the trip's access view, minus the person just removed", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);

    const res = await remove(tripId, GUEST);
    const body = (await res.json()) as { access: unknown };

    // The contract test: the response IS a TripAccess, parsed rather than
    // assumed, so the shape this endpoint promises is enforced here.
    const access = TripAccess.parse(body.access);
    expect(access.tripId).toBe(tripId);
    expect(access.myRole).toBe("owner");
    expect(access.members.map((member) => member.userId)).toEqual([OWNER]);
  });

  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);
    currentUserId = "";

    expect((await remove(tripId, GUEST)).status).toBe(401);
    expect(await memberIds(tripId)).toEqual([OWNER, GUEST]);
  });

  it("403s a stranger, without confirming the trip exists", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);
    currentUserId = STRANGER;

    expect((await remove(tripId, GUEST)).status).toBe(403);
    expect(await memberIds(tripId)).toEqual([OWNER, GUEST]);
  });

  // The guest list is not an editor's to manage (ADR-026 keeps invites owner-
  // only, and this is the third lever on the same thing). Narrow on purpose:
  // widening later is additive.
  it("403s an editor — removing people is the owner's lever", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, EDITOR, "editor");
    await addMember(tripId, GUEST);
    currentUserId = EDITOR;

    expect((await remove(tripId, GUEST)).status).toBe(403);
    expect(await memberIds(tripId)).toEqual([OWNER, EDITOR, GUEST]);
  });

  // The owner's membership comes from the planning log, not from a
  // `trip_memberships` row, so a delete would find nothing and report success.
  it("409s an attempt to remove the owner instead of silently doing nothing", async () => {
    const tripId = await seedTrip();

    const res = await remove(tripId, OWNER);

    expect(res.status).toBe(409);
    expect(await memberIds(tripId)).toEqual([OWNER]);
  });

  it("404s someone who is not a member, rather than reporting a removal", async () => {
    const tripId = await seedTrip();

    expect((await remove(tripId, STRANGER)).status).toBe(404);
  });

  it("404s the second removal of the same person", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);

    expect((await remove(tripId, GUEST)).status).toBe(200);
    expect((await remove(tripId, GUEST)).status).toBe(404);
  });

  it("takes the removed person's access with it", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, GUEST);
    const { requireTripAccess } = await import("@/server/access/trip-access");

    currentUserId = GUEST;
    expect("error" in (await requireTripAccess(tripId, "viewer"))).toBe(false);

    currentUserId = OWNER;
    await remove(tripId, GUEST);

    currentUserId = GUEST;
    const after = await requireTripAccess(tripId, "viewer");
    if (!("error" in after)) throw new Error("a removed member should not still have access");
    expect(after.error.status).toBe(403);
  });

  it("leaves the other members alone", async () => {
    const tripId = await seedTrip();
    await addMember(tripId, EDITOR, "editor");
    await addMember(tripId, GUEST, "viewer");

    await remove(tripId, GUEST);

    expect(await memberIds(tripId)).toEqual([OWNER, EDITOR]);
  });
});
