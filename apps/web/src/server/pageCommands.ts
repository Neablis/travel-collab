import {
  PageCommand,
  PageContext as PageContextSchema,
  PageDoc as PageDocSchema,
  serializePageDoc,
  type Page,
  type PageEvent,
} from "@tc/contracts";
import {
  decidePageCommand,
  evolvePages,
  foldEnvelopes,
  foldPages,
  OVERVIEW_UNDELETABLE,
  type PageDecision,
  type PagesState,
} from "@tc/domain";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { appendToStream, readStream } from "./eventStore";
import { hasAtLeast } from "./accessPolicy";
import { effectiveMembers } from "./access/members";
import { isDemoTripId } from "@/lib/demoTrip";
import { checkPageDocForWrite } from "./pages";
import { applyPageEvents } from "./projections";

export type PageCommandResult =
  | { ok: true; tripId: string; page: Page | null }
  | { ok: false; error: { code: string; message: string } };

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
 *
 * **`input` is the WIRE form** — a command's `content` exactly as a client
 * would send it, or `serializePageDoc` of a parsed one — never a `PageDoc`
 * parse output. This function parses it, and a parse output fed back through
 * a parse wraps every node from a newer build one level deeper
 * (KI-2026-09-05-g).
 */
export async function executePageCommand(
  input: unknown,
  actorId: string,
): Promise<PageCommandResult> {
  const parsed = PageCommand.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  let command = parsed.data;

  // **The save is checked, not merely parsed** (KI-2026-09-05-g). `PageDoc`
  // can say a widget node is well-formed; only the registry knows whether it
  // exists and what it takes, and contracts cannot import the registry. Here,
  // rather than at the routes, because every page write — both BFF routes and
  // both `/api/v1` ones — reaches this function and no other.
  if (command.type !== "DeletePage" && command.content !== undefined) {
    const checked = checkPageDocForWrite(command.content);
    if (!checked.ok) return { ok: false, error: { code: "invalid-page", message: checked.message } };
    command = { ...command, content: checked.doc };
  }

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

    let decision = decidePageCommand(pagesState, command, actorId);

    // **A row the backfill had to skip can still be DELETED.**
    //
    // `missingGenesis` skips a row whose document will not parse, so the fold
    // never learns the page and every command against it is answered
    // `page-not-found` — including delete, while `getPage` can see the row
    // sitting right there. The SQL `deletePage` that used to remove one is
    // gone with the other direct writers, so without this an unreadable
    // notebook is stuck in the list with no way out and no repair path.
    //
    // ADR-038 decision 4 forbids SAVING a document this build cannot
    // represent. Deleting does not save it: `PageDeleted` carries no content.
    if (!decision.ok && decision.rejection.code === "page-not-found" && command.type === "DeletePage") {
      const rescued = await deleteSkippedRow(tx, command.tripId, command.pageId);
      if (rescued !== null) decision = rescued;
    }
    if (!decision.ok) return { ok: false, error: decision.rejection };

    // A no-op edit: an edit session that ended where it began (typed, then
    // undone), or a second commit trigger racing the first. Nothing is
    // appended, so `headSeq` does not move and no co-traveller is woken for a
    // change that did not happen.
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
      events: [...genesis, ...decision.events].map(storedPageEvent),
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

/**
 * A page event as it is WRITTEN — its document serialised, not the parse output.
 *
 * `PageDoc`'s parse output is an in-memory shape: a node this build does not
 * know becomes `{ type: "unknown", raw }` (ADR-038 decision 3), and
 * `KNOWN_NODE_TYPES` deliberately excludes `"unknown"`, so storing that shape
 * means the next parse wraps it AGAIN. Both the log and the `pages` projection
 * stored it, so a newer build's node saved through an older server was
 * reclassified for good and `collectPageDocNodeTypes` never reported it again
 * (KI-2026-09-05-g, F-B09) — exactly the rolling-deploy window decision 3 was
 * written for. `serializePageDoc` unwraps it back to the bytes that came in.
 *
 * Applied to the log AND the projection (`applyPageEvents` in `projections.ts`),
 * so a rebuild from the log writes the same row this did.
 */
function storedPageEvent(event: PageEvent): { type: string; version: number; payload: unknown } {
  if (event.type === "PageDeleted" || event.payload.content === undefined) return event;
  return { ...event, payload: { ...event.payload, content: serializePageDoc(event.payload.content) } };
}

/**
 * The delete decision for a row `missingGenesis` skipped, or `null` if this is
 * not that case.
 *
 * Deliberately narrow. It answers only for a row that exists, belongs to THIS
 * trip, and is unparseable — the exact condition that put the page beyond the
 * fold's reach. A parseable row is `null`, because then the fold already knew
 * the page and the ordinary decision was right to refuse.
 */
async function deleteSkippedRow(
  tx: Parameters<typeof appendToStream>[0],
  tripId: string,
  pageId: string,
): Promise<PageDecision | null> {
  const [row] = await tx.select().from(pages).where(eq(pages.id, pageId));
  if (row === undefined || row.tripId !== tripId) return null;
  // Parseable means the fold knew it, so `page-not-found` came from somewhere
  // else and is not this function's to overturn.
  if (PageDocSchema.safeParse(row.content).success) return null;

  // The Overview stays undeletable (SPEC §25), and an unreadable `context` is
  // refused rather than guessed: not being able to prove a page is ordinary is
  // not the same as proving it is.
  const context = PageContextSchema.safeParse(row.context);
  if (!context.success || context.data.kind === "overview") {
    return { ok: false, rejection: { code: "page-undeletable", message: OVERVIEW_UNDELETABLE } };
  }
  return {
    ok: true,
    events: [{ type: "PageDeleted", version: 1, payload: { tripId, pageId } }],
  };
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
