import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  PageContent,
  PageDoc,
  SavedNotebookVisibility,
  serializePageDoc,
  type Page,
  type SavedNotebook,
  type SavedNotebookSummary,
  type TripDetail,
} from "@tc/contracts";
import { instantiateTemplate } from "@tc/pages";
import { db } from "./db/client";
import { savedNotebooks } from "./db/schema";
import { isUuid } from "./ids";
import { getPage } from "./pages";
import { executePageCommand } from "./pageCommands";
import type { AccessResult } from "./access/invites";

// Saved notebooks (M14 link 10): a person's notebook kept as a template. CRUD,
// owned by a person rather than by a trip, and not event-sourced — ADR-029's
// answers for saved days, reused rather than re-decided. **This is the only
// module that writes `saved_notebooks`**, and `savedNotebooks.soleWriter.test.ts`
// fails the build on a second.
//
// Authorization of the TRIP is not decided here, `savedDays.ts`' split: saving
// reads a trip (the route checks `viewer`), instantiating writes one (the route
// checks `editor`, and `executePageCommand` checks again). This module owns the
// library rows, and scopes every one of them to its owner in the WHERE clause.

type SavedNotebookRow = typeof savedNotebooks.$inferSelect;

function toSummary(row: SavedNotebookRow): SavedNotebookSummary {
  return {
    savedNotebookId: row.id,
    ownerId: row.ownerId,
    title: row.title,
    docVersion: row.docVersion,
    visibility: SavedNotebookVisibility.enum.private,
    provenance: {
      sourceTripId: row.sourceTripId,
      sourceTripName: row.sourceTripName,
      sourcePageId: row.sourcePageId,
      savedAt: row.createdAt.toISOString(),
    },
  };
}

// Permissive on the way out (`PageContent`), for `Page.content`'s reason: a
// snapshot this build would not write must still reach its owner, who can
// delete it. `instantiateTemplate` is where the strict parse refuses.
function toDto(row: SavedNotebookRow): SavedNotebook {
  return { ...toSummary(row), content: PageContent.parse(row.content) };
}

const mine = (ownerId: string) => and(eq(savedNotebooks.ownerId, ownerId), isNull(savedNotebooks.deletedAt));

/**
 * Keep one of a trip's notebooks as a template: a snapshot of the document the
 * page's projection holds NOW, at the version it was stored in (ADR-040's
 * snapshot with provenance; ADR-038's version recorded, never migrated here).
 *
 * **Parsed before it is kept.** A document this build cannot parse is one it
 * could never instantiate, so it is refused at save rather than stored as a
 * template that fails the moment somebody picks it. Parsing is not migrating:
 * the `PageDoc` schema reads any version's shape and `serializePageDoc` writes
 * it back canonically with its own `v` — which is what gate box 2 then carries
 * forward on instantiate.
 */
export async function saveNotebook(
  input: { pageId: string; title?: string },
  detail: TripDetail,
  ownerId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<SavedNotebook>> {
  const page = await getPage(input.pageId);
  // Another trip's page is "not in this trip", which is the answer the caller
  // can act on and the one that discloses nothing about the other trip.
  if (page === null || page.tripId !== detail.tripId) {
    return { ok: false, error: { code: "not-found", message: "That notebook is not in this trip." } };
  }
  const doc = PageDoc.safeParse(page.content);
  if (!doc.success) {
    return {
      ok: false,
      error: { code: "invalid", message: "This notebook has content this version of the app cannot save as a template." },
    };
  }
  const row: typeof savedNotebooks.$inferInsert = {
    id: randomUUID(),
    ownerId,
    title: input.title ?? page.title,
    content: serializePageDoc(doc.data) as PageContent,
    docVersion: doc.data.v,
    sourceTripId: detail.tripId,
    sourceTripName: detail.name,
    sourcePageId: page.id,
    createdAt: new Date(now),
  };
  const [inserted] = await db.insert(savedNotebooks).values(row).returning();
  return { ok: true, value: toDto(inserted!) };
}

/**
 * The signed-in person's templates, newest first. `id` breaks a same-instant
 * tie so the order is total (`listSavedDays`' reason).
 */
export async function listSavedNotebooks(ownerId: string): Promise<SavedNotebookSummary[]> {
  const rows = await db.select().from(savedNotebooks).where(mine(ownerId));
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map(toSummary);
}

/**
 * Owner-scoped in the WHERE clause: somebody else's template is "no row",
 * indistinguishable from one that never existed — `getSavedDay`'s rule.
 */
export async function getSavedNotebook(savedNotebookId: string, ownerId: string): Promise<SavedNotebook | null> {
  // A non-uuid would reach a uuid column and raise 22P02 (KI-2026-09-05-x).
  if (!isUuid(savedNotebookId)) return null;
  const [row] = await db
    .select()
    .from(savedNotebooks)
    .where(and(eq(savedNotebooks.id, savedNotebookId), mine(ownerId)));
  return row === undefined ? null : toDto(row);
}

/**
 * Delete one of your own templates — a SOFT delete, `deleteSavedDay`'s rule.
 * Notebooks already made from it are untouched: they are pages in their own
 * trips' streams, with nothing pointing back here. `false` for a template that
 * is not yours, was deleted already, or never existed — one answer for all
 * three.
 */
export async function deleteSavedNotebook(
  savedNotebookId: string,
  ownerId: string,
  now: string = new Date().toISOString(),
): Promise<boolean> {
  if (!isUuid(savedNotebookId)) return false;
  const deleted = await db
    .update(savedNotebooks)
    .set({ deletedAt: new Date(now) })
    .where(and(eq(savedNotebooks.id, savedNotebookId), mine(ownerId)))
    .returning({ id: savedNotebooks.id });
  return deleted.length > 0;
}

export type InstantiateResult =
  | { ok: true; page: Page }
  | { ok: false; error: { code: string; message: string } };

/**
 * Make a new notebook in `detail`'s trip from one of `actorId`'s templates.
 *
 * **Through the page command path, never into the table** (AGENTS.md
 * invariant 1, ADR-036 as amended): the new page is a `CreatePage` command on
 * the target trip's stream, so it gets its `PageCreated` event, its history
 * entry and its projection row exactly as a gallery seed does. This function
 * writes nothing of its own — the template row is read, not touched.
 *
 * `instantiateTemplate` does the rest: migrate the snapshot forward, re-bind
 * any day pinned by an id the target trip lacks, and give the page the target
 * trip's context and nothing else.
 */
export async function instantiateSavedNotebook(
  savedNotebookId: string,
  detail: TripDetail,
  actorId: string,
): Promise<InstantiateResult> {
  const template = await getSavedNotebook(savedNotebookId, actorId);
  if (template === null) return { ok: false, error: { code: "not-found", message: "That template is not in your library." } };

  const made = instantiateTemplate(template.content, {
    tripId: detail.tripId,
    dayIds: detail.days.map((d) => d.dayId),
  });
  if (!made.ok) return { ok: false, error: { code: "invalid-page", message: made.message } };

  // The wire form, not the parse output: `executePageCommand` parses again, and
  // a node wrapped as `unknown` twice is the KI-2026-09-05-g defect.
  const result = await executePageCommand(
    {
      type: "CreatePage",
      tripId: detail.tripId,
      pageId: randomUUID(),
      title: template.title,
      context: made.context,
      content: serializePageDoc(made.content),
    },
    actorId,
  );
  if (!result.ok) return result;
  if (result.page === null) return { ok: false, error: { code: "not-found", message: "The notebook was not created." } };
  return { ok: true, page: result.page };
}
