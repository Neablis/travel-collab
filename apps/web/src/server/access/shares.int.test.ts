import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { events, tripDetails, tripInvites, tripMemberships, tripShares, tripSummaries } from "../db/schema";
import { executeTripCommand } from "../commands";
import { createInvite, acceptInvite } from "./invites";
import { createShare, listShares, readFeaturedShare, readShare, revokeShare } from "./shares";

const OWNER = "share-alice";

async function seedTrip(name = "Kyoto"): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  expect(created.ok).toBe(true);
  return tripId;
}

const addDay = (tripId: string) =>
  executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER);

beforeEach(async () => {
  await db.delete(tripShares);
  await db.delete(tripInvites);
  await db.delete(tripMemberships);
  await db.delete(tripDetails);
  await db.delete(tripSummaries);
  await db.delete(events);
  delete process.env.DEMO_SHARE_TOKEN;
});

afterEach(() => {
  delete process.env.DEMO_SHARE_TOKEN;
});

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
    const stored = (await db.select().from(tripDetails))[0]!;
    await db.update(tripDetails).set({
      doc: {
        ...stored.doc,
        days: [...stored.doc.days, ...stored.doc.days, ...stored.doc.days],
      },
    });

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
    await revokeShare(tripId, share.value.shareId);
    expect((await revokeShare(tripId, share.value.shareId)).ok).toBe(true);
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
    await acceptInvite(invite.token, "share-bob");
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;

    const view = await readShare(share.value.token);
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    const serialized = JSON.stringify(view.value);
    expect(serialized).not.toContain(OWNER);
    expect(serialized).not.toContain("share-bob");
    expect(Object.keys(view.value)).not.toContain("members");
    expect(Object.keys(view.value)).not.toContain("conflicts");
    expect(Object.keys(view.value)).not.toContain("status");
    // …but it does say how many people are on it.
    expect(view.value.travellerCount).toBe(2);
  });
});

describe("the featured share", () => {
  it("is not configured by default, and says so rather than picking a trip", async () => {
    const tripId = await seedTrip();
    await createShare(tripId, OWNER); // a real share exists…
    const result = await readFeaturedShare();
    // …and is deliberately NOT promoted to the front page.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("No trip is published here yet.");
  });

  it("serves the configured share when one is named", async () => {
    const tripId = await seedTrip("Featured");
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    process.env.DEMO_SHARE_TOKEN = share.value.token;
    const result = await readFeaturedShare();
    expect(result.ok && result.value.name).toBe("Featured");
  });

  it("falls back to nothing if the configured share was turned off", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    await revokeShare(tripId, share.value.shareId);
    process.env.DEMO_SHARE_TOKEN = share.value.token;
    expect((await readFeaturedShare()).ok).toBe(false);
  });
});
