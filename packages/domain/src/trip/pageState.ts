import type { EventEnvelope, PageCommand, PageContext, PageDoc, PageEvent } from "@tc/contracts";
import { PageEvent as PageEventSchema, isPageEventType } from "@tc/contracts";

/**
 * The page aggregate: notebook pages folded from the trip's own stream.
 *
 * `pageEvents.ts` in `@tc/contracts` carries the argument for why this folds
 * separately from `TripState` instead of joining it. The short version:
 * `TripDetail` is a superset of `TripState` and is refetched on every poll, so
 * putting documents in `TripState` puts every notebook on the hot path.
 */

/**
 * One page, as the log says it is.
 *
 * `createdAt`/`updatedAt` are deliberately ABSENT. They are facts about when
 * rows were written, which the envelope already records (`occurredAt`), and a
 * fold that invented them would have to choose between the original write and
 * the replay — a choice with no right answer and a property test waiting to
 * catch it. The `pages` table keeps its own timestamps; this is the state the
 * log determines.
 */
export type PageState = {
  title: string;
  context: PageContext;
  content: PageDoc;
  /** The page's OWNER, not whoever wrote the last event. See `PageCreatedV1`. */
  actorId: string;
};

/** Every page of a trip, keyed by page id. */
export type PagesState = Record<string, PageState>;

export function evolvePages(state: PagesState, event: PageEvent): PagesState {
  switch (event.type) {
    case "PageCreated": {
      const { pageId, title, context, content, actorId } = event.payload;
      return { ...state, [pageId]: { title, context, content, actorId } };
    }
    case "PageEdited": {
      const current = state[event.payload.pageId];
      // An edit to a page the fold has never seen created. Unlike the trip
      // aggregate's `requireDay`, this ABSORBS rather than throws — and the
      // difference is the backfill. Streams that predate page events carry
      // rows whose genesis is the migration, and a trip whose backfill is
      // incomplete must still fold. A dropped edit is recoverable; a trip that
      // will not load is not.
      if (current === undefined) return state;
      return {
        ...state,
        [event.payload.pageId]: {
          ...current,
          ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
          ...(event.payload.content === undefined ? {} : { content: event.payload.content }),
        },
      };
    }
    case "PageDeleted": {
      if (state[event.payload.pageId] === undefined) return state;
      const next = { ...state };
      delete next[event.payload.pageId];
      return next;
    }
  }
}

/**
 * Every page of this stream as of `toSeq`, or as of the head.
 *
 * The mirror of `foldEnvelopes`, and it skips the trip's events exactly as
 * that one now skips these. Both filter BY NAME: an envelope belonging to
 * neither aggregate is a corrupt stream, and each fold leaves it for the other
 * to refuse rather than silently tolerating it here.
 */
export function foldPages(envelopes: EventEnvelope[], toSeq?: number): PagesState {
  let state: PagesState = {};
  for (const env of envelopes) {
    if (toSeq !== undefined && env.seq > toSeq) break;
    if (!isPageEventType(env.type)) continue;
    state = evolvePages(
      state,
      PageEventSchema.parse({ type: env.type, version: env.version, payload: env.payload }),
    );
  }
  return state;
}

/**
 * Structural equality for two stored documents.
 *
 * **Not `JSON.stringify`.** Two documents that differ only in key order are the
 * same document, and stringify calls them different — which here would mean an
 * undo emitting a `PageEdited` that changes nothing, forever, because the next
 * comparison disagrees again. A ProseMirror document is plain JSON (no dates,
 * no undefined, no cycles — `PageDoc` parses it), so a recursive walk is total.
 */
function docsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => docsEqual(item, b[i]));
  }
  const ax = a as Record<string, unknown>;
  const bx = b as Record<string, unknown>;
  const aKeys = Object.keys(ax);
  if (aKeys.length !== Object.keys(bx).length) return false;
  return aKeys.every(
    (k) => Object.prototype.hasOwnProperty.call(bx, k) && docsEqual(ax[k], bx[k]),
  );
}

/** Whether two page states are the same page, field for field. */
export function pageStatesEqual(a: PageState, b: PageState): boolean {
  return (
    a.title === b.title &&
    a.actorId === b.actorId &&
    a.context.kind === b.context.kind &&
    a.context.tripId === b.context.tripId &&
    docsEqual(a.content, b.content)
  );
}

/**
 * The page events that turn `current` into `target`.
 *
 * **This is what makes undo, redo and revert cover notebooks**, and it is the
 * page half of `diffTripStates`. `decideHistoryCommand` folds the stream to a
 * target seq and asks both aggregates for the forward events that get there;
 * history in this codebase has always moved FORWARD to an earlier state rather
 * than rewinding the log (ADR-005), and a page is no different.
 *
 * Deterministic order — created, edited, deleted, each by page id — so the same
 * undo produces the same batch twice and a test can assert on it.
 */
export function diffPageStates(current: PagesState, target: PagesState, tripId: string): PageEvent[] {
  const created: PageEvent[] = [];
  const edited: PageEvent[] = [];
  const deleted: PageEvent[] = [];

  for (const pageId of Object.keys(target).sort()) {
    const want = target[pageId]!;
    const have = current[pageId];
    if (have === undefined) {
      created.push({
        type: "PageCreated",
        version: 1,
        payload: { tripId, pageId, title: want.title, context: want.context, content: want.content, actorId: want.actorId },
      });
      continue;
    }
    if (pageStatesEqual(have, want)) continue;
    // A whole-page edit rather than a minimal one: `PageEdited` carries the
    // fields that CHANGED, and sending both when either moved would be a
    // smaller diff to compute and a larger one to store. Title and content are
    // the only two an edit can touch — `context.kind` is identity (`updatePage`
    // refuses to write it) and `actorId` is ownership, so a page whose only
    // difference is one of those cannot be reached by any command and is a
    // corrupt target rather than an edit.
    edited.push({
      type: "PageEdited",
      version: 1,
      payload: {
        tripId,
        pageId,
        ...(have.title === want.title ? {} : { title: want.title }),
        ...(docsEqual(have.content, want.content) ? {} : { content: want.content }),
      },
    });
  }

  for (const pageId of Object.keys(current).sort()) {
    if (target[pageId] === undefined) {
      deleted.push({ type: "PageDeleted", version: 1, payload: { tripId, pageId } });
    }
  }

  // An "edit" that changed neither field is a page differing only in a field no
  // command can write — dropped rather than emitted, so an undo cannot produce
  // a no-op event that the next comparison will ask for again.
  const realEdits = edited.filter(
    (e) => e.type === "PageEdited" && (e.payload.title !== undefined || e.payload.content !== undefined),
  );
  return [...created, ...realEdits, ...deleted];
}

export type PageDecision =
  | { ok: true; events: PageEvent[] }
  | { ok: false; rejection: { code: string; message: string } };

export const OVERVIEW_UNDELETABLE =
  "The Overview comes with the trip and cannot be deleted. You can empty it instead.";

/**
 * A page command against the page aggregate.
 *
 * The refusals mirror `deletePage`'s in `server/pages.ts`, which is where they
 * lived when the table was the only source of truth — same wording, so the
 * message a reader sees does not depend on which path refused them.
 */
export function decidePageCommand(
  state: PagesState,
  command: PageCommand,
  /**
   * Who is running this command, used as the OWNER of a page it creates.
   *
   * Passed in rather than read off the command, for the reason AGENTS.md
   * invariant 6c gives: the planning domain never reads identity from a
   * request. The server knows the actor and hands it down, exactly as it does
   * when stamping the envelope.
   */
  actorId: string,
): PageDecision {
  switch (command.type) {
    case "CreatePage": {
      if (state[command.pageId] !== undefined) {
        return { ok: false, rejection: { code: "page-exists", message: "That page already exists." } };
      }
      return {
        ok: true,
        events: [
          {
            type: "PageCreated",
            version: 1,
            payload: {
              tripId: command.tripId,
              pageId: command.pageId,
              title: command.title,
              context: command.context,
              content: command.content,
              // A page created through a command belongs to whoever ran it.
              // The seeded defaults carry `SYSTEM_ACTOR_ID` instead — they are
              // written by the backfill and the lazy seeder, never through
              // here, which is what keeps SPEC §7's "Comes with your trip"
              // line telling the truth.
              actorId,
            },
          },
        ],
      };
    }
    case "EditPage": {
      const current = state[command.pageId];
      if (current === undefined) {
        return { ok: false, rejection: { code: "page-not-found", message: "No such page." } };
      }
      const title = command.title !== undefined && command.title !== current.title ? command.title : undefined;
      const content =
        command.content !== undefined && !docsEqual(command.content, current.content)
          ? command.content
          : undefined;
      // **Nothing changed is not an error, and not an event either.** The
      // editor autosaves on an 800ms debounce, and a debounce fires on the
      // pause after a change that was already saved — writing that would put a
      // no-op edit in the history panel for every trailing keystroke pause.
      if (title === undefined && content === undefined) return { ok: true, events: [] };
      return {
        ok: true,
        events: [
          {
            type: "PageEdited",
            version: 1,
            payload: {
              tripId: command.tripId,
              pageId: command.pageId,
              ...(title === undefined ? {} : { title }),
              ...(content === undefined ? {} : { content }),
            },
          },
        ],
      };
    }
    case "DeletePage": {
      const current = state[command.pageId];
      if (current === undefined) {
        return { ok: false, rejection: { code: "page-not-found", message: "No such page." } };
      }
      if (current.context.kind === "overview") {
        return { ok: false, rejection: { code: "page-undeletable", message: OVERVIEW_UNDELETABLE } };
      }
      return {
        ok: true,
        events: [{ type: "PageDeleted", version: 1, payload: { tripId: command.tripId, pageId: command.pageId } }],
      };
    }
  }
}
