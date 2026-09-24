import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { CURRENT_PAGE_DOC_VERSION, type Page, type SavedNotebook, type SavedNotebookSummary } from "@tc/contracts";
import { UNRESOLVED_DAY_ID } from "@tc/pages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedNotebooks } from "@/server/db/schema";
import { readStream } from "@/server/eventStore";
import { executePageCommand } from "@/server/pageCommands";
import { listPages } from "@/server/pages";

// Saved notebooks against real Postgres (M14 link 10): CRUD, owner scoping,
// and instantiate — which must CREATE A PAGE THROUGH THE COMMAND PATH, so the
// target trip's stream gets a `PageCreated` (AGENTS.md invariant 1).
//
// Per-run ids (KI-57): nothing truncates between runs.
const RUN = randomUUID();
const OWNER = `sn-owner-${RUN}`;
const STRANGER = `sn-stranger-${RUN}`;

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET: LIST, POST: SAVE } = await import("./route");
const { GET: GET_ONE, DELETE } = await import("./[savedNotebookId]/route");
const { POST: INSTANTIATE } = await import("../trips/[tripId]/saved-notebooks/[savedNotebookId]/route");

/** A trip with `days` days, owned by OWNER. */
async function trip(name: string, days = 0): Promise<{ tripId: string; dayIds: string[] }> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  if (!created.ok) throw new Error(created.error.message);
  const dayIds: string[] = [];
  for (let i = 0; i < days; i++) {
    const dayId = randomUUID();
    const added = await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
    if (!added.ok) throw new Error(added.error.message);
    dayIds.push(dayId);
  }
  return { tripId, dayIds };
}

/** A notebook in `tripId`, created the way the app creates one. */
async function notebook(tripId: string, title: string, content: unknown[]): Promise<string> {
  const pageId = randomUUID();
  const result = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title, context: { tripId }, content: { v: CURRENT_PAGE_DOC_VERSION, type: "doc", content } },
    OWNER,
  );
  if (!result.ok) throw new Error(result.error.message);
  return pageId;
}

const post = (body: unknown) =>
  new Request("http://test/api/saved-notebooks", { method: "POST", body: JSON.stringify(body) });
const idParams = (savedNotebookId: string) => ({ params: Promise.resolve({ savedNotebookId }) });
const instantiate = (tripId: string, savedNotebookId: string) =>
  INSTANTIATE(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ tripId, savedNotebookId }),
  });

async function save(body: unknown): Promise<SavedNotebook> {
  const res = await SAVE(post(body));
  expect(res.status).toBe(201);
  return ((await res.json()) as { savedNotebook: SavedNotebook }).savedNotebook;
}

const PARAGRAPH = { type: "paragraph", content: [{ type: "text", text: "Pack light." }] };

describe("/api/saved-notebooks", () => {
  beforeEach(() => {
    currentUserId = OWNER;
  });

  it("401s without a session", async () => {
    currentUserId = "";
    expect((await LIST()).status).toBe(401);
    expect((await GET_ONE(new Request("http://test/x"), idParams(randomUUID()))).status).toBe(401);
  });

  it("saves the stored document at its version, titled after the page, with provenance", async () => {
    const a = await trip("Kyoto 2026");
    const pageId = await notebook(a.tripId, "Packing", [PARAGRAPH]);

    const saved = await save({ tripId: a.tripId, pageId });
    expect(saved).toMatchObject({
      ownerId: OWNER,
      title: "Packing",
      docVersion: CURRENT_PAGE_DOC_VERSION,
      visibility: "private",
      provenance: { sourceTripId: a.tripId, sourceTripName: "Kyoto 2026", sourcePageId: pageId },
      content: { v: CURRENT_PAGE_DOC_VERSION, type: "doc", content: [PARAGRAPH] },
    });

    const named = await save({ tripId: a.tripId, pageId, title: "My packing list" });
    expect(named.title).toBe("My packing list");
  });

  it("refuses a page from another trip, and a trip the caller is not in", async () => {
    const a = await trip("A");
    const b = await trip("B");
    const pageInB = await notebook(b.tripId, "Elsewhere", []);
    expect((await SAVE(post({ tripId: a.tripId, pageId: pageInB }))).status).toBe(404);

    currentUserId = STRANGER;
    const pageInA = await notebook(a.tripId, "Mine", []);
    expect((await SAVE(post({ tripId: a.tripId, pageId: pageInA }))).status).toBe(403);
  });

  it("is scoped to its owner: listed, read, deleted and used by nobody else", async () => {
    const a = await trip("A");
    const saved = await save({ tripId: a.tripId, pageId: await notebook(a.tripId, "Private", []) });

    const mine = (await (await LIST()).json()) as { savedNotebooks: SavedNotebookSummary[] };
    expect(mine.savedNotebooks.map((s) => s.savedNotebookId)).toContain(saved.savedNotebookId);
    // The list carries no document (`SavedNotebookSummary`).
    expect(mine.savedNotebooks[0]).not.toHaveProperty("content");

    currentUserId = STRANGER;
    const theirs = (await (await LIST()).json()) as { savedNotebooks: SavedNotebookSummary[] };
    expect(theirs.savedNotebooks.map((s) => s.savedNotebookId)).not.toContain(saved.savedNotebookId);
    expect((await GET_ONE(new Request("http://test/x"), idParams(saved.savedNotebookId))).status).toBe(404);
    expect((await DELETE(new Request("http://test/x"), idParams(saved.savedNotebookId))).status).toBe(404);
    // The stranger's own trip, so the refusal is about the TEMPLATE, not the trip.
    const strangersTrip = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: strangersTrip, name: "Theirs" }, STRANGER);
    expect((await instantiate(strangersTrip, saved.savedNotebookId)).status).toBe(404);

    currentUserId = OWNER;
    expect((await GET_ONE(new Request("http://test/x"), idParams(saved.savedNotebookId))).status).toBe(200);
  });

  it("deletes softly: gone from every read, the row kept", async () => {
    const a = await trip("A");
    const saved = await save({ tripId: a.tripId, pageId: await notebook(a.tripId, "Soon gone", []) });

    expect((await DELETE(new Request("http://test/x"), idParams(saved.savedNotebookId))).status).toBe(200);
    expect((await GET_ONE(new Request("http://test/x"), idParams(saved.savedNotebookId))).status).toBe(404);
    expect((await DELETE(new Request("http://test/x"), idParams(saved.savedNotebookId))).status).toBe(404);
    const list = (await (await LIST()).json()) as { savedNotebooks: SavedNotebookSummary[] };
    expect(list.savedNotebooks.map((s) => s.savedNotebookId)).not.toContain(saved.savedNotebookId);

    const [row] = await db.select().from(savedNotebooks).where(eq(savedNotebooks.id, saved.savedNotebookId));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });
});

describe("POST /api/trips/:tripId/saved-notebooks/:id — instantiate", () => {
  beforeEach(() => {
    currentUserId = OWNER;
  });

  it("creates the page through the command path: a PageCreated in the target trip's stream", async () => {
    const a = await trip("Source");
    const b = await trip("Target");
    const saved = await save({ tripId: a.tripId, pageId: await notebook(a.tripId, "Packing", [PARAGRAPH]) });
    const sourceEventsBefore = (await readStream(db, a.tripId)).length;
    const [rowBefore] = await db.select().from(savedNotebooks).where(eq(savedNotebooks.id, saved.savedNotebookId));

    const res = await instantiate(b.tripId, saved.savedNotebookId);
    expect(res.status).toBe(201);
    const { page } = (await res.json()) as { page: Page };
    expect(page).toMatchObject({ tripId: b.tripId, title: "Packing", context: { tripId: b.tripId }, actorId: OWNER });
    expect(page.content).toEqual({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content: [PARAGRAPH] });

    const created = (await readStream(db, b.tripId)).filter((e) => e.type === "PageCreated");
    expect(created.map((e) => (e.payload as { pageId: string }).pageId)).toContain(page.id);
    expect((await listPages(b.tripId)).map((p) => p.id)).toContain(page.id);

    // Nothing appended to the source, and the template row untouched.
    expect(await readStream(db, a.tripId)).toHaveLength(sourceEventsBefore);
    const [rowAfter] = await db.select().from(savedNotebooks).where(eq(savedNotebooks.id, saved.savedNotebookId));
    expect(rowAfter).toEqual(rowBefore);
  });

  it("carries none of the source trip's day ids into the target's stream", async () => {
    const a = await trip("Source", 2);
    const b = await trip("Target", 2);
    const pinned = (dayId: string) => ({ type: "macro", attrs: { name: "cost", params: { day: { kind: "dayId", dayId } } } });
    const saved = await save({
      tripId: a.tripId,
      pageId: await notebook(a.tripId, "Pinned", [pinned(a.dayIds[1]!), { type: "macro", attrs: { name: "cost", params: { day: { kind: "index", index: 1 } } } }]),
    });

    const res = await instantiate(b.tripId, saved.savedNotebookId);
    expect(res.status).toBe(201);
    const { page } = (await res.json()) as { page: Page };
    const days = (page.content.content as { attrs: { params: { day: unknown } } }[]).map((n) => n.attrs.params.day);
    expect(days).toEqual([{ kind: "dayId", dayId: UNRESOLVED_DAY_ID }, { kind: "index", index: 1 }]);

    const stream = JSON.stringify(await readStream(db, b.tripId));
    for (const dayId of a.dayIds) expect(stream).not.toContain(dayId);
  });

  // SPEC §25: one Overview per trip. A template kept FROM the Overview becomes
  // an ordinary notebook, which is what makes it deletable in the next trip.
  it("instantiates a template saved from the Overview as an ordinary notebook", async () => {
    const a = await trip("Source");
    const overview = (await listPages(a.tripId)).find((p) => p.context.kind === "overview")!;
    const saved = await save({ tripId: a.tripId, pageId: overview.id });
    const b = await trip("Target");
    await listPages(b.tripId); // seed B's own Overview first

    const { page } = (await (await instantiate(b.tripId, saved.savedNotebookId)).json()) as { page: Page };
    expect(page.context).toEqual({ tripId: b.tripId });
    expect((await listPages(b.tripId)).filter((p) => p.context.kind === "overview")).toHaveLength(1);
  });

  // Gate box 2 at the storage boundary: a row holding a v1 snapshot — old
  // widget names, `dayRef`, no `v`, exactly as the first templates would have
  // been stored — still becomes a page. Inserted directly because no save path
  // writes v1 any more; this file is a test, which the sole-writer sweep skips.
  it("instantiates a template stored at an older document version", async () => {
    const a = await trip("Source");
    const b = await trip("Target", 1);
    const id = randomUUID();
    await db.insert(savedNotebooks).values({
      id,
      ownerId: OWNER,
      title: "Old",
      content: {
        type: "doc",
        content: [{ type: "macro", attrs: { name: "cost.day", params: { dayRef: { kind: "index", index: 0 } } } }],
      },
      docVersion: 1,
      sourceTripId: a.tripId,
      sourceTripName: "Source",
      sourcePageId: randomUUID(),
      createdAt: new Date(),
    });

    const res = await instantiate(b.tripId, id);
    expect(res.status).toBe(201);
    const { page } = (await res.json()) as { page: Page };
    expect(page.content).toEqual({
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [{ type: "macro", attrs: { name: "cost", params: { day: { kind: "index", index: 0 } } } }],
    });
  });

  it("needs edit rights on the target trip", async () => {
    const a = await trip("Source");
    const saved = await save({ tripId: a.tripId, pageId: await notebook(a.tripId, "Mine", []) });
    const notMine = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: notMine, name: "Someone else's" }, STRANGER);
    expect((await instantiate(notMine, saved.savedNotebookId)).status).toBe(403);
  });
});
