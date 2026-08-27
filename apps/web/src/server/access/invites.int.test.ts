import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { events, tripDetails, tripInvites, tripMemberships, tripSummaries, users } from "../db/schema";
import { executeTripCommand, executeTripCommandBatch } from "../commands";
import { getTripDetail } from "../projections";
import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from "./invites";
import { effectiveMembers, grantMembership, sharedTripIds, withProfiles } from "./members";

const OWNER = "dev-alice";
const GUEST = "dev-bob";

async function seedTrip(name = "Kyoto"): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  expect(created.ok).toBe(true);
  return tripId;
}

/**
 * Resolves once some backend in this database is parked on a lock — which, in
 * the one test that calls it, can only be the accept blocked on the membership
 * primary key. Polled rather than slept: a fixed sleep either flakes on a slow
 * machine or wastes the time on a fast one, and neither proves the block
 * happened. Throwing here is a real failure, not a flake: it means the accept
 * reached a decision without ever contending for the row.
 */
async function waitForABlockedBackend(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const blocked = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
    `);
    if (Number(blocked.rows[0]?.n ?? 0) > 0) return;
    if (Date.now() > deadline) {
      throw new Error("no backend ever blocked on the membership primary key");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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

  // CodeRabbit, PR #70, confirmed against the code: the already-a-member guard
  // read `detail.members` — the PROJECTION, which carries only the owner — so
  // an existing member could accept a second outstanding invite and have
  // `grantMembership`'s upsert rewrite their role. The role they ended up with
  // was whichever link they chose to click last, which put role selection in
  // the recipient's hands rather than the owner's.
  it("refuses a second outstanding invite to someone already on the trip", async () => {
    const tripId = await seedTrip();
    const asEditor = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const asViewer = await createInvite(tripId, OWNER, { email: null, role: "viewer" });

    expect((await acceptInvite(asEditor.token, GUEST)).ok).toBe(true);

    const second = await acceptInvite(asViewer.token, GUEST);
    expect(second).toEqual({
      ok: false,
      error: { code: "invalid", message: "You are already on this trip." },
    });

    // …and the role the OWNER granted is the role that stuck.
    const detail = (await getTripDetail(tripId))!;
    expect(await effectiveMembers(db, tripId, detail.members)).toEqual([
      { userId: OWNER, role: "owner" },
      { userId: GUEST, role: "editor" },
    ]);
  });

  // The mirror image: the recipient cannot demote-then-promote themselves
  // either, whichever order the links are clicked in.
  it("does not let acceptance order decide the role", async () => {
    const tripId = await seedTrip();
    const asViewer = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const asEditor = await createInvite(tripId, OWNER, { email: null, role: "editor" });

    expect((await acceptInvite(asViewer.token, GUEST)).ok).toBe(true);
    expect((await acceptInvite(asEditor.token, GUEST)).ok).toBe(false);

    // Still a viewer: the first grant stands, and an editor's commands are
    // still refused.
    expect(
      (await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, GUEST)).ok,
    ).toBe(false);
  });

  // The race CodeRabbit found in the first fix: the membership guard cannot be
  // serialized by moving it inside the transaction, because under READ
  // COMMITTED two simultaneous accepts of two DIFFERENT tokens both see no
  // membership. The primary key on (tripId, userId) is the real serialization
  // point, so `grantMembership` decides — first grant wins, the loser rolls
  // back including its token claim.
  //
  // What THIS test proves is the outcome under whatever interleaving the two
  // promises happen to get: exactly one accept wins and the result is never a
  // blend. It does NOT prove the primary-key branch, and its earlier comment
  // wrongly said it did (CodeRabbit, PR #70): `Promise.all` is free to let the
  // first accept commit before the second reads, in which case the second is
  // turned away by the in-transaction guard and `grantMembership` is never
  // reached — every assertion below still passes. The test after this one pins
  // that branch down deterministically; keep both, they cover different things.
  it("survives two invites accepted at the same instant", async () => {
    const tripId = await seedTrip();
    const asEditor = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const asViewer = await createInvite(tripId, OWNER, { email: null, role: "viewer" });

    const [a, b] = await Promise.all([
      acceptInvite(asEditor.token, GUEST),
      acceptInvite(asViewer.token, GUEST),
    ]);

    // Exactly one wins; the other is refused rather than silently overwriting.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

    // Exactly one membership row, carrying the role of whichever accept won —
    // never a blend, and never the loser's role.
    const detail = (await getTripDetail(tripId))!;
    const members = await effectiveMembers(db, tripId, detail.members);
    const guest = members.filter((m) => m.userId === GUEST);
    expect(guest).toHaveLength(1);
    // Narrowed explicitly rather than via a ternary: `a.ok ? a : b` widens
    // back to the union, and the winner's role is the whole point here.
    const winner = a.ok ? a : b;
    if (!winner.ok) throw new Error("expected exactly one accept to succeed");
    expect(guest[0]!.role).toBe(winner.value.role);

    // …and the loser's token was NOT spent: rolling the transaction back
    // un-claims it, so the owner has not silently lost an invite to a grant
    // that never happened.
    const spent = (await listInvites(tripId)).filter((i) => i.status === "accepted");
    expect(spent).toHaveLength(1);
  });

  // The branch the test above cannot pin: the accept gets PAST the guard and
  // loses at the primary key. Forced deterministically by holding a membership
  // row for the same user open and UNCOMMITTED in a second transaction —
  // under READ COMMITTED the guard cannot see it, so the accept claims the
  // token and then blocks inside `grantMembership`. Committing the holder at
  // that point is what makes `onConflictDoNothing` return nothing.
  it("rolls the token claim back when the membership is lost at the primary key", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });

    let signalInserted!: () => void;
    let releaseHolder!: () => void;
    const holderInserted = new Promise<void>((resolve) => {
      signalInserted = resolve;
    });
    const holderMayCommit = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holder = db.transaction(async (tx) => {
      const won = await grantMembership(tx, {
        tripId,
        userId: GUEST,
        role: "viewer",
        invitedBy: OWNER,
        now: new Date().toISOString(),
      });
      if (!won) throw new Error("the holder should have taken the row uncontested");
      signalInserted();
      await holderMayCommit;
    });

    let accepting: ReturnType<typeof acceptInvite>;
    try {
      await holderInserted;
      accepting = acceptInvite(invite.token, GUEST);
      await waitForABlockedBackend();
    } finally {
      // Always, or a thrown barrier leaves the holder's transaction open and
      // the pool one connection short for the rest of the file.
      releaseHolder();
    }
    await holder;

    const result = await accepting;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");

    // The claim was rolled back with the grant: the link is still spendable,
    // which is the whole point of throwing rather than returning.
    const [after] = await listInvites(tripId);
    expect(after?.status).toBe("pending");
    expect(after?.acceptedBy).toBeNull();

    // And the role that stands is the holder's, not the one the losing accept
    // told nobody about.
    const detail = (await getTripDetail(tripId))!;
    expect(await effectiveMembers(db, tripId, detail.members)).toEqual([
      { userId: OWNER, role: "owner" },
      { userId: GUEST, role: "viewer" },
    ]);
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
