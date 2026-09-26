import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { SYSTEM_ACTOR_ID, migratePageDoc } from "@tc/contracts";
import type { Page, PageDoc, PageListEntry, PageSummary, CreatePageInput } from "@tc/contracts";
import { findWidgetError, instantiateDefaults, notebookPreviewOf, type SeededPage } from "@tc/pages";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { DEMO_TRIP_ID, isDemoTripId } from "@/lib/demoTrip";
import { isUuid } from "@/server/ids";

/**
 * The largest request body a notebook write accepts, in bytes, measured before
 * it is parsed (KI-2026-09-05-f item 1, F-A02) — `/ask`'s pattern, for the same
 * reason: the size of what is stored is the size of what arrives.
 *
 * **512 KiB is ~190× the largest notebook the app ships** (the bundled "Before
 * you go", 2,738 bytes of document; every template is smaller), which leaves
 * room for tens of thousands of words of a real journal while still being a
 * ceiling well under the platform's own 4.5 MB. It bounds only WRITES: a page
 * already stored larger still reads, and still opens.
 */
export const MAX_PAGE_BODY_BYTES = 512 * 1024;

/**
 * The server's judgement on a document about to be SAVED, and the version of
 * it that should be stored: parsed already, refused if it is from a version
 * this build cannot write back, migrated to the current version, and refused
 * if any widget in it is one the registry would not insert.
 *
 * This is the write-path half of KI-2026-09-05-g. Before it, both page routes
 * persisted the parse output as-is — any `v`, any widget name, any params — so
 * ADR-037 decision 4 ("no way to put a widget into a document that skips
 * validation") held for every insert path and was bypassed by the save. The
 * read path stays permissive (ADR-038 decision 4): a stored document this build
 * would refuse still opens, it just cannot be saved in that state.
 *
 * Storing the migrated document CANONICALLY is the caller's job, and it is
 * `serializePageDoc` — see `executePageCommand`, which is the one place every
 * page write passes through.
 */
export function checkPageDocForWrite(doc: PageDoc): { ok: true; doc: PageDoc } | { ok: false; message: string } {
  let migrated: PageDoc;
  try {
    // Throws for `v > CURRENT_PAGE_DOC_VERSION`: a document from the future has
    // a shape this build has no rule for writing back.
    migrated = migratePageDoc(doc);
  } catch (error) {
    return { ok: false, message: `Invalid page document: ${(error as Error).message}` };
  }
  const widgetError = findWidgetError(migrated.content);
  if (widgetError !== null) return { ok: false, message: widgetError };
  return { ok: true, doc: migrated };
}

function toPage(row: typeof pages.$inferSelect): Page {
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, actorId: row.actorId };
}

// The LIST projection, and it exists because the type was lying. `listPages`
// has always been typed `Promise<PageSummary[]>` while returning `toPage` rows
// — full `Page` objects, `content` and all — so every notebook's entire
// document went over the wire and `PageSummary.parse` stripped it in the
// browser AFTER the download. That is the one field which makes a list
// response unbounded, and the Notebooks menu re-reads this list on every open.
// Projecting here makes the declared return type true (Copilot, PR #126).
function toSummary(row: typeof pages.$inferSelect): PageSummary {
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, createdAt: row.createdAt, updatedAt: row.updatedAt, actorId: row.actorId };
}

/** A summary and what the notebook says (ADR-056) — the app's own list, not the public API's. */
function toEntry(row: typeof pages.$inferSelect): PageListEntry {
  return { ...toSummary(row), preview: notebookPreviewOf(row.content) };
}

function newRow(tripId: string, input: CreatePageInput, actorId: string, now: string): typeof pages.$inferInsert {
  return { id: randomUUID(), tripId, title: input.title, context: input.context, content: input.content, createdAt: now, updatedAt: now, actorId };
}

/** A seed's row, under the id `instantiateDefaults` gave it — the id the Overview's links already name. */
function seededRow(tripId: string, seed: SeededPage, now: string): typeof pages.$inferInsert {
  return { ...newRow(tripId, seed, SYSTEM_ACTOR_ID, now), id: seed.id };
}

// Ordered by `createdAt`, and the ordering is load-bearing rather than tidy.
// Without it this is a bare `SELECT … WHERE`, so Postgres returns rows in
// whatever physical order it currently has them — which changes as rows are
// updated, and disagrees with the Notebook index's own optimistic placement:
// `handleCreate` appends a new notebook to the end of its list, and an
// unordered re-read put the same notebook first. Found by walking the flow in
// a browser (2026-09-03); no unit or e2e test could see it, because both seed
// their rows in one insert and never observe a reshuffle.
//
// `createdAt` rather than `updatedAt`: a list that reorders itself every time
// you edit something is a list you cannot learn the shape of, and the two
// seeded notebooks stay where a returning reader last saw them. `id` breaks
// any remaining tie, so two notebooks created in the same millisecond still
// come back in a fixed order rather than a lucky one.
// The demo trip is READ-ONLY, all the way down (KI-2026-09-05-d). ADR-031:186
// is explicit that "the only database work in the whole demo is the clone", and
// seeding broke that: a GET from a visitor with no session wrote rows.
//
// Both halves of this are load-bearing, and the first draft of the fix got the
// second one wrong (caught in review of PR #147):
//
//   * **Stable ids.** `newRow` mints a `randomUUID()` per call, so folding the
//     pages in memory with it gave every list request DIFFERENT page ids —
//     and `GET /pages/[pageId]` reads through `getPage`, which queries
//     Postgres, so every id the list handed out 404'd. Demo ids are derived
//     from the page's index instead, so they are the same on every request and
//     resolvable by `getPage` below.
//   * **A fixed clock.** `Date.now()` would reorder the list against itself
//     between requests, which is the same defect `listPages`' ORDER BY comment
//     above describes. These rows are ordered by construction.
const DEMO_PAGE_EPOCH = "2026-01-01T00:00:00.000Z";

/** The demo trip's prebuilt pages, folded in memory — never read, never written. */
function demoPageRows(tripId: string): (typeof pages.$inferInsert)[] {
  // Derived, not random: `…e000`, `…e001`, one per default page, minted in
  // `instantiateDefaults`' order so the demo Overview's notebook links name
  // them (ADR-056). The `e` block keeps them in the same reserved space as
  // DEMO_TRIP_ID's `…d000`.
  let i = 0;
  const defaults = instantiateDefaults(tripId, () => `00000000-0000-4000-8000-00000000e${String(i++).padStart(3, "0")}`);
  const epoch = Date.parse(DEMO_PAGE_EPOCH);
  return defaults.map((seed, n) => seededRow(tripId, seed, new Date(epoch + n).toISOString()));
}

/** The demo page with this id, or null. Lets `getPage` answer without a query. */
function demoPageById(id: string): (typeof pages.$inferInsert) | null {
  return demoPageRows(DEMO_TRIP_ID).find((row) => row.id === id) ?? null;
}

export async function listPages(tripId: string): Promise<PageSummary[]> {
  return (await listPageRows(tripId)).map(toSummary);
}

/**
 * The app's own notebook list: `listPages`, each row with what the notebook
 * says (ADR-056). A second function rather than a flag, because `listPages` is
 * also the public API's source and its rows must stay `PageSummary`.
 */
export async function listPageEntries(tripId: string): Promise<PageListEntry[]> {
  return (await listPageRows(tripId)).map(toEntry);
}

async function listPageRows(tripId: string): Promise<(typeof pages.$inferSelect)[]> {
  // BEFORE the select, so a demo request performs no database work at all and
  // cannot surface rows the old seeding behaviour left behind.
  if (isDemoTripId(tripId)) return demoPageRows(tripId) as (typeof pages.$inferSelect)[];
  const existing = await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.createdAt), asc(pages.id));
  if (existing.length > 0) return existing;

  // Lazy default instantiation — first visit only. The zero-rows check above
  // is an optimisation, NOT the idempotency guarantee: two concurrent first
  // visits both see zero rows and both arrive here (KI-6). Atomicity comes
  // from `pages_system_seed_unique`, the partial unique index on
  // (trip_id, title) WHERE actor_id = 'system' — the racer that loses inserts
  // nothing and the re-read below returns the winner's rows. Do not replace
  // this with per-row createPage() calls; that reintroduces the race.
  // Each seed gets its own millisecond, so `ORDER BY created_at` reproduces
  // `instantiateDefaults`' order — Trip Overview, then Day Sheet, the order
  // SPEC §7 lists the prebuilt pages in. One shared `now` for all of them left
  // every seeded row tied on the sort key, and a tie falls back to whatever
  // order Postgres happens to return.
  //
  // **Backwards from `startedAt`, not forwards, and that direction is the whole
  // point.** Stamping them `startedAt + i` put the seeds in the FUTURE relative
  // to the moment of seeding, so a notebook the same visitor created moments
  // later could land on a seed's millisecond, tie, and be ordered by the `id`
  // tiebreaker — which is a random UUID, so it landed in the middle of the list
  // on a coin flip. CI caught exactly that: `expected [ 'Trip Overview',
  // 'Packing', … ] to deeply equal [ 'Trip Overview', 'Day Sheet', … ]`, on a
  // runner fast enough to seed and create inside one millisecond.
  //
  // Backdating puts every seed strictly BEFORE the instant it was written, so
  // anything created afterwards sorts after all of them even when the clock has
  // not ticked. The wall clock is not a reliable ordering key at this
  // granularity; the only thing that saves it here is that these rows are the
  // ones whose timestamps we choose.
  //
  // **The ids are minted before the documents are built** (ADR-056): the
  // Overview links to the other three seeds by id. Two racers mint different
  // ids, and the loser's rows are all dropped rather than some of them — one
  // statement, rows in the same order, so the loser blocks on the winner's
  // first title and then conflicts on every row — which is what keeps the
  // winner's Overview pointing at the winner's siblings.
  const defaults = instantiateDefaults(tripId, randomUUID);

  const startedAt = Date.now();
  const seeds = defaults.map((seed, i) => seededRow(tripId, seed, new Date(startedAt - defaults.length + i).toISOString()));
  await db.insert(pages).values(seeds).onConflictDoNothing();
  return db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.createdAt), asc(pages.id));
}

export async function getPage(id: string): Promise<Page | null> {
  // A non-uuid `id` would reach Postgres and raise 22P02 (KI-2026-09-05-x).
  // Unreachable through a route today — both callers validate — but this is the
  // one place that fix guarded from IN FRONT of the query rather than inside
  // it, so a future caller added here would inherit the old 500.
  if (!isUuid(id)) return null;
  // A demo page id never reached a table, so it has to be answered from the
  // same fold `listPages` hands out — otherwise every id in that list 404s.
  const demo = demoPageById(id);
  if (demo !== null) return toPage(demo as typeof pages.$inferSelect);
  const [row] = await db.select().from(pages).where(eq(pages.id, id));
  return row ? toPage(row) : null;
}

/**
 * Updates a stored page, and **cannot move the Overview marker in either
 * direction** — the stored `context.kind` is carried across and the caller's is
 * discarded. A PATCH carrying `{ tripId }`, which is exactly what the one route
 * that PATCHes a page sends, used to strip the marker and leave the page every
 * trip is supposed to keep one DELETE away from gone.
 *
 * `null` for an id that is not a uuid, or names no page.
 */

/**
 * `createPage`, `updatePage` and `deletePage` used to live here, and they are
 * gone rather than kept "just in case".
 *
 * Every page write goes through `executePageCommand` now, so these were a
 * SECOND way to change a page — one that wrote the row without writing the
 * event, leaving the log and the table disagreeing about a document's content.
 * That is not hypothetical: `/api/v1`'s page routes were still calling them
 * after the BFF routes had moved, which is exactly the divergence. A dead
 * second copy of a write path is how the Board activity adapters dropped five
 * fields in this same PR.
 *
 * **What went with them, and why that is safe.** `deletePage` refused the
 * Overview in SQL (`coalesce(context->>'kind','') <> 'overview'`), a guard
 * against the state `updatePage` could produce by storing a caller's whole
 * `context` and dropping the marker. `EditPage` carries no `context` at all,
 * so no request can mark or unmark a page in either direction — the property
 * is structural now instead of defended, and `pages.int.test.ts` asserts both
 * halves through the command.
 *
 * `listPages` KEEPS its lazy seeding, deliberately. It runs on a READ, and a
 * read must not append events; the lazy genesis in `pageCommands.ts` is what
 * brings those rows into the log the first time one is commanded.
 */
