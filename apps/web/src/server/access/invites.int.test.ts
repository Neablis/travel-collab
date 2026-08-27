import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { events, tripDetails, tripInvites, tripMemberships, tripSummaries, users } from "../db/schema";
import { executeTripCommand, executeTripCommandBatch } from "../commands";
import { getTripDetail } from "../projections";
import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from "./invites";
import { effectiveMembers, sharedTripIds, withProfiles } from "./members";

const OWNER = "dev-alice";
const GUEST = "dev-bob";

async function seedTrip(name = "Kyoto"): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  expect(created.ok).toBe(true);
  return tripId;
}

beforeEach(async () => {
  await db.delete(tripInvites);
  await db.delete(tripMemberships);
  await db.delete(tripDetails);
  await db.delete(tripSummaries);
  await db.delete(events);
  await db.delete(users);
});

describe("invites — create, accept, revoke", () => {
  it("an accepted invite makes the guest a member of the trip", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: "bob@example.com", role: "editor" });
    expect(invite.status).toBe("pending");

    const accepted = await acceptInvite(invite.token, GUEST);
    expect(accepted).toEqual({ ok: true, value: { tripId, role: "editor" } });

    const detail = (await getTripDetail(tripId))!;
    // The PROJECTION is untouched — membership is CRUD, not an event
    // (AGENTS.md invariant 2 / ADR-003).
    expect(detail.members).toEqual([{ userId: OWNER, role: "owner" }]);
    // The effective list is where the guest shows up.
    expect(await effectiveMembers(db, tripId, detail.members)).toEqual([
      { userId: OWNER, role: "owner" },
      { userId: GUEST, role: "editor" },
    ]);
  });

  it("lets the invited editor actually change the trip", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);

    const result = await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, GUEST);
    expect(result.ok).toBe(true);
  });

  it("refuses every planning command to an invited viewer", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    await acceptInvite(invite.token, GUEST);

    const single = await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, GUEST);
    expect(single).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Not a member of this trip." },
    });

    const batch = await executeTripCommandBatch(
      [{ type: "AddDay", tripId, dayId: randomUUID() }],
      GUEST,
    );
    expect(batch.ok).toBe(false);
  });

  it("refuses an editor the owner-only commands", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);

    expect((await executeTripCommand({ type: "DeleteTrip", tripId }, GUEST)).ok).toBe(false);
  });

  it("is single-use: a second person cannot spend the same link", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    expect((await acceptInvite(invite.token, GUEST)).ok).toBe(true);

    const second = await acceptInvite(invite.token, "dev-cara");
    expect(second).toEqual({
      ok: false,
      error: { code: "gone", message: "This invite has already been used." },
    });
  });

  it("is idempotent for the person who already spent it", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);
    expect(await acceptInvite(invite.token, GUEST)).toEqual({
      ok: true,
      value: { tripId, role: "editor" },
    });
  });

  it("refuses the owner their own link, rather than silently doing nothing", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const result = await acceptInvite(invite.token, OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");
  });

  it("refuses an unknown token", async () => {
    const result = await acceptInvite("not-a-real-token", GUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-found");
  });

  it("refuses an invite to a deleted trip", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    const result = await acceptInvite(invite.token, GUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("gone");
  });

  // The point of the word: revoking takes the access away, not just the link.
  it("revoking an accepted invite removes the membership it created", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, GUEST)).ok).toBe(true);

    const revoked = await revokeInvite(tripId, invite.inviteId);
    expect(revoked.ok).toBe(true);

    const detail = (await getTripDetail(tripId))!;
    expect(await effectiveMembers(db, tripId, detail.members)).toEqual([
      { userId: OWNER, role: "owner" },
    ]);
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, GUEST)).ok).toBe(false);
  });

  it("a revoked link cannot be accepted", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await revokeInvite(tripId, invite.inviteId);
    const result = await acceptInvite(invite.token, GUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("gone");
  });

  it("revoking twice is a no-op, not an error", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await revokeInvite(tripId, invite.inviteId);
    expect((await revokeInvite(tripId, invite.inviteId)).ok).toBe(true);
  });

  it("scopes revoke to the trip in the URL — another trip's invite is not found", async () => {
    const tripA = await seedTrip("A");
    const tripB = await seedTrip("B");
    const invite = await createInvite(tripA, OWNER, { email: null, role: "editor" });
    const result = await revokeInvite(tripB, invite.inviteId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-found");
  });

  it("lowercases the invite email, so two spellings are one person", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: "Bob@Example.COM", role: "viewer" });
    expect(invite.email).toBe("bob@example.com");
  });

  it("lists invites newest first", async () => {
    const tripId = await seedTrip();
    const first = await createInvite(tripId, OWNER, { email: null, role: "viewer" }, "2026-01-01T00:00:00.000Z");
    const second = await createInvite(tripId, OWNER, { email: null, role: "editor" }, "2026-02-01T00:00:00.000Z");
    expect((await listInvites(tripId)).map((i) => i.inviteId)).toEqual([
      second.inviteId,
      first.inviteId,
    ]);
  });
});

describe("invite preview", () => {
  it("shows the trip name and the role on offer to someone who is not a member", async () => {
    const tripId = await seedTrip("Kyoto");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const preview = await previewInvite(invite.token, GUEST);
    expect(preview).toEqual({
      ok: true,
      value: {
        tripId,
        tripName: "Kyoto",
        role: "viewer",
        status: "pending",
        invitedByName: null,
        alreadyMember: false,
      },
    });
  });

  it("tells an existing member they are already on the trip", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const preview = await previewInvite(invite.token, OWNER);
    expect(preview.ok && preview.value.alreadyMember).toBe(true);
  });

  it("names the inviter when Identity knows them", async () => {
    const tripId = await seedTrip();
    await db.insert(users).values({
      id: OWNER,
      email: "alice@example.com",
      name: "Alice",
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const preview = await previewInvite(invite.token, GUEST);
    expect(preview.ok && preview.value.invitedByName).toBe("Alice");
  });
});

describe("trips shared with me", () => {
  it("reports the trips reached through an accepted invite, and only those", async () => {
    const mine = await seedTrip("Mine");
    const theirs = await seedTrip("Theirs");
    const invite = await createInvite(theirs, OWNER, { email: null, role: "viewer" });
    await acceptInvite(invite.token, GUEST);

    expect(await sharedTripIds(GUEST)).toEqual([theirs]);
    expect(await sharedTripIds(OWNER)).toEqual([]);
    expect(mine).not.toBe(theirs);
  });
});

describe("member profiles", () => {
  it("joins Identity for display, and keeps a member with no user row", async () => {
    await db.insert(users).values({
      id: GUEST,
      email: "bob@example.com",
      name: "Bob",
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const profiles = await withProfiles([
      { userId: OWNER, role: "owner" },
      { userId: GUEST, role: "editor" },
    ]);
    expect(profiles).toEqual([
      { userId: OWNER, role: "owner", name: null, email: null, image: null },
      { userId: GUEST, role: "editor", name: "Bob", email: "bob@example.com", image: null },
    ]);
  });
});
