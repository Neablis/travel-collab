import { z } from "zod";
import { PageContent } from "./pages.ts";

// Saved notebooks (M14 link 10) — *"saving notebook templates for future
// trips"*. Saved days are to trips what saved notebooks are to notebooks, so
// ADR-029's answers are reused rather than re-decided: a saved notebook belongs
// to a PERSON, not to a trip; it is ordinary CRUD in its own module
// (`apps/web/src/server/savedNotebooks.ts`), not event-sourced; and it is
// private. Publishing is later, and is not built.
//
// The one thing a saved day never had to decide: a notebook's content is a
// versioned AST (ADR-038) whose history lives in the trip's event log
// (ADR-036). So a saved notebook is a SNAPSHOT of one document version with
// provenance — ADR-040's answer for a kept day — and the version is recorded
// because instantiating it later has to migrate it forward first.

/**
 * **One member, on purpose.** ADR-029 makes "publishable later" a later
 * decision, and a contract that accepted `"public"` today would describe a
 * state no endpoint can produce and no reader filters for. Widening this enum
 * is where publishing starts, and every consumer's exhaustive switch will say
 * so.
 */
export const SavedNotebookVisibility = z.enum(["private"]);
export type SavedNotebookVisibility = z.infer<typeof SavedNotebookVisibility>;

/**
 * Where the snapshot came from — ADR-040 decision 1's reading of provenance:
 * it records where a value came from and survives the source changing, being
 * deleted, or becoming unreadable. **Nothing reads through these ids to fetch
 * live data**, and a dangling one is not an error.
 *
 * `sourceTripName` is a copy for the same reason `SavedDay.sourceTripName` is
 * (ADR-028): the owner may lose access to the trip, and "from Kyoto 2026" must
 * still be sayable.
 */
export const SavedNotebookProvenance = z.object({
  sourceTripId: z.string().uuid(),
  sourceTripName: z.string(),
  sourcePageId: z.string().uuid(),
  savedAt: z.string(),
});
export type SavedNotebookProvenance = z.infer<typeof SavedNotebookProvenance>;

/**
 * A saved notebook without its document — what the gallery lists.
 *
 * `content` is off for `PageSummary`'s reason: it is the one field that makes a
 * list unbounded, and nothing in a list renders it. Instantiating happens on
 * the server by id, so the browser never needs the snapshot to use one.
 */
export const SavedNotebookSummary = z.object({
  savedNotebookId: z.string().uuid(),
  ownerId: z.string().min(1),
  title: z.string().min(1),
  /**
   * The `PageDoc.v` the snapshot was taken at — the document's own `v`,
   * recorded at save time so a list can say which templates predate the
   * current format without shipping every document. The snapshot's own `v` is
   * what migration reads; this is a copy of it, written in the same insert.
   */
  docVersion: z.number().int().positive(),
  visibility: SavedNotebookVisibility,
  provenance: SavedNotebookProvenance,
});
export type SavedNotebookSummary = z.infer<typeof SavedNotebookSummary>;

/**
 * A saved notebook with its snapshot.
 *
 * `content` is `PageContent` — permissive — rather than `PageDoc`, for the
 * reason `Page.content` is: **read what is there, write only what we
 * understand** (ADR-038 decision 4). A snapshot taken at a version this build
 * no longer parses the same way must still come back to its owner, who can
 * delete it; the strict parse happens on instantiate, where refusing is the
 * right answer.
 */
export const SavedNotebook = SavedNotebookSummary.extend({ content: PageContent });
export type SavedNotebook = z.infer<typeof SavedNotebook>;

/**
 * Save one notebook page as a template.
 *
 * The document is NOT in the request: the server snapshots what is stored, so
 * a template is always a document the trip's log actually holds, never one a
 * client assembled. `title` defaults to the page's own title (M14 link 10).
 */
export const CreateSavedNotebookInput = z.object({
  tripId: z.string().uuid(),
  pageId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateSavedNotebookInput = z.infer<typeof CreateSavedNotebookInput>;

/** `GET /api/saved-notebooks`. */
export const SavedNotebookListResponse = z.object({ savedNotebooks: z.array(SavedNotebookSummary) });
export type SavedNotebookListResponse = z.infer<typeof SavedNotebookListResponse>;

/** `POST /api/saved-notebooks` (201) and `GET /api/saved-notebooks/:id`. */
export const SavedNotebookResponse = z.object({ savedNotebook: SavedNotebook });
export type SavedNotebookResponse = z.infer<typeof SavedNotebookResponse>;
