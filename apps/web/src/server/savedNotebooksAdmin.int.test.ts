// **The Library tab's notebook read** (M36 link 5), against a real database.
//
// The gate box: *"Library shows Reports first, then the notebook tile and
// table."* The tile is two numbers — saved to a library, and how many of those
// in the last 30 days — and the table is the latest saves with their owner.
// Deleted rows are in neither; that is the soft-delete rule every read of
// `saved_notebooks` keeps.
//
// **Each test reads at its own far-future `now`.** The all-time total counts
// every account's rows, and other files write them at the real `now`; this
// file's rows sit in 2041+, so the window and the newest rows are only ours,
// and the total is asserted as a difference across one test's inserts (the
// lane runs files one at a time, `fileParallelism: false`).
import { randomUUID } from "node:crypto";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { savedNotebooks, users } from "@/server/db/schema";
import { adminNotebooks } from "./savedNotebooks";

const DAY = 24 * 60 * 60 * 1000;

let year = 2041;
/** A fresh month nobody else writes into, and the `now` that reads it. */
function freshNow(): Date {
  year += 1;
  return new Date(`${year}-06-30T12:00:00.000Z`);
}

/** One saved-notebook row, stamped `at`; `deletedAt` makes it a soft-deleted one. */
async function saved(
  at: Date,
  { ownerId = `nb-owner-${randomUUID()}`, title = "Kyoto, three days", deletedAt = null as Date | null } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(savedNotebooks).values({
    id,
    ownerId,
    title,
    content: { v: CURRENT_PAGE_DOC_VERSION, type: "doc", content: [] },
    docVersion: CURRENT_PAGE_DOC_VERSION,
    sourceTripId: randomUUID(),
    sourceTripName: "Japan",
    sourcePageId: randomUUID(),
    createdAt: at,
    deletedAt,
  });
  return id;
}

describe("adminNotebooks", () => {
  it("counts saved notebooks that are not deleted, and the ones saved in the last 30 days", async () => {
    const now = freshNow();
    const before = await adminNotebooks(now);

    await saved(new Date(now.getTime() - DAY));
    await saved(new Date(now.getTime() - 30 * DAY)); // the window's first instant: in
    await saved(new Date(now.getTime() - 30 * DAY - 1)); // a millisecond earlier: all time only
    await saved(new Date(now.getTime() - 2 * DAY), { deletedAt: new Date(now.getTime() - DAY) });
    await saved(new Date(now.getTime() + DAY)); // after `now`: not yet saved, as of this read
    await saved(now); // at `now` exactly: the bound is exclusive, so not yet either

    const after = await adminNotebooks(now);
    expect(after.saved - before.saved).toBe(3);
    expect(after.savedInWindow).toBe(2);
    expect(after.windowDays).toBe(30);
  });

  it("lists the latest saves newest first, with the owner's address, and no deleted row", async () => {
    const now = freshNow();
    const ownerId = `nb-owner-${randomUUID()}`;
    const stamp = new Date().toISOString();
    await db.insert(users).values({ id: ownerId, email: `${ownerId}@example.com`, createdAt: stamp, updatedAt: stamp });

    const older = await saved(new Date(now.getTime() - 3 * DAY), { ownerId, title: "Older" });
    const newest = await saved(new Date(now.getTime() - DAY), { title: "Newest" });
    const deleted = await saved(new Date(now.getTime() - 2 * DAY), { title: "Gone", deletedAt: now });

    const { recent } = await adminNotebooks(now);
    const ids = recent.map((row) => row.savedNotebookId);
    expect(ids.slice(0, 2)).toEqual([newest, older]);
    expect(ids).not.toContain(deleted);
    expect(recent[1]).toEqual({
      savedNotebookId: older,
      title: "Older",
      ownerId,
      ownerEmail: `${ownerId}@example.com`,
      savedAt: new Date(now.getTime() - 3 * DAY).toISOString(),
    });
    // An owner with no `users` row (ADR-025: no foreign key) still lists.
    expect(recent[0]!.ownerEmail).toBeNull();
  });

  it("caps the table at the newest ten", async () => {
    const now = freshNow();
    const ids: string[] = [];
    for (let i = 1; i <= 11; i++) ids.push(await saved(new Date(now.getTime() - i * 60_000)));
    const { recent } = await adminNotebooks(now);
    expect(recent.map((row) => row.savedNotebookId)).toEqual(ids.slice(0, 10));
  });
});
