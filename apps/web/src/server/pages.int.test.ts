import { newPageDoc } from "@tc/contracts";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { listPages, getPage, createPage, updatePage, deletePage } from "./pages";

// The seeded titles, read from the templates rather than typed here.
//
// They were hardcoded as `["Day Sheet", "Trip Overview"]`, and renaming one seed
// ("Day Sheet" → "Day overview", 2026-09-06) failed three tests for a reason
// that was not a defect. What these tests are about is the SEEDING — that it
// happens once, survives a race, and comes back in a fixed order — and none of
// that is a claim about the words. The count still is, and stays asserted
// below: a template added to the seeded set changes what every new trip gets,
// which is a decision, not a rename.
const SEEDED_TITLES = DEFAULT_TEMPLATES.map((t) => t.title);
const SEEDED_TITLES_SORTED = [...SEEDED_TITLES].sort();

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
  // **One page, not two, since SPEC §25** — Mitchell, 2026-09-12: *"Only 1
  // notebook per trip is always generated, this is undeletable notebook that
  // needs to be created on every new trip."* Counted off `DEFAULT_TEMPLATES`
  // rather than hard-coded, so the next change to what a trip is seeded with is
  // one edit rather than a number in three places.
  it("lazily instantiates the default pages on first list", async () => {
    const { tripId } = await seedTrip();
    const first = await listPages(tripId);
    expect(first.map((p) => p.title).sort()).toEqual(SEEDED_TITLES_SORTED);
    expect(first).toHaveLength(DEFAULT_TEMPLATES.length);
    const second = await listPages(tripId); // idempotent — no duplicate instantiation
    expect(second).toHaveLength(DEFAULT_TEMPLATES.length);
  });

  // §25: the Overview *"appears in the Notebook index like any other page"* and
  // its delete control *"refuses with a reason"* rather than being hidden — so
  // the refusal has to be real at the server, where a keyboard shortcut or a
  // direct call lands.
  it("refuses to delete the seeded Overview, and says why", async () => {
    const { tripId } = await seedTrip();
    const [overview] = await listPages(tripId);
    const outcome = await deletePage(overview!.id);
    expect(outcome).toEqual({
      ok: false,
      reason: "undeletable",
      message: expect.stringContaining("comes with the trip"),
    });
    // Still there, which is the half that would matter to a person.
    expect(await getPage(overview!.id)).not.toBeNull();
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
  // unfixed. ("Day Sheet" is what that seed was called then; it is "Day
  // overview" now — the observation is quoted as it was recorded.)
  it("does not duplicate default pages when two first visits race", async () => {
    const { tripId } = await seedTrip();
    await Promise.all([0, 1, 2, 3].map(() => db.execute(sql`select 1`)));

    const [a, b] = await Promise.all([listPages(tripId), listPages(tripId)]);

    expect(a.map((p) => p.title).sort()).toEqual(SEEDED_TITLES_SORTED);
    expect(b.map((p) => p.title).sort()).toEqual(SEEDED_TITLES_SORTED);
    const after = await listPages(tripId);
    expect(after.map((p) => p.title).sort()).toEqual(SEEDED_TITLES_SORTED);
  });

  // Found by walking the Notebook index in a browser on 2026-09-03, not by a
  // test: a notebook created through the index appeared FIRST on the next
  // read, while `NotebookScreen.handleCreate` had just appended it to the end
  // of its own list. `listPages` was a bare `SELECT … WHERE` with no ORDER BY,
  // so Postgres returned rows in physical order — which an UPDATE changes,
  // because it writes a new row version.
  //
  // **The clock is frozen, and that is what makes this test worth having.**
  // The first version ran on the real clock and passed locally while failing in
  // CI, because the bug only appears when seeding and creating land in the SAME
  // millisecond — which a fast runner does and a slow container does not. With
  // Date frozen, the collision happens every run. Only `Date` is faked, not
  // timers: this suite does real I/O against Postgres, and faking `setTimeout`
  // would hang the driver.
  it("returns notebooks in a stable order that an edit does not disturb", async () => {
    const { tripId } = await seedTrip();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-03T02:00:00.000Z"));
      const seeded = await listPages(tripId);
      // The prebuilt pair comes back in `instantiateDefaults` order, which is
      // the order SPEC §7 names them in — not whichever the database felt like.
      expect(seeded.map((p) => p.title)).toEqual(SEEDED_TITLES);

      // Created on the very millisecond the seeding ran. This is the case that
      // broke CI: seeds stamped forward from `startedAt` tied with it, and the
      // random-UUID tiebreaker put "Packing" in the middle of the list.
      const mine = await createPage(
        tripId,
        { title: "Packing", context: { tripId }, content: newPageDoc() },
        "user-1",
      );
      expect((await listPages(tripId)).map((p) => p.title)).toEqual([...SEEDED_TITLES, "Packing"]);

      // Edit the first row, then the last. Neither may move — this is the half
      // that catches the physical-order reshuffle, since an UPDATE writes a new
      // row version.
      await updatePage(seeded[0]!.id, { title: SEEDED_TITLES[0]! });
      await updatePage(mine.id, { title: "Packing" });
      expect((await listPages(tripId)).map((p) => p.title)).toEqual([...SEEDED_TITLES, "Packing"]);
    } finally {
      vi.useRealTimers();
    }
  });

  // `listPages` has always been typed `Promise<PageSummary[]>` while returning
  // full `Page` rows, so every notebook's whole document went over the wire and
  // `PageSummary.parse` stripped it in the BROWSER, after the download. The
  // Notebooks menu re-reads this list on every open (Copilot, PR #126).
  it("returns summaries, not whole documents — no notebook content crosses the wire", async () => {
    const { tripId } = await seedTrip();
    await listPages(tripId);
    await createPage(
      tripId,
      {
        title: "Heavy",
        context: { tripId },
        content: newPageDoc([{ type: "paragraph", content: [{ type: "text", text: "x".repeat(5000) }] }]),
      },
      "user-1",
    );

    const listed = await listPages(tripId);
    for (const summary of listed) {
      expect(summary).not.toHaveProperty("content");
    }
    // The rest of the summary is still there — a projection, not a truncation.
    const heavy = listed.find((p) => p.title === "Heavy")!;
    expect(heavy.actorId).toBe("user-1");
    expect(heavy.context.tripId).toBe(tripId);
    expect(typeof heavy.updatedAt).toBe("string");
    // And the document itself is still readable one page at a time.
    expect((await getPage(heavy.id))!.content).toBeDefined();
  });

  it("creates, reads, updates, deletes a page", async () => {
    const { tripId } = await seedTrip();
    const created = await createPage(
      tripId,
      { title: "Notes", context: { tripId }, content: newPageDoc() },
      "user-1",
    );
    expect(created.title).toBe("Notes");
    const fetched = await getPage(created.id);
    expect(fetched!.id).toBe(created.id);
    const updated = await updatePage(created.id, { title: "Renamed" });
    expect(updated!.title).toBe("Renamed");
    expect(updated!.updatedAt >= created.updatedAt).toBe(true);
    expect(await deletePage(created.id)).toEqual({ ok: true });
    expect(await getPage(created.id)).toBeNull();
  });
});
