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
import { readStream } from "./eventStore";
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
    const back = after.find((p) => p.title === A_SEED)!;
    expect(back.id).not.toBe(gone.id);
    expect(back.actorId).toBe(SYSTEM_ACTOR_ID);

    // Again: nothing missing, nothing written — not even an event.
    const head = (await readStream(db, tripId)).length;
    const again = await addMissingDefaultPages(tripId, ownerId);
    expect(again.ok && again.seq).toBe(null);
    expect((await listPages(tripId)).length).toBe(after.length);
    expect((await readStream(db, tripId)).length).toBe(head);
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
