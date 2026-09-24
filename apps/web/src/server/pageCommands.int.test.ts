import { newPageDoc } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { executeTripCommand } from "./commands";
import { executePageCommand } from "./pageCommands";
import { readStream } from "./eventStore";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { getTripEventsAfter } from "./broadcast";
import { rebuildProjections, getTripDetail } from "./projections";
import { listPages } from "./pages";

const OWNER = "user-1";

async function seedTrip() {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, OWNER);
  return tripId;
}

const docWith = (text: string) => {
  const doc = newPageDoc();
  return { ...doc, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
};

async function createPageVia(tripId: string, title: string, text: string) {
  const pageId = randomUUID();
  const result = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title, context: { tripId }, content: docWith(text) },
    OWNER,
  );
  expect(result.ok).toBe(true);
  return pageId;
}

describe("executePageCommand", () => {
  // **A row the genesis backfill had to skip is still deletable.**
  //
  // `missingGenesis` skips a row whose `content` will not parse as a `PageDoc`
  // — ADR-038 decision 4, a document this build cannot represent must not be
  // written back through the log. The row then never enters the fold, so
  // `decidePageCommand` answers `page-not-found` for EDIT and for DELETE
  // alike, and the SQL `deletePage` that used to remove such a row is gone.
  // Without this, an unreadable notebook is stuck in the list permanently.
  // Delete does not save the document, so decision 4 does not forbid it.
  it("deletes a legacy row whose document the backfill had to skip", async () => {
    const tripId = await seedTrip();
    const pageId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(pages).values({
      id: pageId,
      tripId,
      title: "Old notes",
      context: { tripId },
      // `PageDoc` is `.strict()`, so an unknown top-level key is unparseable —
      // a document from a build this one does not know about.
      content: { v: 1, type: "doc", content: [], fromANewerBuild: true } as never,
      createdAt: now,
      updatedAt: now,
      actorId: OWNER,
    });

    const result = await executePageCommand({ type: "DeletePage", tripId, pageId }, OWNER);
    expect(result.ok).toBe(true);

    const rows = await db.select().from(pages).where(eq(pages.id, pageId));
    expect(rows).toHaveLength(0);
  });

  // The rescue must not become a way around SPEC §25's undeletable Overview.
  it("still refuses to delete the Overview when its document will not parse", async () => {
    const tripId = await seedTrip();
    const pageId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(pages).values({
      id: pageId,
      tripId,
      title: "Overview",
      context: { tripId, kind: "overview" },
      content: { v: 1, type: "doc", content: [], fromANewerBuild: true } as never,
      createdAt: now,
      updatedAt: now,
      actorId: OWNER,
    });

    const result = await executePageCommand({ type: "DeletePage", tripId, pageId }, OWNER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("page-undeletable");

    const rows = await db.select().from(pages).where(eq(pages.id, pageId));
    expect(rows).toHaveLength(1);
  });

  it("writes the row and the event in one transaction", async () => {
    const tripId = await seedTrip();
    const pageId = await createPageVia(tripId, "Packing", "socks");

    const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
    expect(row?.title).toBe("Packing");

    const stream = await readStream(db, tripId);
    expect(stream.map((e) => e.type)).toContain("PageCreated");
  });

  // THE REPORTED BUG, at the layer that caused it. Before this, a notebook
  // save did not move the trip's headSeq, so a co-traveller's poll was
  // correctly told "nothing happened" while their Overview went stale.
  it("moves the trip's headSeq, which is what wakes the other device", async () => {
    const tripId = await seedTrip();
    const before = (await getTripEventsAfter(tripId, 0)).headSeq;

    const pageId = await createPageVia(tripId, "Packing", "socks");
    const afterCreate = (await getTripEventsAfter(tripId, 0)).headSeq;
    expect(afterCreate).toBeGreaterThan(before);

    await executePageCommand(
      { type: "EditPage", tripId, pageId, content: docWith("socks and shoes") },
      OWNER,
    );
    expect((await getTripEventsAfter(tripId, 0)).headSeq).toBeGreaterThan(afterCreate);
  });

  // An edit session that ends where it began still commits. Appending there
  // would wake every co-traveller for a change that did not happen, and put a
  // row in the history panel for nothing (ADR-036 decision 5).
  it("appends nothing when the content did not change", async () => {
    const tripId = await seedTrip();
    const pageId = await createPageVia(tripId, "Packing", "socks");
    const head = (await getTripEventsAfter(tripId, 0)).headSeq;

    const again = await executePageCommand(
      { type: "EditPage", tripId, pageId, content: docWith("socks") },
      OWNER,
    );
    expect(again.ok).toBe(true);
    expect((await getTripEventsAfter(tripId, 0)).headSeq).toBe(head);
  });

  it("refuses a non-member", async () => {
    const tripId = await seedTrip();
    const pageId = await createPageVia(tripId, "Packing", "socks");
    const result = await executePageCommand(
      { type: "EditPage", tripId, pageId, content: docWith("x") },
      "someone-else",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("refuses to delete the Overview", async () => {
    const tripId = await seedTrip();
    const seeded = await listPages(tripId);
    const overview = seeded.find((p) => p.context.kind === "overview");
    expect(overview).toBeDefined();
    const result = await executePageCommand(
      { type: "DeletePage", tripId, pageId: overview!.id },
      OWNER,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("page-undeletable");
  });

  it("deletes an ordinary page, row and event together", async () => {
    const tripId = await seedTrip();
    const pageId = await createPageVia(tripId, "Packing", "socks");
    const result = await executePageCommand({ type: "DeletePage", tripId, pageId }, OWNER);
    expect(result.ok).toBe(true);
    expect(await db.select().from(pages).where(eq(pages.id, pageId))).toHaveLength(0);
    const stream = await readStream(db, tripId);
    expect(stream.map((e) => e.type)).toContain("PageDeleted");
  });

  // The regression this whole shape risks: a page event in the stream must not
  // break the trip's own command path, which folds the WHOLE stream at step 2.
  it("leaves trip commands working on a stream that carries page events", async () => {
    const tripId = await seedTrip();
    await createPageVia(tripId, "Packing", "socks");
    const result = await executeTripCommand(
      { type: "AddDay", tripId, dayId: randomUUID() },
      OWNER,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.detail.days).toHaveLength(1);
  });

  // ... and the trip's history must describe the notebook change rather than
  // skipping it or throwing.
  it("puts the notebook change in the trip's history", async () => {
    const tripId = await seedTrip();
    await createPageVia(tripId, "Packing", "socks");
    const after = await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER);
    expect(after.ok).toBe(true);
    const descriptions = after.ok ? after.history.entries.map((e) => e.description) : [];
    expect(descriptions).toContain('Added the notebook "Packing"');
  });

  // The gap the Overview test found: every page that existed before this
  // milestone is a row with no genesis event, so the fold cannot see it.
  it("edits a page that existed before the log knew about pages", async () => {
    const tripId = await seedTrip();
    const seeded = await listPages(tripId); // lazily seeds the Overview ROW, no event
    const overview = seeded.find((p) => p.context.kind === "overview")!;
    expect((await readStream(db, tripId)).map((e) => e.type)).not.toContain("PageCreated");

    const result = await executePageCommand(
      { type: "EditPage", tripId, pageId: overview.id, content: docWith("our plan") },
      OWNER,
    );
    expect(result.ok).toBe(true);

    // Genesis and edit, in that order, in one batch.
    const types = (await readStream(db, tripId)).map((e) => e.type);
    expect(types.filter((t) => t.startsWith("Page"))).toEqual(["PageCreated", "PageEdited"]);
  });

  // The backfilled genesis must keep the ROW's owner, not the editor's — SPEC
  // §7 draws "Comes with your trip" vs "Yours" off exactly this field.
  it("backfills the page's own owner rather than whoever edited it", async () => {
    const tripId = await seedTrip();
    const overview = (await listPages(tripId)).find((p) => p.context.kind === "overview")!;
    expect(overview.actorId).toBe("system");

    await executePageCommand(
      { type: "EditPage", tripId, pageId: overview.id, content: docWith("x") },
      OWNER,
    );
    const created = (await readStream(db, tripId)).find((e) => e.type === "PageCreated");
    expect((created?.payload as { actorId: string }).actorId).toBe("system");
  });

  // **Undo/revert do NOT touch notebooks yet, and this pins that on purpose.**
  // `decideHistoryCommand` diffs the trip aggregate only. Wiring
  // `diffPageStates` into it is the remaining half of "the same functionality",
  // and it cannot be done naively: a page's genesis sits at the seq it was
  // BACKFILLED, so reverting to any earlier version would diff against a state
  // with no pages in it and emit PageDeleted for every notebook on the trip.
  // This test is what will go red the moment someone wires it without solving
  // that, which is the point of writing it now.
  it("does not delete notebooks when the trip is reverted behind their genesis", async () => {
    const tripId = await seedTrip();
    const pageId = await createPageVia(tripId, "Packing", "socks");
    const beforeDay = (await readStream(db, tripId)).length;
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER);

    const reverted = await executeTripCommand({ type: "RevertToState", tripId, toSeq: 1 }, OWNER);
    expect(reverted.ok).toBe(true);
    expect(beforeDay).toBeGreaterThan(1);

    // The notebook is still there.
    const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
    expect(row?.title).toBe("Packing");
  });

  // **The rebuild reads EVERY stream on the instance**, so one trip carrying a
  // notebook event took out the projection rebuild for all of them. That was
  // caught by commands.int.test.ts's GOLDEN test, which passes in isolation and
  // failed only in the full run — i.e. by accident, through a shared database.
  // This asserts it directly, so the next person does not need the accident.
  it("survives a projection rebuild", async () => {
    const tripId = await seedTrip();
    await createPageVia(tripId, "Packing", "socks");
    await executeTripCommand({ type: "SetTripName", tripId, name: "Rome, later" }, OWNER);

    await rebuildProjections();

    const detail = await getTripDetail(tripId);
    expect(detail?.name).toBe("Rome, later");
    expect(await db.select().from(pages).where(eq(pages.tripId, tripId))).not.toHaveLength(0);
  });

  // **GOLDEN, for the `pages` table (ADR-036, M14 link 9).** The row carries
  // only what the log carries, so throwing rows away and rebuilding must give
  // back exactly what the command path wrote — with two kinds of row the log
  // does not fully describe, which is where a naive rebuild destroys notebooks:
  //
  //  - rows `listPages` seeded and nobody has commanded since: NO events, so
  //    the log cannot rebuild them and the rebuild must not delete them;
  //  - rows that got a BACKFILLED genesis (KI-2026-09-22-c): the event exists,
  //    but it was written when a sibling was first edited, so its `occurredAt`
  //    is not the page's `createdAt` — and `createdAt` is the list's order.
  //
  // Plus the pre-fix document shapes KI-2026-09-24-d names: a row with no `v`
  // and a node already stored wrapped as `unknown`. A rebuild that parses
  // without re-serialising wraps it once more on every run.
  it("GOLDEN: the pages table rebuilds from the log", async () => {
    const tripId = await seedTrip();
    const overview = (await listPages(tripId)).find((p) => p.context.kind === "overview")!; // a row, no event
    const legacyId = randomUUID();
    await db.insert(pages).values({
      id: legacyId,
      tripId,
      title: "Old notes",
      context: { tripId },
      content: {
        type: "doc",
        content: [{ type: "unknown", raw: { type: "fromANewerBuild" } }, { type: "paragraph" }],
      } as never,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      actorId: OWNER,
    });

    // The first command backfills both rows; only the Overview is edited, so
    // "Old notes" is known to the log by its backfilled genesis alone.
    await executePageCommand({ type: "EditPage", tripId, pageId: overview.id, content: docWith("our plan") }, OWNER);
    const packing = await createPageVia(tripId, "Packing", "socks");
    await executePageCommand(
      { type: "EditPage", tripId, pageId: packing, title: "Packing list", content: docWith("socks, shoes") },
      OWNER,
    );
    const scratch = await createPageVia(tripId, "Scratch", "tmp");
    await executePageCommand({ type: "DeletePage", tripId, pageId: scratch }, OWNER);

    // A second trip whose notebooks the log has never heard of.
    const untouchedTrip = await seedTrip();
    await listPages(untouchedTrip);

    const tripIds = [tripId, untouchedTrip];
    const rowsOfThisTest = () =>
      db.select().from(pages).where(inArray(pages.tripId, tripIds)).orderBy(asc(pages.id));
    const live = await rowsOfThisTest();
    const liveOrder = (await listPages(tripId)).map((p) => p.title);
    expect(live).toHaveLength(4);
    expect(liveOrder).toEqual(["Old notes", overview.title, "Packing list"]);
    // The backfill did not restamp the row it described. The comparison below
    // cannot see this — live and rebuilt would move together — so it is its own.
    const legacy = live.find((r) => r.id === legacyId)!;
    expect([legacy.createdAt, legacy.updatedAt].map((t) => new Date(t).toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    ]);
    // Nor wrapped its pre-fix node a second time — also invisible to the
    // comparison, since live and rebuilt would wrap alike. It did gain the `v`
    // its genesis parse defaulted, which is the log's document and is right.
    expect(legacy.content).toMatchObject({ v: 1, content: [{ type: "unknown", raw: { type: "fromANewerBuild" } }, {}] });

    // Drift, of every kind a rebuild has to undo: a lost row, a changed row
    // (one edited, one only ever backfilled), and a row the log deleted.
    await db.delete(pages).where(eq(pages.id, packing));
    await db.update(pages).set({ content: docWith("drifted") as never }).where(eq(pages.id, overview.id));
    await db.update(pages).set({ title: "drifted" }).where(eq(pages.id, legacyId));
    await db.insert(pages).values({ ...live.find((r) => r.id === overview.id)!, id: scratch, title: "Scratch" });

    await rebuildProjections();

    expect(await rowsOfThisTest()).toEqual(live);
    expect((await listPages(tripId)).map((p) => p.title)).toEqual(liveOrder);
  });

  it("refuses the demo trip", async () => {
    const result = await executePageCommand(
      {
        type: "CreatePage",
        tripId: "00000000-0000-4000-8000-00000000d000",
        pageId: randomUUID(),
        title: "x",
        context: { tripId: "00000000-0000-4000-8000-00000000d000" },
        content: newPageDoc(),
      },
      OWNER,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("demo-trip-readonly");
  });
});

// **The stale-save guard** (CodeRabbit, PR #222). `expectedSeq` cannot refuse
// an older document that arrives last, because each request reads the head
// current when IT arrives. `expectedUpdatedAt` is the revision the client
// typed against, so the older of two racing saves is the one refused.
describe("executePageCommand with expectedUpdatedAt", () => {
  async function pageAt(tripId: string, text: string) {
    const pageId = await createPageVia(tripId, "Packing", text);
    const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
    return { pageId, revision: row!.updatedAt };
  }
  const edit = (tripId: string, pageId: string, text: string, expectedUpdatedAt?: string) =>
    executePageCommand(
      { type: "EditPage", tripId, pageId, content: docWith(text), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
      OWNER,
    );
  const storedText = async (pageId: string) => {
    const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
    return JSON.stringify(row?.content);
  };

  it("refuses an edit typed against an older revision, and appends nothing", async () => {
    const tripId = await seedTrip();
    const { pageId, revision } = await pageAt(tripId, "socks");
    expect((await edit(tripId, pageId, "socks, shoes")).ok).toBe(true);
    const head = (await getTripEventsAfter(tripId, 0)).headSeq;

    const stale = await edit(tripId, pageId, "socks, hat", revision);

    expect(stale).toEqual({
      ok: false,
      error: { code: "page-changed", message: "This page changed since you opened it." },
    });
    expect((await getTripEventsAfter(tripId, 0)).headSeq).toBe(head);
    expect(await storedText(pageId)).toContain("socks, shoes");
  });

  it("takes an edit typed against the current revision", async () => {
    const tripId = await seedTrip();
    const { pageId, revision } = await pageAt(tripId, "socks");
    const result = await edit(tripId, pageId, "socks, shoes", revision);
    expect(result.ok).toBe(true);
    expect(await storedText(pageId)).toContain("socks, shoes");
  });

  // The revision is an instant, not a spelling. What a client echoes is
  // Postgres's text, and a proxy or a future client re-serialising it as ISO
  // must not turn every save into a conflict.
  it("takes the current revision however the timestamp is spelled", async () => {
    const tripId = await seedTrip();
    const { pageId, revision } = await pageAt(tripId, "socks");
    const iso = new Date(revision).toISOString();
    expect(iso).not.toBe(revision);
    expect((await edit(tripId, pageId, "socks, shoes", iso)).ok).toBe(true);
  });

  // Every caller that predates the field: the assistant's page tools,
  // `/api/v1`, the seeders. Last write wins, as it always has.
  it("keeps last-write-wins for an edit that names no revision", async () => {
    const tripId = await seedTrip();
    const { pageId } = await pageAt(tripId, "socks");
    expect((await edit(tripId, pageId, "socks, shoes")).ok).toBe(true);
    expect((await edit(tripId, pageId, "socks, hat")).ok).toBe(true);
    expect(await storedText(pageId)).toContain("socks, hat");
  });

  // A save of what the page already says is a no-op whatever revision it
  // names, BEFORE the revision is looked at. The case that matters: a keepalive
  // that landed, and then the ordinary commit of the same document behind it.
  // Refusing that would report a conflict with the author's own words.
  it("answers a no-op edit as a success, even against an older revision", async () => {
    const tripId = await seedTrip();
    const { pageId, revision } = await pageAt(tripId, "socks");
    expect((await edit(tripId, pageId, "socks, shoes")).ok).toBe(true);
    const head = (await getTripEventsAfter(tripId, 0)).headSeq;

    const same = await edit(tripId, pageId, "socks, shoes", revision);

    expect(same.ok).toBe(true);
    expect((await getTripEventsAfter(tripId, 0)).headSeq).toBe(head);
  });

  // A page the log has never heard of is a ROW (lazily seeded), and its
  // revision is the row's. The first guarded save of it must not be refused.
  it("takes a guarded edit of a page that existed before the log knew about pages", async () => {
    const tripId = await seedTrip();
    const overview = (await listPages(tripId)).find((p) => p.context.kind === "overview")!;
    const result = await edit(tripId, overview.id, "our plan", overview.updatedAt);
    expect(result.ok).toBe(true);
  });

  // **THE interleaving this exists for.** Commit A goes out typed against r0
  // and is held up in the network. The page unloads and the keepalive K goes
  // past it with NO revision (the client cannot know one while A is in
  // flight), lands, and moves the page to r1. Then A arrives. Before this, A
  // won: the author's older words over their newer ones.
  it("refuses the older commit that lands after the keepalive which overtook it", async () => {
    const tripId = await seedTrip();
    const { pageId, revision: r0 } = await pageAt(tripId, "draft");

    const keepalive = await edit(tripId, pageId, "draft, then the newest line");
    expect(keepalive.ok).toBe(true);
    const older = await edit(tripId, pageId, "draft, then a line", r0);

    expect(!older.ok && older.error.code).toBe("page-changed");
    expect(await storedText(pageId)).toContain("draft, then the newest line");
  });
});
