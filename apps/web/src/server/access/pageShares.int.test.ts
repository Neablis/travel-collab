import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { pages as pagesTable, pageShares, tripSummaries } from "../db/schema";
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

  it("concurrent publishes racing for one page leave exactly one live link, and all get its token", async () => {
    // Rounds, not one: the window is a few ms and a single batch can serialise by luck.
    for (let round = 0; round < 10; round++) {
      const { tripId, pageId } = await seedTripWithPage();
      const links = await Promise.all(Array.from({ length: 8 }, () => publish(tripId, pageId)));
      expect(new Set(links.map((l) => l.token)).size).toBe(1);
      const rows = await db.select().from(pageShares).where(eq(pageShares.pageId, pageId));
      expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    }
  });

  it("refuses to publish a page of a deleted trip", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    expect((await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER)).ok).toBe(true);
    const result = await createPageShare(tripId, pageId, OWNER);
    expect(!result.ok && result.error.code).toBe("invalid");
    expect(await listPageShares(tripId, pageId)).toHaveLength(0);
  });

  it("a trip deleted between the check and the insert leaves no live link", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // A writer that holds the trip's row, as the DeleteTrip projection does,
    // and marks it deleted only once the publish is already in flight.
    const deleter = db.transaction(async (tx) => {
      await tx.select().from(tripSummaries).where(eq(tripSummaries.tripId, tripId)).for("update");
      locked();
      await hold;
      await tx.update(tripSummaries).set({ status: "deleted" }).where(eq(tripSummaries.tripId, tripId));
    });
    await isLocked;
    const publishing = createPageShare(tripId, pageId, OWNER);
    await new Promise((r) => setTimeout(r, 200));
    release();
    await deleter;
    const result = await publishing;
    expect(!result.ok && result.error.code).toBe("invalid");
    expect((await listPageShares(tripId, pageId)).filter((s) => s.revokedAt === null)).toHaveLength(0);
  });

  it("a link published after the delete's instant but before its projection is still revoked", async () => {
    const { tripId, pageId } = await seedTripWithPage();
    // The publish took the trip row first, so it saw a live trip and committed;
    // its createdAt is later than the DeleteTrip's occurredAt, which was stamped
    // before the projection ran. A future instant stands in for that ordering.
    const share = await createPageShare(tripId, pageId, OWNER, new Date(Date.now() + 60_000).toISOString());
    expect(share.ok).toBe(true);
    expect((await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER)).ok).toBe(true);
    expect((await listPageShares(tripId, pageId)).filter((s) => s.revokedAt === null)).toHaveLength(0);
  });

  it("publishing while the link is revoked always answers a link that is stored", async () => {
    for (let round = 0; round < 15; round++) {
      const { tripId, pageId } = await seedTripWithPage();
      const first = await publish(tripId, pageId);
      const [revoke, ...publishes] = await Promise.all([
        revokePageShare(tripId, pageId, first.shareId),
        ...Array.from({ length: 4 }, () => createPageShare(tripId, pageId, OWNER)),
      ]);
      expect(revoke.ok).toBe(true);
      const stored = new Set((await db.select().from(pageShares).where(eq(pageShares.pageId, pageId))).map((r) => r.token));
      for (const p of publishes) if (p.ok) expect(stored.has(p.value.token)).toBe(true);
    }
  });

  it("concurrent revokes all report the stored instant", async () => {
    for (let round = 0; round < 10; round++) {
      const { tripId, pageId } = await seedTripWithPage();
      const share = await publish(tripId, pageId);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => revokePageShare(tripId, pageId, share.shareId, `2026-03-0${i + 1}T00:00:00.000Z`)),
      );
      const [row] = await db.select().from(pageShares).where(eq(pageShares.id, share.shareId));
      const stored = row?.revokedAt?.toISOString();
      expect(new Set(results.map((r) => r.ok && r.value.revokedAt))).toEqual(new Set([stored]));
    }
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
