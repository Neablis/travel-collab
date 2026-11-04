import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { pages as pagesTable, pageShares } from "../db/schema";
import { executeTripCommand } from "../commands";
import { executePageCommand } from "../pageCommands";
import { listPages } from "../pages";
import { createPageShare, isPublishable, listPageShares, liveShareTokensFor, readPageShare, revokePageShare } from "./pageShares";

// Every test seeds its own trip and reads back through it (KI-69): no truncation.
const OWNER = `pshare-owner-${randomUUID().slice(0, 8)}`;

async function seedTripWithPage(): Promise<{ tripId: string; pageId: string }> {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Pages" }, OWNER)).ok).toBe(true);
  const pageId = randomUUID();
  const created = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title: "Notes", context: { tripId }, content: newPageDoc() },
    OWNER,
  );
  expect(created.ok).toBe(true);
  return { tripId, pageId };
}

async function publish(tripId: string, pageId: string) {
  const result = await createPageShare(tripId, pageId, OWNER);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("a public notebook is a revocable link", () => {
  it("mints a long random token, and a second publish while live returns the same link", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const first = await publish(tripId, pageId);
    expect(first.token.length).toBeGreaterThanOrEqual(43);
    expect((await publish(tripId, pageId)).token).toBe(first.token);
    expect(await listPageShares(tripId, pageId)).toHaveLength(1);
  });

  it("reads the live page, and revoke makes the token not-found", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const share = await publish(tripId, pageId);
    const read = await readPageShare(share.token);
    expect(read.ok && read.value.page.title).toBe("Notes");

    // Live, not pinned: an edit after publishing shows at once.
    await executePageCommand({ type: "EditPage", tripId, pageId, title: "Notes, edited" }, OWNER);
    const after = await readPageShare(share.token);
    expect(after.ok && after.value.page.title).toBe("Notes, edited");

    expect((await revokePageShare(tripId, pageId, share.shareId)).ok).toBe(true);
    const dead = await readPageShare(share.token);
    expect(!dead.ok && dead.error.code).toBe("not-found");
  });

  it("revoking twice succeeds and keeps the first instant", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const share = await publish(tripId, pageId);
    const first = await revokePageShare(tripId, pageId, share.shareId, "2026-01-01T00:00:00.000Z");
    const second = await revokePageShare(tripId, pageId, share.shareId, "2026-02-02T00:00:00.000Z");
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value.revokedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("publishing again after a revoke mints a different token and the old one stays dead", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const first = await publish(tripId, pageId);
    await revokePageShare(tripId, pageId, first.shareId);
    const second = await publish(tripId, pageId);
    expect(second.token).not.toBe(first.token);
    expect(second.shareId).not.toBe(first.shareId);

    const old = await readPageShare(first.token);
    expect(!old.ok && old.error.code).toBe("not-found");
    expect((await readPageShare(second.token)).ok).toBe(true);
    expect(await listPageShares(tripId, pageId)).toHaveLength(2);
  });

  it("reverting the trip's history to before the revoke leaves the link revoked", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    // CreateTrip is seq 1 and CreatePage seq 2; the day makes a later point to revert from.
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER);
    const share = await publish(tripId, pageId);
    await revokePageShare(tripId, pageId, share.shareId);

    const reverted = await executeTripCommand({ type: "RevertToState", tripId, toSeq: 2 }, OWNER);
    expect(reverted.ok).toBe(true);

    const [row] = await db.select().from(pageShares).where(eq(pageShares.id, share.shareId));
    expect(row?.revokedAt).not.toBeNull();
    expect((await readPageShare(share.token)).ok).toBe(false);
  });

  it("refuses a page of another trip as not-found", async () => {
    const a = await seedTripWithPage();
    const b = await seedTripWithPage();
    const result = await createPageShare(b.tripId, a.pageId, OWNER);
    expect(!result.ok && result.error.code).toBe("not-found");
  });

  it("refuses the Bookings, Money and During-the-trip seeds as invalid", async () => {
    // Seeding happens when a trip has no pages, so list before adding one.
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Seeds" }, OWNER);
    await listPages(tripId); // seeds the defaults
    const pages = await db.select().from(pagesTable).where(eq(pagesTable.tripId, tripId));
    for (const key of ["bookings-and-confirmations", "money", "today"]) {
      const seed = pages.find((p) => p.seedKey === key);
      expect(seed, `seed ${key} exists`).toBeDefined();
      const result = await createPageShare(tripId, seed!.id, OWNER);
      expect(!result.ok && result.error.code, key).toBe("invalid");
    }
    // The other seeds are ordinary notebooks.
    expect(isPublishable({ seedKey: "overview" })).toBe(true);
    expect(isPublishable({ seedKey: null })).toBe(true);
  });
});

describe("deleting revokes", () => {
  it("deleting the page revokes its live link", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const share = await publish(tripId, pageId);
    expect((await executePageCommand({ type: "DeletePage", tripId, pageId }, OWNER)).ok).toBe(true);
    const [row] = await db.select().from(pageShares).where(eq(pageShares.id, share.shareId));
    expect(row?.revokedAt).not.toBeNull();
    expect((await readPageShare(share.token)).ok).toBe(false);
  });

  it("deleting the trip revokes every live link on it", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const share = await publish(tripId, pageId);
    expect((await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER)).ok).toBe(true);
    const [row] = await db.select().from(pageShares).where(eq(pageShares.id, share.shareId));
    expect(row?.revokedAt).not.toBeNull();
  });
});

describe("liveShareTokensFor", () => {
  it("answers a token for a live link and null for a revoked or unshared page", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    const other = randomUUID();
    const share = await publish(tripId, pageId);
    const lookup = await liveShareTokensFor(tripId);
    expect(lookup(pageId)).toBe(share.token);
    expect(lookup(other)).toBeNull();

    await revokePageShare(tripId, pageId, share.shareId);
    expect((await liveShareTokensFor(tripId))(pageId)).toBeNull();
  });
});
