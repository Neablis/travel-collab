import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { users } from "../db/schema";
import { executeTripCommand } from "../commands";
import { getTripDetail } from "../projections";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { acceptInvite, createInvite } from "./invites";
import { accessRevFor, removeMember } from "./members";
import { addGuest, linkGuest, listGuests, removeGuest, unlinkGuest, updateGuest } from "./guests";

// Named guests with no account (guests spec P1). Fresh identities per test,
// for the reasons invites.int.test.ts gives (KI-69).
let OWNER = "";
let ED = "";
let VIEW = "";
let OUT = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `dev-owner-${run}`;
  ED = `dev-ed-${run}`;
  VIEW = `dev-view-${run}`;
  OUT = `dev-out-${run}`;
  // The owner collaborates, so granted roles are not capped to viewer on read.
  await entitleAccounts([OWNER]);
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [OWNER, ED, VIEW, OUT]));
});

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER);
  expect(created.ok).toBe(true);
  return tripId;
}

/** A trip with ED as editor and VIEW as viewer, through invites, as the product does it. */
async function seedWithCrew(): Promise<string> {
  const tripId = await seedTrip();
  const ed = await createInvite(tripId, OWNER, { email: null, role: "editor" });
  expect((await acceptInvite(ed.token, ED)).ok).toBe(true);
  const view = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
  expect((await acceptInvite(view.token, VIEW)).ok).toBe(true);
  return tripId;
}

describe("addGuest", () => {
  it("adds a guest with a trimmed name, travelling by default, unlinked", async () => {
    const tripId = await seedTrip();
    const added = await addGuest(tripId, "  Baby  ", OWNER);
    expect(added.ok).toBe(true);
    expect(added.ok && added.value).toMatchObject({
      tripId,
      name: "Baby",
      travelling: true,
      linkedUserId: null,
      createdBy: OWNER,
    });
    expect(added.ok && added.value.guestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("lists the trip's guests in the order they were added", async () => {
    const tripId = await seedTrip();
    await addGuest(tripId, "Baby", OWNER);
    await addGuest(tripId, "Grandma", OWNER);
    expect((await listGuests(tripId)).map((g) => g.name)).toEqual(["Baby", "Grandma"]);
  });

  it("lets an editor add a guest — anyone with edit (Mitchell)", async () => {
    const tripId = await seedWithCrew();
    expect((await addGuest(tripId, "Baby", ED)).ok).toBe(true);
  });

  it("refuses a viewer, and a stranger", async () => {
    const tripId = await seedWithCrew();
    expect(await addGuest(tripId, "Baby", VIEW)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await addGuest(tripId, "Baby", OUT)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await listGuests(tripId)).toEqual([]);
  });

  it("refuses an empty name, a whitespace-only name, and a name over 120 chars", async () => {
    const tripId = await seedTrip();
    for (const name of ["", "   ", "x".repeat(121)]) {
      expect(await addGuest(tripId, name, OWNER)).toMatchObject({
        ok: false,
        error: { code: "invalid" },
      });
    }
    expect(await listGuests(tripId)).toEqual([]);
  });

  it("refuses a trip that does not exist", async () => {
    expect(await addGuest(randomUUID(), "Baby", OWNER)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("updateGuest", () => {
  it("renames and toggles travelling, trimming the name", async () => {
    const tripId = await seedTrip();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    const updated = await updateGuest(tripId, guestId, { name: "  The Baby  ", travelling: false }, OWNER);
    expect(updated.ok && updated.value).toMatchObject({ name: "The Baby", travelling: false });
    expect((await listGuests(tripId))[0]).toMatchObject({ name: "The Baby", travelling: false });
  });

  it("applies a name-only patch, leaving travelling alone", async () => {
    const tripId = await seedTrip();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    await updateGuest(tripId, guestId, { travelling: false }, OWNER);
    const updated = await updateGuest(tripId, guestId, { name: "Grandma" }, OWNER);
    expect(updated.ok && updated.value).toMatchObject({ name: "Grandma", travelling: false });
  });

  it("lets an editor update, refuses a viewer — and the row is unchanged", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await updateGuest(tripId, guestId, { name: "X" }, ED)).ok).toBe(true);
    expect(await updateGuest(tripId, guestId, { name: "Y" }, VIEW)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await listGuests(tripId))[0]?.name).toBe("X");
  });

  it("refuses an invalid name and an unknown guest id", async () => {
    const tripId = await seedTrip();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect(await updateGuest(tripId, guestId, { name: "  " }, OWNER)).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(await updateGuest(tripId, randomUUID(), { name: "X" }, OWNER)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("removeGuest", () => {
  it("removes the guest and answers the removed record", async () => {
    const tripId = await seedTrip();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    const removed = await removeGuest(tripId, guestId, OWNER);
    expect(removed.ok && removed.value).toMatchObject({ guestId, name: "Baby" });
    expect(await listGuests(tripId)).toEqual([]);
  });

  it("lets an editor remove, refuses a viewer — and the guest stays", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect(await removeGuest(tripId, guestId, VIEW)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await listGuests(tripId)).map((g) => g.guestId)).toEqual([guestId]);
    expect((await removeGuest(tripId, guestId, ED)).ok).toBe(true);
    expect(await listGuests(tripId)).toEqual([]);
  });

  it("refuses an unknown guest id", async () => {
    const tripId = await seedTrip();
    expect(await removeGuest(tripId, randomUUID(), OWNER)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("linkGuest", () => {
  it("lets the owner link a guest to a member", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    const linked = await linkGuest(tripId, guestId, VIEW, OWNER);
    expect(linked.ok && linked.value.linkedUserId).toBe(VIEW);
  });

  it("lets a member link a guest to themselves — the self-claim flow", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await linkGuest(tripId, guestId, VIEW, VIEW)).ok).toBe(true);
    expect((await listGuests(tripId))[0]?.linkedUserId).toBe(VIEW);
  });

  it("refuses a member linking for someone else, and a stranger claiming anything", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect(await linkGuest(tripId, guestId, ED, VIEW)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    // OUT is not on the trip at all: not a member, so no self-claim either.
    expect(await linkGuest(tripId, guestId, OUT, OUT)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await listGuests(tripId))[0]?.linkedUserId).toBeNull();
  });

  it("refuses linking to someone who is not on the trip", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect(await linkGuest(tripId, guestId, OUT, OWNER)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("refuses to overwrite a link — unlink first, not a silent overwrite", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await linkGuest(tripId, guestId, ED, OWNER)).ok).toBe(true);
    expect(await linkGuest(tripId, guestId, VIEW, OWNER)).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect((await listGuests(tripId))[0]?.linkedUserId).toBe(ED);
  });

  it("re-linking the same person is a no-op success that moves no revision", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await linkGuest(tripId, guestId, VIEW, OWNER)).ok).toBe(true);
    const before = await accessRevFor(tripId);
    expect((await linkGuest(tripId, guestId, VIEW, OWNER)).ok).toBe(true);
    expect(await accessRevFor(tripId)).toBe(before);
  });

  it("refuses an unknown guest id", async () => {
    const tripId = await seedWithCrew();
    expect(await linkGuest(tripId, randomUUID(), VIEW, OWNER)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("unlinkGuest", () => {
  it("lets the owner unlink, restoring the record to unclaimed", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await linkGuest(tripId, guestId, VIEW, OWNER)).ok).toBe(true);
    const unlinked = await unlinkGuest(tripId, guestId, OWNER);
    expect(unlinked.ok && unlinked.value.linkedUserId).toBeNull();
  });

  it("refuses an editor — unlink is owner only", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await linkGuest(tripId, guestId, ED, OWNER)).ok).toBe(true);
    expect(await unlinkGuest(tripId, guestId, ED)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await listGuests(tripId))[0]?.linkedUserId).toBe(ED);
  });

  it("unlinking an unlinked guest is a no-op success that moves no revision", async () => {
    const tripId = await seedTrip();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    const before = await accessRevFor(tripId);
    expect((await unlinkGuest(tripId, guestId, OWNER)).ok).toBe(true);
    expect(await accessRevFor(tripId)).toBe(before);
  });

  it("refuses an unknown guest id", async () => {
    const tripId = await seedTrip();
    expect(await unlinkGuest(tripId, randomUUID(), OWNER)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("accessRevFor (D11)", () => {
  /** Runs `change` and asserts the trip's access revision moved because of it. */
  async function expectBump(tripId: string, change: () => Promise<unknown>): Promise<void> {
    const before = await accessRevFor(tripId);
    await change();
    expect(await accessRevFor(tripId)).not.toBe(before);
  }

  it("moves on every guest write: add, update, remove, link, unlink", async () => {
    const tripId = await seedWithCrew();
    let guestId = "";
    await expectBump(tripId, async () => {
      const added = await addGuest(tripId, "Baby", OWNER);
      expect(added.ok).toBe(true);
      guestId = added.ok ? added.value.guestId : "";
    });
    await expectBump(tripId, () => updateGuest(tripId, guestId, { name: "Grandma" }, OWNER));
    await expectBump(tripId, () => linkGuest(tripId, guestId, VIEW, OWNER));
    await expectBump(tripId, () => unlinkGuest(tripId, guestId, OWNER));
    await expectBump(tripId, () => removeGuest(tripId, guestId, OWNER));
  });

  it("does not move on a refused write", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    const before = await accessRevFor(tripId);
    // Asserted refused, or an unchanged rev says nothing: a write that failed
    // for some other reason would leave it unchanged too.
    expect(await addGuest(tripId, "X", VIEW)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await updateGuest(tripId, guestId, { name: "X" }, VIEW)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await removeGuest(tripId, guestId, VIEW)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await linkGuest(tripId, guestId, ED, VIEW)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await unlinkGuest(tripId, guestId, ED)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await accessRevFor(tripId)).toBe(before);
  });

  it("a guest linked to a member who leaves stays linked to the id, untouched", async () => {
    const tripId = await seedWithCrew();
    const added = await addGuest(tripId, "Baby", OWNER);
    const guestId = added.ok ? added.value.guestId : "";
    expect((await linkGuest(tripId, guestId, VIEW, OWNER)).ok).toBe(true);
    // Removing the member does not touch the guest row: the link is a claim,
    // not a membership, and the row survives the way `participants` picks do.
    const detail = (await getTripDetail(tripId))!;
    expect(await removeMember(tripId, VIEW, detail.members)).toBe("removed");
    expect((await listGuests(tripId))[0]).toMatchObject({ linkedUserId: VIEW });
  });
});
