import { newPageDoc } from "@tc/contracts";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { listPages, getPage } from "./pages";
import { executePageCommand } from "./pageCommands";

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
  //
  // **Through the command now.** `deletePage` was this refusal's home when the
  // table was the source of truth; it is `decidePageCommand`'s since page
  // writes became events, and the message is unchanged so a reader cannot tell
  // which one refused them.
  it("refuses to delete the seeded Overview, and says why", async () => {
    const { tripId } = await seedTrip();
    const [overview] = await listPages(tripId);
    const outcome = await executePageCommand(
      { type: "DeletePage", tripId, pageId: overview!.id },
      "user-1",
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe("page-undeletable");
    expect(!outcome.ok && outcome.error.message).toContain("comes with the trip");
    // Still there, which is the half that would matter to a person.
    expect(await getPage(overview!.id)).not.toBeNull();
  });

  // **The refusal used to be removable through the front door, and now it
  // cannot be reached at all.**
  //
  // `updatePage` stored `input.context` whole, and `PageContext.kind` is what
  // marks the Overview — so a PATCH carrying `{ tripId }` and nothing else
  // stripped the marker, and the next DELETE removed the page every trip is
  // supposed to keep (CodeRabbit, PR 170). That was fixed by carrying the
  // stored `kind` across.
  //
  // `EditPage` has no `context` field AT ALL, so the abuse is now structural
  // rather than guarded: there is no request that can carry a marker, in
  // either direction. This asserts the property survives the move — both
  // halves, the same two abuses the old pair of tests covered.
  it("an edit cannot strip the Overview's marker, nor grant it", async () => {
    const { tripId } = await seedTrip();
    const [overview] = await listPages(tripId);

    const edited = await executePageCommand(
      { type: "EditPage", tripId, pageId: overview!.id, title: "Renamed" },
      "user-1",
    );
    expect(edited.ok).toBe(true);
    expect(edited.ok && edited.page?.context.kind, "the marker is identity").toBe("overview");
    const stillRefused = await executePageCommand(
      { type: "DeletePage", tripId, pageId: overview!.id },
      "user-1",
    );
    expect(!stillRefused.ok && stillRefused.error.code).toBe("page-undeletable");

    // The other direction: an ordinary page cannot promote itself, so it stays
    // deletable however it is edited.
    const mineId = randomUUID();
    await executePageCommand(
      { type: "CreatePage", tripId, pageId: mineId, title: "Mine", context: { tripId }, content: newPageDoc([]) },
      "user-1",
    );
    const promoted = await executePageCommand(
      { type: "EditPage", tripId, pageId: mineId, title: "Mine, renamed" },
      "user-1",
    );
    expect(promoted.ok && promoted.page?.context.kind, "a page cannot promote itself").toBeUndefined();
    expect((await executePageCommand({ type: "DeletePage", tripId, pageId: mineId }, "user-1")).ok).toBe(true);
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
      const mineId = randomUUID();
      await executePageCommand(
        { type: "CreatePage", tripId, pageId: mineId, title: "Packing", context: { tripId }, content: newPageDoc() },
        "user-1",
      );
      expect((await listPages(tripId)).map((p) => p.title)).toEqual([...SEEDED_TITLES, "Packing"]);

      // Edit the first row, then the last. Neither may move — this is the half
      // that catches the physical-order reshuffle, since an UPDATE writes a new
      // row version.
      // Titles that DIFFER, because a no-op edit now writes no event and
      // therefore no row version — and a row that was never rewritten cannot
      // demonstrate that a rewrite does not reorder the list.
      await executePageCommand({ type: "EditPage", tripId, pageId: seeded[0]!.id, title: "Touched" }, "user-1");
      await executePageCommand({ type: "EditPage", tripId, pageId: mineId, title: "Packing, touched" }, "user-1");
      expect((await listPages(tripId)).map((p) => p.title)).toEqual([
        "Touched",
        ...SEEDED_TITLES.slice(1),
        "Packing, touched",
      ]);
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
    await executePageCommand(
      {
        type: "CreatePage",
        tripId,
        pageId: randomUUID(),
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
    const pageId = randomUUID();
    const created = await executePageCommand(
      { type: "CreatePage", tripId, pageId, title: "Notes", context: { tripId }, content: newPageDoc() },
      "user-1",
    );
    expect(created.ok && created.page?.title).toBe("Notes");
    const fetched = await getPage(pageId);
    expect(fetched!.id).toBe(pageId);
    const updated = await executePageCommand(
      { type: "EditPage", tripId, pageId, title: "Renamed" },
      "user-1",
    );
    expect(updated.ok && updated.page?.title).toBe("Renamed");
    expect((updated.ok && updated.page!.updatedAt) >= fetched!.updatedAt).toBe(true);
    expect((await executePageCommand({ type: "DeletePage", tripId, pageId }, "user-1")).ok).toBe(true);
    expect(await getPage(pageId)).toBeNull();
  });
});
