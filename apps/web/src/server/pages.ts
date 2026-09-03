import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import type { Page, PageSummary, CreatePageInput, UpdatePageInput } from "@tc/contracts";
import { instantiateDefaults } from "@tc/pages";
import { db } from "./db/client";
import { pages } from "./db/schema";

function toPage(row: typeof pages.$inferSelect): Page {
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, actorId: row.actorId };
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
export async function listPages(tripId: string): Promise<PageSummary[]> {
  const existing = await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.createdAt), asc(pages.id));
  if (existing.length > 0) return existing.map(toPage);

  // Lazy default instantiation — first visit only. The zero-rows check above
  // is an optimisation, NOT the idempotency guarantee: two concurrent first
  // visits both see zero rows and both arrive here (KI-6). Atomicity comes
  // from `pages_system_seed_unique`, the partial unique index on
  // (trip_id, title) WHERE actor_id = 'system' — the racer that loses inserts
  // nothing and the re-read below returns the winner's rows. Do not replace
  // this with per-row createPage() calls; that reintroduces the race.
  // Each seed gets its own millisecond, so `ORDER BY created_at` reproduces
  // `instantiateDefaults`' order — Trip Overview, then Day Sheet, which is the
  // order SPEC §7 lists the prebuilt pages in. One shared `now` for all of them
  // left every seeded row tied on the sort key, and a tie falls back to
  // whatever order Postgres happens to return: the ordering would have looked
  // fixed in a two-row trip and shuffled in a busier one.
  const startedAt = Date.now();
  const seeds = instantiateDefaults(tripId).map((seed, i) =>
    newRow(tripId, seed, SYSTEM_ACTOR_ID, new Date(startedAt + i).toISOString()),
  );
  await db.insert(pages).values(seeds).onConflictDoNothing();
  const seeded = await db.select().from(pages).where(eq(pages.tripId, tripId)).orderBy(asc(pages.createdAt), asc(pages.id));
  return seeded.map(toPage);
}

export async function getPage(id: string): Promise<Page | null> {
  const [row] = await db.select().from(pages).where(eq(pages.id, id));
  return row ? toPage(row) : null;
}

export async function updatePage(id: string, input: UpdatePageInput): Promise<Page | null> {
  const patch: Partial<typeof pages.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.context !== undefined) patch.context = input.context;
  if (input.content !== undefined) patch.content = input.content;
  const [row] = await db.update(pages).set(patch).where(eq(pages.id, id)).returning();
  return row ? toPage(row) : null;
}

export async function deletePage(id: string): Promise<boolean> {
  const rows = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
  return rows.length > 0;
}
