import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { tripDetails } from "../db/schema";
import { executeTripCommand } from "../commands";
import { createInvite, acceptInvite } from "./invites";
import { createShare, listShares, readShare, revokeShare } from "./shares";

// Unique per run so this file's actors cannot collide with another suite's,
// with a developer's own dev-login identity, or with a previous run's leftovers
// (KI-69). Every assertion below reads through a tripId or a share token this
// test created, so a fresh actor plus a fresh trip is all the isolation needed.
const RUN = randomUUID().slice(0, 8);
const OWNER = `share-alice-${RUN}`;
const GUEST = `share-bob-${RUN}`;

async function seedTrip(name = "Kyoto"): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  expect(created.ok).toBe(true);
  return tripId;
}

const addDay = (tripId: string) =>
  executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER);

// There is deliberately no `beforeEach` truncation here any more (KI-69).
//
// It used to delete every row of trip_shares, trip_invites, trip_memberships,
// trip_details, trip_summaries and events — not the rows this file created, all
// of them — so anything else holding a row in those tables lost it mid-run. The
// only thing that made that safe was the policy declaring postgres an exclusive
// resource; the database is also shared with local development. Every test here
// creates a fresh trip (`seedTrip` mints a randomUUID) and asserts through that
// tripId or a share token it just minted, so there is nothing to clean up
// between tests and nothing left over that any assertion can see.

describe("a pinned share is pinned", () => {
  // The milestone's whole second user story, and the exit-gate line that
  // names how to prove it: "editing the trip afterwards and seeing the link
  // unchanged".
  it("keeps showing the trip as it was when the link was created", async () => {
    const tripId = await seedTrip();
    await addDay(tripId);
    await addDay(tripId);

    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    expect(share.value.seq).toBe(3); // TripCreated + two DayAdded

    const before = await readShare(share.value.token);
    expect(before.ok && before.value.days).toHaveLength(2);
    expect(before.ok && before.value.stale).toBe(false);

    // Keep planning.
    await addDay(tripId);
    await executeTripCommand({ type: "SetTripName", tripId, name: "Kyoto, actually Osaka" }, OWNER);

    const after = await readShare(share.value.token);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.days).toHaveLength(2);
    expect(after.value.name).toBe("Kyoto");
    // …and it says so, because a reader who is also a traveller should know
    // the plan they are looking at is not the current one.
    expect(after.value.stale).toBe(true);
  });

  it("re-pinning is a NEW link, so one already handed out cannot change", async () => {
    const tripId = await seedTrip();
    const first = await createShare(tripId, OWNER);
    await addDay(tripId);
    const second = await createShare(tripId, OWNER);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.token).not.toBe(first.value.token);
    expect(second.value.seq).toBeGreaterThan(first.value.seq);

    const oldView = await readShare(first.value.token);
    expect(oldView.ok && oldView.value.days).toHaveLength(0);
    const newView = await readShare(second.value.token);
    expect(newView.ok && newView.value.days).toHaveLength(1);
  });

  // The note the milestone brief called out: a pinned read CANNOT use the
  // materialized trip_details projection, because that projection is always
  // the trip as it is now. Deleting the projection row leaves replay
  // untouched — but the status check needs it, so this asserts the shape of
  // the dependency rather than pretending there is none.
  it("replays the log rather than reading the materialized projection", async () => {
    const tripId = await seedTrip();
    await addDay(tripId);
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;

    // Corrupt the projection with a plausible-but-wrong day count. A read
    // that served the projection would return three days; replay returns one.
    //
    // Both statements are scoped to this test's own trip (KI-69). They used to
    // be `db.select().from(tripDetails)` taking `[0]!` — whichever row the heap
    // happened to return first — followed by an `update` with NO `where`, which
    // wrote the deliberately-corrupted doc into EVERY row of trip_details in
    // the database. That was safe only because the beforeEach above had just
    // emptied the table, i.e. only because this suite owned the whole database.
    // The blast radius was real: `anchors.int.test.ts` asserts that every
    // trip_details row re-projects identically after a rebuild, and a developer
    // shares this DATABASE_URL with their own dev data.
    const [stored] = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
    await db
      .update(tripDetails)
      .set({
        doc: {
          ...stored!.doc,
          days: [...stored!.doc.days, ...stored!.doc.days, ...stored!.doc.days],
        },
      })
      .where(eq(tripDetails.tripId, tripId));

    const view = await readShare(share.value.token);
    expect(view.ok && view.value.days).toHaveLength(1);
  });
});

describe("share lifecycle", () => {
  it("refuses an unknown token", async () => {
    const result = await readShare("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-found");
  });

  it("turning a link off stops it working", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    expect((await readShare(share.value.token)).ok).toBe(true);

    await revokeShare(tripId, share.value.shareId);

    const after = await readShare(share.value.token);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("gone");
  });

  it("revoking twice is a no-op, not an error", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    // Explicit, DIFFERENT timestamps: with `now` defaulted, removing the
    // `revokedAt !== null` early return would let the second call rewrite the
    // timestamp and this test would still pass (CodeRabbit, PR #71). The
    // invariant is that an already-revoked link comes back unchanged.
    const first = await revokeShare(tripId, share.value.shareId, "2026-01-01T00:00:00.000Z");
    expect(first.ok).toBe(true);
    // The literal, not just "whatever got stored": since KI-53 the write path
    // and the read path agree on one ISO-8601 shape, so both can be pinned
    // here. This used to read the value back precisely because they did not.
    const stored = "2026-01-01T00:00:00.000Z";
    expect(first.ok && first.value.revokedAt).toBe(stored);
    expect((await listShares(tripId))[0]!.revokedAt).toBe(stored);

    const second = await revokeShare(tripId, share.value.shareId, "2026-02-01T00:00:00.000Z");
    expect(second.ok).toBe(true);
    // The moment the link was turned off does not move.
    expect(second.ok && second.value.revokedAt).toBe(stored);
    expect((await listShares(tripId))[0]!.revokedAt).toBe(stored);
  });

  it("scopes revoke to the trip in the URL", async () => {
    const a = await seedTrip("A");
    const b = await seedTrip("B");
    const share = await createShare(a, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    const result = await revokeShare(b, share.value.shareId);
    expect(result.ok).toBe(false);
  });

  // The person who deleted the trip said it should not exist; a link they
  // handed out earlier is not an exception to that.
  it("refuses a deleted trip's link, even though replay could still serve it", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);

    const result = await readShare(share.value.token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("gone");
  });

  it("comes back to life if the trip is restored", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    await executeTripCommand({ type: "RestoreTrip", tripId }, OWNER);
    expect((await readShare(share.value.token)).ok).toBe(true);
  });

  it("refuses to share a trip that does not exist", async () => {
    const result = await createShare(randomUUID(), OWNER);
    expect(result.ok).toBe(false);
  });

  it("lists newest first", async () => {
    const tripId = await seedTrip();
    const first = await createShare(tripId, OWNER, "2026-01-01T00:00:00.000Z");
    const second = await createShare(tripId, OWNER, "2026-02-01T00:00:00.000Z");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect((await listShares(tripId)).map((s) => s.shareId)).toEqual([
      second.value.shareId,
      first.value.shareId,
    ]);
  });
});

describe("what a stranger is served", () => {
  // A public read is the one place a field leaks to people the trip's owner
  // never chose, so the narrowing is asserted on the real payload rather than
  // trusted to the contract alone.
  it("names no traveller, and carries no conflicts or status", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;

    const view = await readShare(share.value.token);
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    const serialized = JSON.stringify(view.value);
    expect(serialized).not.toContain(OWNER);
    expect(serialized).not.toContain(GUEST);
    expect(Object.keys(view.value)).not.toContain("members");
    expect(Object.keys(view.value)).not.toContain("conflicts");
    expect(Object.keys(view.value)).not.toContain("status");
    // …but it does say how many people are on it.
    expect(view.value.travellerCount).toBe(2);
  });
});

// The featured share used to be tested here: `readFeaturedShare` resolved
// `DEMO_SHARE_TOKEN` against this table. `/s/featured` now serves the built-in
// demo trip, folded from the fixture with no database at all (ADR-031), so its
// coverage is `src/server/demoTrip.test.ts` and
// `src/app/api/shares/featured/route.test.ts` — neither of which needs Postgres,
// which is the whole claim.

// KI-53. `mode: "string"` columns echoed the write path's own ISO input and
// rendered Postgres's format ("2026-01-01 00:00:00+00") on the read path, so
// the same field had two shapes depending on which call you got it from.
// `mode: "date"` plus one `.toISOString()` in `toDto` is what makes these
// equal; asserting the ISO literal is what stops it silently coming back.
describe("share timestamps have one shape", () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  it("returns the same createdAt from the write path and the read path", async () => {
    const tripId = await seedTrip();
    const created = await createShare(tripId, OWNER, "2026-01-01T00:00:00.000Z");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect((await listShares(tripId))[0]!.createdAt).toBe(created.value.createdAt);
  });

  it("returns the same revokedAt from the write path and the read path", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    const revoked = await revokeShare(tripId, share.value.shareId, "2026-03-04T05:06:07.008Z");
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.revokedAt).toBe("2026-03-04T05:06:07.008Z");
    expect((await listShares(tripId))[0]!.revokedAt).toBe(revoked.value.revokedAt);
  });

  it("serves the public view's sharedAt in the same shape", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER, "2026-01-01T00:00:00.000Z");
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    const view = await readShare(share.value.token);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.sharedAt).toMatch(ISO);
    expect(view.value.sharedAt).toBe(share.value.createdAt);
  });
});
