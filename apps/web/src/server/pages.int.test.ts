import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { listPages, getPage, createPage, updatePage, deletePage } from "./pages";

async function seedTrip() {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, "user-1");
  return { tripId };
}

// No beforeEach truncation: every test mints its own randomUUID() tripId via
// seedTrip() and every assertion reads back through that tripId or a page id
// scoped to it — see eventStore.int.test.ts's comment and
// docs/testing-baseline.md for the isolation-strategy writeup (Phase 2 Task
// 2.6).
describe("pages repository", () => {
  it("lazily instantiates the two default pages on first list", async () => {
    const { tripId } = await seedTrip();
    const first = await listPages(tripId);
    expect(first.map((p) => p.title).sort()).toEqual(["Day Sheet", "Trip Overview"]);
    const second = await listPages(tripId); // idempotent — no duplicate instantiation
    expect(second).toHaveLength(2);
  });

  // KI-6 regression. Two concurrent first visits (two tabs, or a double-fetch)
  // both observe zero rows before either has inserted, so both seed; only the
  // `pages_system_seed_unique` partial index stops the second one landing.
  //
  // The pool warm-up is load-bearing, not incidental: with a cold pool the
  // second listPages() has to open a fresh Postgres connection (TCP + auth)
  // while the first reuses a live one, so the first reliably finishes both
  // inserts before the second even issues its SELECT and the race never
  // happens. Pre-opening the connections removes that handicap. Verified: on
  // the pre-fix code this test reports 4 pages ("Trip Overview", "Trip
  // Overview", "Day Sheet", "Day Sheet"); without the warm-up it passed even
  // unfixed.
  it("does not duplicate default pages when two first visits race", async () => {
    const { tripId } = await seedTrip();
    await Promise.all([0, 1, 2, 3].map(() => db.execute(sql`select 1`)));

    const [a, b] = await Promise.all([listPages(tripId), listPages(tripId)]);

    expect(a.map((p) => p.title).sort()).toEqual(["Day Sheet", "Trip Overview"]);
    expect(b.map((p) => p.title).sort()).toEqual(["Day Sheet", "Trip Overview"]);
    const after = await listPages(tripId);
    expect(after.map((p) => p.title).sort()).toEqual(["Day Sheet", "Trip Overview"]);
  });

  // Found by walking the Notebook index in a browser on 2026-09-03, not by a
  // test: a notebook created through the index appeared FIRST on the next
  // read, while `NotebookScreen.handleCreate` had just appended it to the end
  // of its own list. `listPages` was a bare `SELECT … WHERE` with no ORDER BY,
  // so Postgres returned rows in physical order — which an UPDATE changes,
  // because it writes a new row version.
  //
  // The update below is the half that catches the reshuffle. Creation order
  // alone can pass unordered, since fresh inserts often land in insertion
  // order anyway; editing the FIRST row is what moves it.
  it("returns notebooks in a stable order that an edit does not disturb", async () => {
    const { tripId } = await seedTrip();
    const seeded = await listPages(tripId);
    // The prebuilt pair comes back in `instantiateDefaults` order, which is
    // the order SPEC §7 names them in — not whichever the database felt like.
    expect(seeded.map((p) => p.title)).toEqual(["Trip Overview", "Day Sheet"]);

    const mine = await createPage(
      tripId,
      { title: "Packing", context: { tripId }, content: { type: "doc", content: [] } },
      "user-1",
    );
    expect((await listPages(tripId)).map((p) => p.title)).toEqual(["Trip Overview", "Day Sheet", "Packing"]);

    // Edit the first row, then the last. Neither may move.
    await updatePage(seeded[0]!.id, { title: "Trip Overview" });
    await updatePage(mine.id, { title: "Packing" });
    expect((await listPages(tripId)).map((p) => p.title)).toEqual(["Trip Overview", "Day Sheet", "Packing"]);
  });

  it("creates, reads, updates, deletes a page", async () => {
    const { tripId } = await seedTrip();
    const created = await createPage(
      tripId,
      { title: "Notes", context: { tripId }, content: { type: "doc", content: [] } },
      "user-1",
    );
    expect(created.title).toBe("Notes");
    const fetched = await getPage(created.id);
    expect(fetched!.id).toBe(created.id);
    const updated = await updatePage(created.id, { title: "Renamed" });
    expect(updated!.title).toBe("Renamed");
    expect(updated!.updatedAt >= created.updatedAt).toBe(true);
    expect(await deletePage(created.id)).toBe(true);
    expect(await getPage(created.id)).toBeNull();
  });
});
