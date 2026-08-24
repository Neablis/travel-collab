import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Page, PageSummary, CreatePageInput, UpdatePageInput } from "@tc/contracts";
import { instantiateDefaults } from "@tc/pages";
import { db } from "./db/client";
import { pages } from "./db/schema";

function toPage(row: typeof pages.$inferSelect): Page {
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, actorId: row.actorId };
}

// Actor recorded on lazily seeded default pages. The `pages_system_seed_unique`
// partial index (migration 0005) is scoped to exactly this value, so changing
// it means changing that index too.
const SYSTEM_ACTOR_ID = "system";

function newRow(tripId: string, input: CreatePageInput, actorId: string, now: string): typeof pages.$inferInsert {
  return { id: randomUUID(), tripId, title: input.title, context: input.context, content: input.content, createdAt: now, updatedAt: now, actorId };
}

export async function createPage(tripId: string, input: CreatePageInput, actorId: string): Promise<Page> {
  const [inserted] = await db.insert(pages).values(newRow(tripId, input, actorId, new Date().toISOString())).returning();
  return toPage(inserted!);
}

export async function listPages(tripId: string): Promise<PageSummary[]> {
  const existing = await db.select().from(pages).where(eq(pages.tripId, tripId));
  if (existing.length > 0) return existing.map(toPage);

  // Lazy default instantiation — first visit only. The zero-rows check above
  // is an optimisation, NOT the idempotency guarantee: two concurrent first
  // visits both see zero rows and both arrive here (KI-6). Atomicity comes
  // from `pages_system_seed_unique`, the partial unique index on
  // (trip_id, title) WHERE actor_id = 'system' — the racer that loses inserts
  // nothing and the re-read below returns the winner's rows. Do not replace
  // this with per-row createPage() calls; that reintroduces the race.
  const now = new Date().toISOString();
  const seeds = instantiateDefaults(tripId).map((seed) => newRow(tripId, seed, SYSTEM_ACTOR_ID, now));
  await db.insert(pages).values(seeds).onConflictDoNothing();
  const seeded = await db.select().from(pages).where(eq(pages.tripId, tripId));
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
