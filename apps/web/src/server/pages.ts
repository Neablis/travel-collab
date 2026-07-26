import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Page, PageSummary, CreatePageInput, UpdatePageInput } from "@tc/contracts";
import { instantiateDefaults } from "@tc/pages";
import { db } from "./db/client";
import { pages } from "./db/schema";

function toPage(row: typeof pages.$inferSelect): Page {
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, actorId: row.actorId };
}

export async function createPage(tripId: string, input: CreatePageInput, actorId: string): Promise<Page> {
  const now = new Date().toISOString();
  const row = { id: randomUUID(), tripId, title: input.title, context: input.context, content: input.content, createdAt: now, updatedAt: now, actorId };
  const [inserted] = await db.insert(pages).values(row).returning();
  return toPage(inserted!);
}

export async function listPages(tripId: string): Promise<PageSummary[]> {
  const existing = await db.select().from(pages).where(eq(pages.tripId, tripId));
  if (existing.length === 0) {
    // Lazy default instantiation — first visit only (idempotent: guarded by the zero-rows check).
    for (const seed of instantiateDefaults(tripId)) await createPage(tripId, seed, "system");
    const seeded = await db.select().from(pages).where(eq(pages.tripId, tripId));
    return seeded.map(toPage);
  }
  return existing.map(toPage);
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
