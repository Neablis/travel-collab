import { newPageDoc } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

  // The 800ms autosave fires on the pause AFTER an already-saved change.
  // Appending there would wake every co-traveller for a change that did not
  // happen, and put a row in the history panel for a trailing keystroke.
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
    // And the page row is untouched by a rebuild — it is projected by the
    // command path, not by this one.
    expect(await db.select().from(pages).where(eq(pages.tripId, tripId))).not.toHaveLength(0);
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
