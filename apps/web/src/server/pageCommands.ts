import {
  PageCommand,
  PageDoc as PageDocSchema,
  PageEvent as PageEventSchema,
  type EventEnvelope,
  type Page,
  type PageEvent,
} from "@tc/contracts";
import { decidePageCommand, evolvePages, foldEnvelopes, foldPages, type PagesState } from "@tc/domain";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { appendToStream, readStream } from "./eventStore";
import { hasAtLeast } from "./accessPolicy";
import { effectiveMembers } from "./access/members";
import { isDemoTripId } from "@/lib/demoTrip";

export type PageCommandResult =
  | { ok: true; tripId: string; page: Page | null }
  | { ok: false; error: { code: string; message: string } };

/**
 * The `pages` table, brought into line with events just appended.
 *
 * **The table is now a PROJECTION, not the source of truth**, and this is the
 * function that makes that true. It runs inside the command's transaction, so
 * the row and the event that caused it land together or not at all — the same
 * guarantee `applyTripEvents` gives the trip's own projections, and the reason
 * neither can drift.
 *
 * It applies the EVENTS rather than reconciling the whole folded state against
 * the table. Both are correct; this one touches only the rows that changed,
 * and a trip with thirty notebooks does not rewrite twenty-nine of them to
 * save one.
 *
 * `createdAt`/`updatedAt` come from the envelope's `occurredAt` rather than
 * from `new Date()`, so a replay writes the times the events say rather than
 * the time the replay ran. `PageState` deliberately carries neither — see its
 * docstring.
 */
async function applyPageEvents(
  tx: Parameters<typeof appendToStream>[0],
  envelopes: EventEnvelope[],
): Promise<void> {
  for (const envelope of envelopes) {
    // Parsed, not cast. These envelopes were built from events this process
    // just decided, so a cast would "work" — but the same function has to be
    // correct for a replay reading rows off disk, and a parse is what makes
    // the switch below narrow honestly instead of being told what to believe.
    const event = PageEventSchema.parse({
      type: envelope.type,
      version: envelope.version,
      payload: envelope.payload,
    });
    switch (event.type) {
      case "PageCreated":
        await tx
          .insert(pages)
          .values({
            id: event.payload.pageId,
            tripId: event.payload.tripId,
            title: event.payload.title,
            context: event.payload.context,
            content: event.payload.content,
            createdAt: envelope.occurredAt,
            updatedAt: envelope.occurredAt,
            actorId: event.payload.actorId,
          })
          // A replay re-applying a create it already applied is not an error.
          .onConflictDoNothing();
        break;
      case "PageEdited":
        await tx
          .update(pages)
          .set({
            ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
            ...(event.payload.content === undefined ? {} : { content: event.payload.content }),
            updatedAt: envelope.occurredAt,
          })
          .where(eq(pages.id, event.payload.pageId));
        break;
      case "PageDeleted":
        await tx.delete(pages).where(eq(pages.id, event.payload.pageId));
        break;
    }
  }
}

/**
 * The command pipeline for notebook pages.
 *
 * Deliberately the SAME SEQUENCE as `executeTripCommand` — validate, load the
 * stream, authorize, decide, append with optimistic concurrency, project — and
 * deliberately a separate function rather than a branch inside it. They share a
 * stream and share nothing else: this one folds the page aggregate, authorizes
 * through `hasAtLeast` (page writes have always been a role question rather
 * than a command-type one, per `accessPolicy`'s own docstring), and returns a
 * `Page` rather than a `TripDetail`.
 *
 * **`expectedSeq` is the whole stream's length, not the page aggregate's.**
 * Optimistic concurrency is about the STREAM: a trip command and a notebook
 * save landing together must still serialise, because they take `seq` numbers
 * from the same sequence. Folding pages separately does not make them separate
 * writers.
 */
export async function executePageCommand(
  input: unknown,
  actorId: string,
): Promise<PageCommandResult> {
  const parsed = PageCommand.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const command = parsed.data;

  // The demo trip is read-only all the way down (ADR-031, KI-2026-09-05-d).
  // Refused here rather than at the route, so no caller can reach the write
  // path by finding a different door.
  if (isDemoTripId(command.tripId)) {
    return { ok: false, error: { code: "demo-trip-readonly", message: "The demo trip cannot be changed." } };
  }

  return db.transaction(async (tx): Promise<PageCommandResult> => {
    const history = await readStream(tx, command.tripId);
    const tripState = foldEnvelopes(history);
    if (tripState === null) {
      return { ok: false, error: { code: "trip-not-found", message: "This trip does not exist." } };
    }

    const members = await effectiveMembers(tx, command.tripId, tripState.members);
    if (!hasAtLeast(actorId, members, "editor")) {
      return { ok: false, error: { code: "forbidden", message: "Not allowed to edit this trip's notebooks." } };
    }

    // **Lazy genesis, and it is not optional.** Every page that existed before
    // this milestone is a ROW with no `PageCreated` event — `listPages` seeds
    // the Overview lazily on first read and has always written straight to the
    // table. So the fold cannot see them, and without this the first edit to
    // any existing notebook is answered `page-not-found`. An integration test
    // caught exactly that on the seeded Overview.
    //
    // Backfilled here rather than by a data migration, for the reason
    // `listPages`'s own lazy seeding gives: a migration has to find every trip,
    // including ones created between deploying it and running it, and this
    // cannot miss one — the genesis is written the first time a page is
    // commanded, which is the first moment it could possibly matter.
    //
    // `SYSTEM_ACTOR_ID` is NOT assumed: the row's own `actorId` is carried into
    // the payload, so SPEC §7's "Comes with your trip" / "Yours" line keeps
    // telling the truth about a page a person created before this existed.
    const genesis = await missingGenesis(tx, command.tripId, foldPages(history));
    const pagesState = genesis.reduce(
      (acc, event) => evolvePages(acc, event),
      foldPages(history),
    );

    const decision = decidePageCommand(pagesState, command, actorId);
    if (!decision.ok) return { ok: false, error: decision.rejection };

    // A no-op edit — the 800ms autosave firing on the pause after an
    // already-saved change. Nothing is appended, so `headSeq` does not move and
    // no co-traveller is woken for a change that did not happen.
    //
    // **The genesis is dropped with it.** Writing backfill events for an edit
    // that turned out to be a no-op would move `headSeq` and wake every
    // co-traveller for nothing, which is the exact cost this branch exists to
    // avoid. They cost nothing to re-derive on the next real command.
    if (decision.events.length === 0) {
      return { ok: true, tripId: command.tripId, page: await readPage(tx, command.pageId) };
    }

    const appended = await appendToStream(tx, {
      streamId: command.tripId,
      expectedSeq: history.length,
      // Genesis first: an edit to a backfilled page must fold after the create
      // that introduces it, in the same batch so the two cannot be separated by
      // a crash.
      events: [...genesis, ...decision.events],
      actorId,
      occurredAt: new Date().toISOString(),
      batchId: crypto.randomUUID(),
      origin: { kind: "user" },
    });
    if (!appended.ok) {
      return {
        ok: false,
        error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
      };
    }

    await applyPageEvents(tx, appended.envelopes);
    return { ok: true, tripId: command.tripId, page: await readPage(tx, command.pageId) };
  });
}

async function readPage(
  tx: Parameters<typeof appendToStream>[0],
  pageId: string,
): Promise<Page | null> {
  const [row] = await tx.select().from(pages).where(eq(pages.id, pageId));
  if (row === undefined) return null;
  return {
    id: row.id,
    tripId: row.tripId,
    title: row.title,
    context: row.context,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actorId: row.actorId,
  };
}

/**
 * `PageCreated` events for rows the fold has never heard of.
 *
 * The bridge between "the table was the source of truth" and "the log is".
 * Reconstructed from the row itself, so the backfilled event says what the
 * page actually is rather than a default.
 *
 * Ordered by `createdAt` then `id`, matching `listPages`' ordering, so a
 * backfill produces the same events in the same order on every trip and a
 * replay is deterministic.
 */
async function missingGenesis(
  tx: Parameters<typeof appendToStream>[0],
  tripId: string,
  known: PagesState,
): Promise<PageEvent[]> {
  const rows = await tx.select().from(pages).where(eq(pages.tripId, tripId));
  const genesis: PageEvent[] = [];
  const candidates = rows
    .filter((row) => known[row.id] === undefined)
    .sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
    );

  for (const row of candidates) {
    // **Parsed, and a row that will not parse is SKIPPED rather than thrown
    // on.** The column is `PageContent`, which is deliberately permissive on
    // the way out (ADR-038), while an event payload is a `PageDoc` — stricter,
    // and the shape the write path has always demanded. Most rows cross that
    // gap for free: `PageDoc.v` defaults to 1, so a document written before the
    // stamp existed parses and comes back stamped.
    //
    // A row that still will not parse is one this build cannot represent
    // losslessly, and ADR-038 decision 4 is that such a document must not be
    // SAVED. Backfilling it would be saving it — through the log, in a shape
    // the log then asserts is true. So it stays out, and commands against that
    // one page answer `page-not-found` until someone repairs it. Throwing
    // instead would take out every notebook on the trip, including the ones
    // that are fine.
    const content = PageDocSchema.safeParse(row.content);
    if (!content.success) continue;
    genesis.push({
      type: "PageCreated",
      version: 1,
      payload: {
        tripId: row.tripId,
        pageId: row.id,
        title: row.title,
        context: row.context,
        content: content.data,
        actorId: row.actorId,
      },
    });
  }
  return genesis;
}
