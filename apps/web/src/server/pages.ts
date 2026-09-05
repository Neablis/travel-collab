import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import type { Page, PageSummary, CreatePageInput, UpdatePageInput } from "@tc/contracts";
import { instantiateDefaults } from "@tc/pages";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { DEMO_TRIP_ID, isDemoTripId } from "@/lib/demoTrip";
import { isUuid } from "@/server/ids";

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
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, updatedAt: row.updatedAt, actorId: row.actorId };
}

function newRow(tripId: string, input: CreatePageInput, actorId: string, now: string): typeof pages.$inferInsert {
  return { id: randomUUID(), tripId, title: input.title, context: input.context, content: input.content, createdAt: now, updatedAt: now, actorId };
}

export async function createPage(tripId: string, input: CreatePageInput, actorId: string): Promise<Page> {
  const [inserted] = await db.insert(pages).values(newRow(tripId, input, actorId, new Date().toISOString())).returning();
  return toPage(inserted!);
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
  const defaults = instantiateDefaults(tripId);
  const epoch = Date.parse(DEMO_PAGE_EPOCH);
  return defaults.map((seed, i) => ({
    ...newRow(tripId, seed, SYSTEM_ACTOR_ID, new Date(epoch + i).toISOString()),
    // Derived, not random: `…e000`, `…e001`, one per default page. The `e`
    // block keeps them in the same reserved space as DEMO_TRIP_ID's `…d000`.
    id: `00000000-0000-4000-8000-00000000e${String(i).padStart(3, "0")}`,
  }));
}

/** The demo page with this id, or null. Lets `getPage` answer without a query. */
function demoPageById(id: string): (typeof pages.$inferInsert) | null {
  return demoPageRows(DEMO_TRIP_ID).find((row) => row.id === id) ?? null;
}

export async function listPages(tripId: string): Promise<PageSummary[]> {
  // BEFORE the select, so a demo request performs no database work at all and
  // cannot surface rows the old seeding behaviour left behind.
  if (isDemoTripId(tripId)) return demoPageRows(tripId).map(toSummary);
  const existing = await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.createdAt), asc(pages.id));
  if (existing.length > 0) return existing.map(toSummary);

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
  const defaults = instantiateDefaults(tripId);

  const startedAt = Date.now();
  const seeds = defaults.map((seed, i) =>
    newRow(tripId, seed, SYSTEM_ACTOR_ID, new Date(startedAt - defaults.length + i).toISOString()),
  );
  await db.insert(pages).values(seeds).onConflictDoNothing();
  const seeded = await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.createdAt), asc(pages.id));
  return seeded.map(toSummary);
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

export async function updatePage(id: string, input: UpdatePageInput): Promise<Page | null> {
  // A non-uuid `id` would reach Postgres and raise 22P02 (KI-2026-09-05-x).
  // Unreachable through a route today — both callers validate — but this is the
  // one place that fix guarded from IN FRONT of the query rather than inside
  // it, so a future caller added here would inherit the old 500.
  if (!isUuid(id)) return null;
  const patch: Partial<typeof pages.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.context !== undefined) patch.context = input.context;
  if (input.content !== undefined) patch.content = input.content;
  const [row] = await db.update(pages).set(patch).where(eq(pages.id, id)).returning();
  return row ? toPage(row) : null;
}

export async function deletePage(id: string): Promise<boolean> {
  // A non-uuid `id` would reach Postgres and raise 22P02 (KI-2026-09-05-x).
  // Unreachable through a route today — both callers validate — but this is the
  // one place that fix guarded from IN FRONT of the query rather than inside
  // it, so a future caller added here would inherit the old 500.
  if (!isUuid(id)) return false;
  const rows = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
  return rows.length > 0;
}
