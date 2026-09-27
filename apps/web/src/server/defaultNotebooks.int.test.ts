// The trip's default notebooks: add the missing ones, reset one, undo a reset
// (Mitchell, 2026-09-27; owner only). Against real Postgres, because each of
// these is a claim about the log and the projection together: the rows that
// come back, the events that went in, and what folding those events recovers.
//
// No beforeEach truncation: every test mints its own trip, as the sibling
// suites do (`pages.int.test.ts`).
import { newPageDoc, PageDoc, SYSTEM_ACTOR_ID } from "@tc/contracts";
import { DEFAULT_TEMPLATES, OVERVIEW_TEMPLATE } from "@tc/pages";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { executeTripCommand } from "./commands";
import { appendToStream, readStream } from "./eventStore";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { events, pages } from "./db/schema";
import { applyPageEvents, rebuildProjections } from "./projections";
import { db } from "./db/client";
import { listPages } from "./pages";
import { grantMembership } from "./access/members";
import { entitleAccounts } from "./test-support/entitledAccount";
import {
  addMissingDefaultPages,
  executePageCommand,
  resetPageToDefault,
  restorePageVersion,
} from "./pageCommands";

const docWith = (text: string) => ({
  ...newPageDoc(),
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function tripOwnedBy(ownerId: string) {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Lisbon 2028" }, ownerId);
  expect(created.ok).toBe(true);
  return tripId;
}

const owner = () => `owner-${randomUUID()}`;

// A seed that is not the Overview, by its template rather than by its words.
const A_SEED = DEFAULT_TEMPLATES.at(-1)!.title;

describe("addMissingDefaultPages", () => {
  // A trip made before a seed existed, simulated the way it looks from here: a
  // seed the trip does not have. Deleted through the command, so the row and
  // the log agree about its absence.
  it("adds only the missing seeds, leaves the others untouched, and is idempotent", async () => {
    const ownerId = owner();
    const tripId = await tripOwnedBy(ownerId);
    const seeded = await listPages(tripId);
    const gone = seeded.find((p) => p.title === A_SEED)!;
    const kept = seeded.filter((p) => p.id !== gone.id);
    expect((await executePageCommand({ type: "DeletePage", tripId, pageId: gone.id }, ownerId)).ok).toBe(true);
    // An edit to a seed that is NOT missing, so "untouched" means something.
    const overview = kept.find((p) => p.context.kind === "overview")!;
    expect((await executePageCommand({ type: "EditPage", tripId, pageId: overview.id, content: docWith("ours") }, ownerId)).ok).toBe(true);
    const before = await listPages(tripId);

    const added = await addMissingDefaultPages(tripId, ownerId);
    expect(added.ok).toBe(true);

    const after = await listPages(tripId);
    expect(after.map((p) => p.title).sort()).toEqual(DEFAULT_TEMPLATES.map((t) => t.title).sort());
    // The survivors are the same rows, same ids, not re-seeded.
    for (const page of before) expect(after.find((p) => p.id === page.id)).toEqual(page);
    // Back under the id it had, so every link to it still resolves — the
    // Overview's card above all, which a fresh id left saying "this notebook
    // was deleted" (walk on the reset PR, 2026-09-27).
    const back = after.find((p) => p.title === A_SEED)!;
    expect(back.id).toBe(gone.id);
    expect(back.actorId).toBe(SYSTEM_ACTOR_ID);

    // Again: nothing missing, nothing written — not even an event.
    const head = (await readStream(db, tripId)).length;
    const again = await addMissingDefaultPages(tripId, ownerId);
    expect(again.ok && again.seq).toBe(null);
    expect((await listPages(tripId)).length).toBe(after.length);
    expect((await readStream(db, tripId)).length).toBe(head);
  });
});

// Mitchell, 2026-09-27: *"You should be allowed to rename a default notebook,
// or delete one."* A default is known by its seed key, so a renamed one is
// still that default: "Add missing" has nothing to add, and Reset still works.
// Until then a seed was known by its title, and this trip got a second "Money"
// beside "Budget" (KI-2026-09-27-e).
describe("a renamed default notebook", () => {
  it("is still that default: nothing is missing, and it resets to its template", async () => {
    const ownerId = owner();
    const tripId = await tripOwnedBy(ownerId);
    const money = (await listPages(tripId)).find((p) => p.seedKey === "money")!;
    expect((await executePageCommand({ type: "EditPage", tripId, pageId: money.id, title: "Budget" }, ownerId)).ok).toBe(true);

    const added = await addMissingDefaultPages(tripId, ownerId);
    expect(added.ok && added.seq).toBe(null);
    const titles = (await listPages(tripId)).map((p) => p.title);
    expect(titles.filter((t) => t === "Money")).toEqual([]);
    expect(titles.filter((t) => t === "Budget")).toHaveLength(1);

    const reset = await resetPageToDefault(tripId, money.id, ownerId);
    expect(reset.ok && reset.page).toMatchObject({ id: money.id, title: "Money", seedKey: "money" });
  });
});

// A seed deleted and then seeded again leaves the log holding two `system`
// pages with one title, at different times. The rebuild replays both, and
// used to re-insert the old one on top of the new one's row, failing on the
// seed index (then `pages_system_seed_unique`) — for every trip on the
// instance, since the rebuild reads them all. Found by the full integration
// run, not this file.
describe("a projection rebuild after a seed was added back", () => {
  it("rebuilds the trip's notebooks as they were", async () => {
    const ownerId = owner();
    const tripId = await tripOwnedBy(ownerId);
    const gone = (await listPages(tripId)).find((p) => p.title === A_SEED)!;
    await executePageCommand({ type: "DeletePage", tripId, pageId: gone.id }, ownerId);
    expect((await addMissingDefaultPages(tripId, ownerId)).ok).toBe(true);
    const live = await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.id));

    await rebuildProjections();

    expect(await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.id))).toEqual(live);
  });
});

describe("resetPageToDefault", () => {
  it("puts the template back under the same id, as an edit the log can fold back past", async () => {
    const ownerId = owner();
    const tripId = await tripOwnedBy(ownerId);
    const seeded = await listPages(tripId);
    const overview = seeded.find((p) => p.context.kind === "overview")!;
    await executePageCommand(
      { type: "EditPage", tripId, pageId: overview.id, title: "Our plan", content: docWith("our own words") },
      ownerId,
    );

    const reset = await resetPageToDefault(tripId, overview.id, ownerId);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;

    // Same id, the template's title, and the template's document built against
    // this trip's own siblings (what the Overview's links resolve through).
    expect(reset.page?.id).toBe(overview.id);
    expect(reset.page?.title).toBe(OVERVIEW_TEMPLATE.title);
    // Built here from the rows, NOT through `defaultDocumentFor` — asking the
    // function under test for the expected value passed with its sibling ids
    // thrown away (seen, red-first).
    const idsByKey = Object.fromEntries(
      DEFAULT_TEMPLATES.map((t) => [
        t.key,
        seeded.find((p) => (t === OVERVIEW_TEMPLATE ? p.context.kind === "overview" : p.title === t.title))!.id,
      ]),
    );
    expect(PageDoc.parse(reset.page?.content)).toEqual(PageDoc.parse(OVERVIEW_TEMPLATE.buildContent!(idsByKey)));

    // One more edit in the trip's log, not a delete and recreate.
    const stream = await readStream(db, tripId);
    const last = stream.at(-1)!;
    expect(last.type).toBe("PageEdited");
    expect((last.payload as { pageId: string }).pageId).toBe(overview.id);
    expect(stream.map((e) => e.type)).not.toContain("PageDeleted");

    // And the version before it is recoverable from the log.
    const restored = await restorePageVersion(tripId, overview.id, reset.seq! - 1, ownerId);
    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.page?.title).toBe("Our plan");
    expect(PageDoc.parse(restored.ok && restored.page?.content)).toEqual(PageDoc.parse(docWith("our own words")));
  });

  it("refuses a notebook a person made — it has no default", async () => {
    const ownerId = owner();
    const tripId = await tripOwnedBy(ownerId);
    const pageId = randomUUID();
    await executePageCommand(
      { type: "CreatePage", tripId, pageId, title: A_SEED, context: { tripId }, content: docWith("mine") },
      ownerId,
    );
    const reset = await resetPageToDefault(tripId, pageId, ownerId);
    expect(!reset.ok && reset.error.code).toBe("not-a-default");
  });
});

// Mitchell, 2026-09-27: *"Only trip owner"*. An editor who CAN edit notebooks
// is refused these, which is what makes it an owner rule rather than the
// editor rule every other notebook write has.
describe("the default-notebook actions are the owner's", () => {
  async function sharedTrip() {
    const ownerId = owner();
    await entitleAccounts([ownerId]); // so granted collaborators keep their role (M20)
    const tripId = await tripOwnedBy(ownerId);
    const now = new Date().toISOString();
    const editorId = `editor-${randomUUID()}`;
    const viewerId = `viewer-${randomUUID()}`;
    await grantMembership(db, { tripId, userId: editorId, role: "editor", invitedBy: ownerId, now });
    await grantMembership(db, { tripId, userId: viewerId, role: "viewer", invitedBy: ownerId, now });
    const overview = (await listPages(tripId)).find((p) => p.context.kind === "overview")!;
    return { tripId, ownerId, editorId, viewerId, overview };
  }

  it("refuses an editor and a viewer, and lets the owner through", async () => {
    const { tripId, ownerId, editorId, viewerId, overview } = await sharedTrip();
    // The editor really is an editor: an ordinary notebook edit goes through.
    expect((await executePageCommand({ type: "EditPage", tripId, pageId: overview.id, content: docWith("x") }, editorId)).ok).toBe(true);

    for (const actor of [editorId, viewerId]) {
      expect(await resetPageToDefault(tripId, overview.id, actor)).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await addMissingDefaultPages(tripId, actor)).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await restorePageVersion(tripId, overview.id, 1, actor)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    expect((await resetPageToDefault(tripId, overview.id, ownerId)).ok).toBe(true);
  });
});

// Migration 0032 gave every seed that existed its key, and a rebuild has to
// give the same ones, or Invariant 2's "rebuild equals stored" breaks on the
// first trip that predates it. So: trips shaped as they were before the key
// existed — a log whose events carry none, a renamed seed with the pre-fix
// "Add missing" copy beside it, and a trip the log has never heard of — keys
// wiped, the migration's own backfill statement run, then a rebuild.
describe("the seed-key backfill (migration 0032)", () => {
  const migration = readFileSync(fileURLToPath(new URL("../../drizzle/0032_notebook_seed_key.sql", import.meta.url)), "utf8");
  const backfill = /-- seed-key backfill: begin\n([\s\S]*?)-- seed-key backfill: end/.exec(migration)![1]!;

  it("keys the seeds that existed, the renamed one included, and a rebuild keys them alike", async () => {
    const ownerId = owner();
    const tripId = await tripOwnedBy(ownerId);
    const seeded = await listPages(tripId);
    const money = seeded.find((p) => p.seedKey === "money")!;
    // Renamed through the command, which gives every page its genesis first.
    await executePageCommand({ type: "EditPage", tripId, pageId: money.id, title: "Budget" }, ownerId);
    // The log as it was written before keys existed: no event names one.
    await db
      .update(events)
      .set({ payload: sql`${events.payload} - 'seedKey'` })
      .where(and(eq(events.streamId, tripId), eq(events.type, "PageCreated")));
    // And the second "Money" the old "Add missing" planted beside "Budget".
    const copyId = randomUUID();
    const appended = await appendToStream(db, {
      streamId: tripId,
      expectedSeq: (await readStream(db, tripId)).length,
      events: [
        {
          type: "PageCreated",
          version: 1,
          payload: { tripId, pageId: copyId, title: "Money", context: { tripId }, content: newPageDoc(), actorId: SYSTEM_ACTOR_ID },
        },
      ],
      actorId: ownerId,
      occurredAt: new Date().toISOString(),
      batchId: randomUUID(),
      origin: { kind: "user" },
    });
    if (!appended.ok) throw new Error("append refused");
    await applyPageEvents(db, appended.envelopes);
    // A trip nobody has commanded a notebook on: rows, no events.
    const untouched = await tripOwnedBy(ownerId);
    await listPages(untouched);

    const trips = [tripId, untouched];
    await db.update(pages).set({ seedKey: null }).where(inArray(pages.tripId, trips));
    await db.execute(sql.raw(backfill));

    const keysOf = async (trip: string) =>
      Object.fromEntries((await listPages(trip)).map((p) => [p.id, p.seedKey ?? null]));
    const expected = Object.fromEntries(seeded.map((p) => [p.id, p.seedKey!]));
    expect(await keysOf(tripId)).toEqual({ ...expected, [copyId]: null });
    expect(Object.values(await keysOf(untouched)).sort()).toEqual(DEFAULT_TEMPLATES.map((t) => t.key).sort());

    const backfilled = await db.select().from(pages).where(inArray(pages.tripId, trips)).orderBy(asc(pages.id));
    await rebuildProjections();
    expect(await db.select().from(pages).where(inArray(pages.tripId, trips)).orderBy(asc(pages.id))).toEqual(backfilled);
  });
});
