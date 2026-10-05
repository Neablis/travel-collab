import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InviteRole } from "@tc/contracts";
import { db } from "../db/client";
import { users } from "../db/schema";
import { executeTripCommand } from "../commands";
import { getTripDetail } from "../projections";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { acceptInvite, createInvite, listInvites, revokeInvite } from "./invites";
import {
  accessRevFor,
  effectiveMembers,
  grantMembership,
  removeMember,
  travellingByUser,
  writeTravelling,
} from "./members";
import { changeRole, setTravelling } from "./travellers";

// Who is travelling (travellers spec D1–D4, D8, D11). Fresh identities per
// test, for the reasons invites.int.test.ts gives (KI-69).
let OWNER = "";
let GUEST = "";
let CARA = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `dev-owner-${run}`;
  GUEST = `dev-guest-${run}`;
  CARA = `dev-cara-${run}`;
  // The owner collaborates, so granted roles are not capped to viewer on read.
  await entitleAccounts([OWNER]);
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [OWNER, GUEST, CARA]));
});

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER);
  expect(created.ok).toBe(true);
  return tripId;
}

async function members(tripId: string) {
  const detail = (await getTripDetail(tripId))!;
  return effectiveMembers(db, tripId, detail.members);
}

/** A trip with GUEST on it at `role`, through an invite, as the product does it. */
async function seedWithGuest(role: InviteRole, travelling?: boolean): Promise<string> {
  const tripId = await seedTrip();
  const invite = await createInvite(tripId, OWNER, { email: null, role, travelling });
  expect((await acceptInvite(invite.token, GUEST)).ok).toBe(true);
  return tripId;
}

describe("the invite's travelling choice (D3)", () => {
  it.each([
    ["editor", true],
    ["suggester", false],
    ["viewer", false],
  ] as const)("presets a %s invite to travelling=%s when the owner does not choose", async (role, expected) => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role });
    expect(invite.travelling).toBe(expected);
    // Stored, not just echoed: the list reads it back from the column.
    expect((await listInvites(tripId)).map((i) => i.travelling)).toEqual([expected]);
  });

  it("keeps the owner's explicit choice over the role's preset", async () => {
    const tripId = await seedTrip();
    const editor = await createInvite(tripId, OWNER, { email: null, role: "editor", travelling: false });
    const viewer = await createInvite(tripId, OWNER, { email: null, role: "viewer", travelling: true });
    expect([editor.travelling, viewer.travelling]).toEqual([false, true]);
  });

  it("joins the guest not travelling when the invite says so, and travelling otherwise", async () => {
    const notTravelling = await seedWithGuest("editor", false);
    expect(await members(notTravelling)).toEqual([
      { userId: OWNER, role: "owner", travelling: true },
      { userId: GUEST, role: "editor", travelling: false },
    ]);
    const travelling = await seedWithGuest("suggester", true);
    expect((await members(travelling)).map((m) => m.travelling)).toEqual([true, true]);
  });
});

describe("setTravelling (D4)", () => {
  it("lets a member change it for themselves", async () => {
    const tripId = await seedWithGuest("viewer");
    expect(await setTravelling(tripId, GUEST, GUEST, true)).toMatchObject({ ok: true });
    expect((await members(tripId)).find((m) => m.userId === GUEST)?.travelling).toBe(true);
  });

  it("lets the owner change it for anyone, themselves included (D5)", async () => {
    const tripId = await seedWithGuest("editor");
    expect(await setTravelling(tripId, OWNER, GUEST, false)).toMatchObject({ ok: true });
    expect(await setTravelling(tripId, OWNER, OWNER, false)).toMatchObject({ ok: true });
    expect((await members(tripId)).map((m) => m.travelling)).toEqual([false, false]);
  });

  it("refuses a member changing it for someone else, editor or not", async () => {
    const tripId = await seedWithGuest("editor");
    const result = await setTravelling(tripId, GUEST, OWNER, false);
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect((await members(tripId)).map((m) => m.travelling)).toEqual([true, true]);
  });

  it("refuses a target who is not on the trip, and an actor who is not either", async () => {
    const tripId = await seedWithGuest("editor");
    expect(await setTravelling(tripId, OWNER, CARA, false)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await setTravelling(tripId, CARA, CARA, false)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});

describe("changeRole (D8)", () => {
  it("lets the owner change a member's role in place", async () => {
    const tripId = await seedWithGuest("viewer");
    expect(await changeRole(tripId, OWNER, GUEST, "editor")).toMatchObject({ ok: true });
    expect((await members(tripId)).find((m) => m.userId === GUEST)?.role).toBe("editor");
  });

  it("refuses anyone but the owner, an editor included", async () => {
    const tripId = await seedWithGuest("editor");
    await grantMembership(db, { tripId, userId: CARA, role: "viewer", invitedBy: OWNER, now: new Date().toISOString() });
    expect(await changeRole(tripId, GUEST, CARA, "editor")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await members(tripId)).find((m) => m.userId === CARA)?.role).toBe("viewer");
  });

  it("refuses to target the owner", async () => {
    const tripId = await seedTrip();
    expect(await changeRole(tripId, OWNER, OWNER, "viewer")).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect((await members(tripId))[0]).toMatchObject({ userId: OWNER, role: "owner" });
  });

  it("refuses someone with no membership row", async () => {
    const tripId = await seedTrip();
    expect(await changeRole(tripId, OWNER, CARA, "editor")).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("leaving and coming back", () => {
  it("a member removed and re-invited starts from the new invite's choice", async () => {
    const tripId = await seedWithGuest("editor", false);
    const detail = (await getTripDetail(tripId))!;
    expect(await removeMember(tripId, GUEST, detail.members)).toBe("removed");
    // Gone with the membership, not merely overridden by the next accept.
    expect((await travellingByUser(db, tripId)).has(GUEST)).toBe(false);

    const again = await createInvite(tripId, OWNER, { email: null, role: "editor", travelling: true });
    expect((await acceptInvite(again.token, GUEST)).ok).toBe(true);
    expect((await members(tripId)).find((m) => m.userId === GUEST)?.travelling).toBe(true);
  });

  it("so does one whose accepted invite was revoked", async () => {
    const tripId = await seedTrip();
    const first = await createInvite(tripId, OWNER, { email: null, role: "editor", travelling: false });
    expect((await acceptInvite(first.token, GUEST)).ok).toBe(true);
    expect((await revokeInvite(tripId, first.inviteId)).ok).toBe(true);
    expect((await travellingByUser(db, tripId)).has(GUEST)).toBe(false);

    const again = await createInvite(tripId, OWNER, { email: null, role: "editor", travelling: true });
    expect((await acceptInvite(again.token, GUEST)).ok).toBe(true);
    expect((await members(tripId)).find((m) => m.userId === GUEST)?.travelling).toBe(true);
  });

  it("joins with the invite's yes even over a row a racing toggle left behind", async () => {
    const tripId = await seedTrip();
    // What a `setTravelling` that read the member list just before a remove
    // committed could leave: a row for someone no longer on the trip.
    await writeTravelling(db, {
      tripId,
      userId: GUEST,
      travelling: false,
      updatedBy: OWNER,
      now: new Date().toISOString(),
    });
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor", travelling: true });
    expect((await acceptInvite(invite.token, GUEST)).ok).toBe(true);
    expect((await members(tripId)).find((m) => m.userId === GUEST)?.travelling).toBe(true);
  });
});

describe("accessRevFor (D11)", () => {
  /** Runs `change` and asserts the trip's access revision moved because of it. */
  async function expectBump(tripId: string, change: () => Promise<unknown>): Promise<void> {
    const before = await accessRevFor(tripId);
    await change();
    expect(await accessRevFor(tripId)).not.toBe(before);
  }

  it("moves on every Access write: invite, accept, travelling, role, revoke, remove, leave", async () => {
    const tripId = await seedTrip();
    let token = "";
    let inviteId = "";
    await expectBump(tripId, async () => {
      ({ token, inviteId } = await createInvite(tripId, OWNER, { email: null, role: "viewer" }));
    });
    await expectBump(tripId, () => acceptInvite(token, GUEST));
    await expectBump(tripId, () => setTravelling(tripId, GUEST, GUEST, true));
    await expectBump(tripId, () => changeRole(tripId, OWNER, GUEST, "editor"));
    await expectBump(tripId, () => revokeInvite(tripId, inviteId));

    const detail = (await getTripDetail(tripId))!;
    const second = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    expect((await acceptInvite(second.token, CARA)).ok).toBe(true);
    await expectBump(tripId, () => removeMember(tripId, CARA, detail.members));

    // Leaving is `removeMember` with yourself as the target (the membership
    // route), so it bumps by the same call; asserted so a separate leave path
    // added later has a test that names it.
    const third = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    expect((await acceptInvite(third.token, GUEST)).ok).toBe(true);
    await expectBump(tripId, () => removeMember(tripId, GUEST, detail.members));
  });

  it("does not move on a refused write", async () => {
    const tripId = await seedWithGuest("editor");
    const before = await accessRevFor(tripId);
    await setTravelling(tripId, GUEST, OWNER, false);
    await changeRole(tripId, GUEST, OWNER, "viewer");
    expect(await accessRevFor(tripId)).toBe(before);
  });

  it("is per trip", async () => {
    const tripId = await seedTrip();
    const other = await seedTrip();
    await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    expect(await accessRevFor(tripId)).not.toBe("0");
    // A trip no Access write has touched reads "0", whatever other trips did.
    expect(await accessRevFor(other)).toBe("0");
  });
});
