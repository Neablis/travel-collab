import { z } from "zod";
import { PageContext } from "./pages.ts";
import { PageDoc } from "./pageDoc.ts";

/**
 * Notebook pages as commands and events, in the trip's own stream.
 *
 * **Why this exists.** Pages were the one part of a trip that never reached
 * the event log: `createPage`/`updatePage` wrote the `pages` table directly.
 * Two consequences, one reported and one latent. Reported (Mitchell,
 * 2026-09-22, two devices): a notebook save does not move the trip's
 * `headSeq`, so the M13 broadcast correctly answers "nothing happened" while
 * the Overview on the other device goes stale. Latent: a notebook edit
 * appeared in no history, could not be undone, and could not be reverted to.
 *
 * Mitchell, same day, on the direction: *"I always meant to have notebooks to
 * have the same history as trip updates, and to use the same functionality …
 * a notebook that is tied to a trip is only one we need to handle."* Scoped
 * accordingly — every page carries `context.tripId`, and a page that is not
 * tied to a trip is out of scope here and has no stream to live in.
 *
 * ── Why a SEPARATE union rather than more members of `TripEvent` ───────────
 *
 * They share the stream — one `streamId`, one `seq`, one set of batches, so
 * `headSeq` moves on a notebook save and the existing cursor, history grouping
 * and undo targeting all work untouched. What they do NOT share is
 * `TripState`.
 *
 * `hydrate.ts` is the documented inverse of `tripDetailFromState`, guarded by
 * a round-trip property test: **`TripDetail` is a superset of `TripState`**.
 * So a `pages` field on `TripState` is also a `pages` field on `TripDetail` —
 * which is a public v1 response shape, is stored whole in `trip_details.doc`,
 * and is refetched by every board on every poll. Every notebook's full
 * ProseMirror document would ride the hot path, at a 2s interval, to keep a
 * document nobody is looking at up to date.
 *
 * So page state folds separately (`foldPages`), and `TripDetail` does not
 * grow. The cost of that choice is honest and paid in one place:
 * `foldEnvelopes` must now skip these types rather than parse every envelope
 * as a `TripEvent`, and it skips them BY NAME — an unknown event type still
 * throws, because "a stream that cannot be interpreted must fail loudly" is a
 * guard worth keeping and this is not a licence to ignore corruption.
 */

/** Create a notebook page. `pageId` is minted by the caller, as activity ids are. */
export const CreatePage = z.object({
  type: z.literal("CreatePage"),
  tripId: z.string().uuid(),
  pageId: z.string().uuid(),
  title: z.string().min(1),
  context: PageContext,
  content: PageDoc,
});
export type CreatePage = z.infer<typeof CreatePage>;

/**
 * Edit a page's title, its document, or both.
 *
 * **One command for both, because the autosave sends both kinds.** The editor
 * debounces content at 800ms and renames go through the same client function;
 * splitting them would put two commands in the log for one user action
 * whenever someone renames while typing.
 *
 * Omitted means unchanged, following `UpdateActivity`'s rule rather than
 * inventing a second one. Neither field is nullable: a page always has a
 * title, and an emptied page is an empty document, not an absent one.
 */
export const EditPage = z.object({
  type: z.literal("EditPage"),
  tripId: z.string().uuid(),
  pageId: z.string().uuid(),
  title: z.string().min(1).optional(),
  content: PageDoc.optional(),
});
export type EditPage = z.infer<typeof EditPage>;

/** Remove a page. The Overview refuses this — see `decidePageCommand`. */
export const DeletePage = z.object({
  type: z.literal("DeletePage"),
  tripId: z.string().uuid(),
  pageId: z.string().uuid(),
});
export type DeletePage = z.infer<typeof DeletePage>;

export const PageCommand = z.discriminatedUnion("type", [CreatePage, EditPage, DeletePage]);
export type PageCommand = z.infer<typeof PageCommand>;

export const PageCreatedV1 = z.object({
  type: z.literal("PageCreated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    pageId: z.string().uuid(),
    title: z.string().min(1),
    context: PageContext,
    content: PageDoc,
    /**
     * Who the page belongs to, carried in the payload rather than read off the
     * envelope. The envelope's `actorId` is who WROTE this event, and a
     * backfilled or reverted page must keep saying `system` (SPEC §7's
     * "Comes with your trip" line reads exactly this field) even though the
     * event restoring it was written by a person.
     */
    actorId: z.string().min(1),
  }),
});
export type PageCreatedV1 = z.infer<typeof PageCreatedV1>;

export const PageEditedV1 = z.object({
  type: z.literal("PageEdited"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    pageId: z.string().uuid(),
    title: z.string().min(1).optional(),
    content: PageDoc.optional(),
  }),
});
export type PageEditedV1 = z.infer<typeof PageEditedV1>;

export const PageDeletedV1 = z.object({
  type: z.literal("PageDeleted"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    pageId: z.string().uuid(),
  }),
});
export type PageDeletedV1 = z.infer<typeof PageDeletedV1>;

export const PageEvent = z.discriminatedUnion("type", [PageCreatedV1, PageEditedV1, PageDeletedV1]);
export type PageEvent = z.infer<typeof PageEvent>;

/**
 * The event types that belong to the page aggregate rather than the trip one.
 *
 * **`foldEnvelopes` reads this to know what to skip**, so it has to stay exactly
 * in step with `PageEvent` above. The `Record` below is what makes that a
 * compile error rather than a silent gap: adding a member to `PageEvent` without
 * listing it here stops the build, and the failure names this file.
 *
 * Same idiom as `FIELD_EQUAL` (KI-2026-09-05-o) and `activityCommands.ts`, and
 * for the same reason — a set that must mirror a union is exactly the shape
 * that drifts when nothing forces it not to.
 */
const PAGE_EVENT_TYPE_SET: Record<PageEvent["type"], true> = {
  PageCreated: true,
  PageEdited: true,
  PageDeleted: true,
};

export const PAGE_EVENT_TYPES: readonly PageEvent["type"][] = Object.keys(
  PAGE_EVENT_TYPE_SET,
) as PageEvent["type"][];

/** Whether an envelope's `type` belongs to the page aggregate. */
export function isPageEventType(type: string): type is PageEvent["type"] {
  return Object.prototype.hasOwnProperty.call(PAGE_EVENT_TYPE_SET, type);
}
