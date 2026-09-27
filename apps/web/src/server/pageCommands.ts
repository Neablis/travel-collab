import {
  PAGE_CHANGED_CODE,
  PageCommand,
  PageContext as PageContextSchema,
  PageDoc as PageDocSchema,
  PageEvent as PageEventSchema,
  SYSTEM_ACTOR_ID,
  seedKeyOf,
  serializePageDoc,
  type EventEnvelope,
  type Page,
  type PageDoc,
  type PageEvent,
  type TripRole,
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
import {
  defaultDocumentFor,
  instantiateMissingDefaults,
  missingDefaultTemplates,
  type SeedCandidate,
} from "@tc/pages";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { appendToStream, readStream } from "./eventStore";
import { hasAtLeast } from "./accessPolicy";
import { effectiveMembers } from "./access/members";
import { isDemoTripId } from "@/lib/demoTrip";
import { checkPageDocForWrite, toPage } from "./pages";
import { applyPageEvents } from "./projections";

export type PageCommandResult =
  // `seq` is the last event appended, or `null` when nothing was — what a
  // caller needs to name "the version before this" (`restorePageVersion`).
  | { ok: true; tripId: string; page: Page | null; seq: number | null }
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

  return commitPageStep(command.tripId, actorId, "editor", async ({ tx, pages: pagesState }) => {
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

    // **The stale-save guard** (CodeRabbit, PR #222). `expectedSeq` is the
    // head as of THIS request's read, so it cannot refuse an older document
    // that simply arrives last; this can. See `EditPage`.
    //
    // **Only for an edit that changes something, on purpose.** A document
    // identical to the stored one loses nothing whatever revision it was typed
    // against, and the common way to get here is exactly that: a `pagehide`
    // keepalive landed, then the ordinary commit of the same words arrived
    // behind it naming the revision the keepalive just moved past. Refusing it
    // would report a conflict with the author's own words.
    if (decision.events.length > 0 && command.type === "EditPage" && command.expectedUpdatedAt !== undefined) {
      if (!(await pageIsAt(tx, command.pageId, command.expectedUpdatedAt))) {
        return { ok: false, error: { code: PAGE_CHANGED_CODE, message: "This page changed since you opened it." } };
      }
    }
    return { ok: true, events: decision.events, pageId: command.pageId };
  });
}

/** What a step inside `commitPageStep` sees: the stream as read, and the page aggregate with its genesis folded in. */
type PageStep = {
  tx: Parameters<typeof appendToStream>[0];
  history: EventEnvelope[];
  pages: PagesState;
};

/** A step's answer: the events to append (none is a no-op), and which page to read back. */
type PageStepOutcome =
  | { ok: true; events: PageEvent[]; pageId: string | null }
  | { ok: false; error: { code: string; message: string } };

/**
 * The page pipeline around one decision: load the stream, authorize, backfill
 * the genesis, let `step` decide, append with optimistic concurrency, project.
 *
 * Every page write reaches the log through here — `executePageCommand` and the
 * default-notebook actions in `defaultNotebooks.ts` — so none of them grows a
 * second way to write a page. `minimum` is the role the write needs: an editor
 * edits a notebook, and only the owner resets the trip's defaults (Mitchell,
 * 2026-09-27).
 */
async function commitPageStep(
  tripId: string,
  actorId: string,
  minimum: TripRole,
  step: (s: PageStep) => Promise<PageStepOutcome>,
): Promise<PageCommandResult> {
  // The demo trip is read-only all the way down (ADR-031, KI-2026-09-05-d).
  // Refused here rather than at the route, so no caller can reach the write
  // path by finding a different door.
  if (isDemoTripId(tripId)) {
    return { ok: false, error: { code: "demo-trip-readonly", message: "The demo trip cannot be changed." } };
  }

  try {
    return await db.transaction(async (tx): Promise<PageCommandResult> => {
      const history = await readStream(tx, tripId);
      const tripState = foldEnvelopes(history);
      if (tripState === null) {
        return { ok: false, error: { code: "trip-not-found", message: "This trip does not exist." } };
      }

      const members = await effectiveMembers(tx, tripId, tripState.members);
      if (!hasAtLeast(actorId, members, minimum)) {
        const message = minimum === "owner" ? "Only the trip's owner can do this." : "Not allowed to edit this trip's notebooks.";
        return { ok: false, error: { code: "forbidden", message } };
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
      const genesis = await missingGenesis(tx, tripId, foldPages(history));
      const pagesState = genesis.reduce((acc, event) => evolvePages(acc, event), foldPages(history));

      const outcome = await step({ tx, history, pages: pagesState });
      if (!outcome.ok) return outcome;

      // A no-op: an edit session that ended where it began (typed, then undone),
      // a second commit trigger racing the first, or a default-notebook action
      // with nothing left to do. Nothing is appended, so `headSeq` does not move
      // and no co-traveller is woken for a change that did not happen.
      //
      // **The genesis is dropped with it.** Writing backfill events for a no-op
      // would move `headSeq` and wake every co-traveller for nothing, which is
      // the exact cost this branch exists to avoid. They cost nothing to
      // re-derive on the next real command.
      if (outcome.events.length === 0) {
        const page = outcome.pageId === null ? null : await readPage(tx, outcome.pageId);
        return { ok: true, tripId, page, seq: null };
      }

      const appended = await appendToStream(tx, {
        streamId: tripId,
        // The whole stream's length, not the page aggregate's: a trip command
        // and a notebook save take `seq` numbers from one sequence, so they
        // must serialise however separately they fold.
        expectedSeq: history.length,
        // Genesis first: an edit to a backfilled page must fold after the create
        // that introduces it, in the same batch so the two cannot be separated by
        // a crash.
        events: [...genesis, ...outcome.events].map(storedPageEvent),
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
      const page = outcome.pageId === null ? null : await readPage(tx, outcome.pageId);
      return { ok: true, tripId, page, seq: appended.envelopes.at(-1)?.seq ?? null };
    });
  } catch (error) {
    // **Two seeds with one key.** `pages_seed_key_unique` allows one notebook
    // per default per trip, and no rename can ask for a second (titles are
    // free since 2026-09-27; the index used to be on the title, and refused a
    // rename onto a seed's name as `page-title-taken`). What can still reach
    // it is `listPages`' lazy seeding, which writes straight to the table
    // outside the stream, landing between this transaction's read and its
    // write: "add missing" then plants a key the table has just been given.
    // That is a race lost, which a retry resolves, not a server fault.
    if (uniqueViolation(error)?.constraint !== SEED_KEY_INDEX) throw error;
    return RACE_LOST;
  }
}

const SEED_KEY_INDEX = "pages_seed_key_unique";

// Read from the `pages` row, the only place a page's `updatedAt` lives (the
// fold carries no timestamps, and a lazily seeded page has no event to carry
// one). It is consistent with the stream without a lock: this read is a later
// statement in the same transaction, so it sees at least every commit the
// stream read saw, and any page write that lands after it moves the stream too
// and is refused by `expectedSeq` instead.
//
// Compared as instants, not strings: the client echoes Postgres's text, and
// nothing should hang on its formatting.
async function pageIsAt(tx: PageStep["tx"], pageId: string, expectedUpdatedAt: string): Promise<boolean> {
  const [row] = await tx.select({ updatedAt: pages.updatedAt }).from(pages).where(eq(pages.id, pageId));
  return row !== undefined && Date.parse(row.updatedAt) === Date.parse(expectedUpdatedAt);
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
  return row === undefined ? null : toPage(row);
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
        // Written out, `null` included, so the log says which default this
        // row is rather than leaving a replay to work it out from the title.
        seedKey: row.seedKey,
      },
    });
  }
  return genesis;
}

// ── The trip's default notebooks: add the missing ones, reset one ─────────────
//
// Mitchell, 2026-09-27: *"a way to reset a trips default notebooks back to
// there seed and add any new seeds that didnt exist when the trip was made"*,
// and on who: *"Only trip owner"*. A trip is seeded once, lazily, the first
// time its notebooks are listed, so a trip made before M30 never gets the
// itinerary Overview or the seeds added since.
//
// All three go through `commitPageStep`, so each is one batch in the trip's
// log like any other notebook write: visible in history, projected by the same
// writer, serialised against every other command by `expectedSeq`. Which
// template a notebook came from, and what it builds, is `@tc/pages`' answer
// (`seedTemplateOf`), shared with the screen that decides whether to offer
// the control.

/** The trip's notebook rows, in the shape `@tc/pages` recognises seeds from. Includes rows the fold skipped. */
async function seedCandidates(tx: PageStep["tx"], tripId: string): Promise<SeedCandidate[]> {
  return tx
    .select({ id: pages.id, seedKey: pages.seedKey })
    .from(pages)
    .where(eq(pages.tripId, tripId))
    .orderBy(asc(pages.createdAt), asc(pages.id));
}

/**
 * Every page this stream has created, as its FIRST `PageCreated` said it was,
 * oldest first — what `instantiateMissingDefaults` reads a deleted seed's id
 * off, so a re-added seed comes back under it. A seed that was deleted always
 * has one: the delete went through `commitPageStep`, which backfills the
 * genesis first. (Not a row the backfill skipped as unreadable, which has no
 * genesis; that seed comes back under a fresh id.)
 */
function genesisOf(history: readonly EventEnvelope[]): SeedCandidate[] {
  const seen = new Map<string, SeedCandidate>();
  for (const envelope of history) {
    if (envelope.type !== "PageCreated") continue;
    const event = PageEventSchema.parse({ type: envelope.type, version: envelope.version, payload: envelope.payload });
    if (event.type !== "PageCreated") continue;
    // The key the event names, or the one an event from before keys implies.
    if (!seen.has(event.payload.pageId)) seen.set(event.payload.pageId, { id: event.payload.pageId, seedKey: seedKeyOf(event.payload).key });
  }
  return [...seen.values()];
}

// Postgres's unique_violation, and the constraint it names. Walks the `cause` chain, as `eventStore.ts` does: drizzle wraps the driver's
// error, and the constraint name is on the driver's.
function uniqueViolation(error: unknown): { constraint: string | undefined } | null {
  let cursor: unknown = error;
  while (typeof cursor === "object" && cursor !== null) {
    const { code, constraint, cause } = cursor as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (code === "23505") return { constraint: typeof constraint === "string" ? constraint : undefined };
    cursor = cause;
  }
  return null;
}

/**
 * Adds every default notebook the trip has no seed for, as `listPages`' lazy
 * seeding would have — owned by `system`, under the same ids scheme, each with
 * its template's key — and touches nothing that exists. Owner only. A trip
 * missing nothing appends nothing (`seq: null`).
 */
export async function addMissingDefaultPages(tripId: string, actorId: string): Promise<PageCommandResult> {
  return commitPageStep(tripId, actorId, "owner", async ({ tx, history, pages: state }) => {
      const candidates = await seedCandidates(tx, tripId);
      // Minted up front and SORTED, so the new notebooks come back from the
      // list in a new trip's order. They share one `createdAt` (the batch's
      // `occurredAt`), and `listPages` breaks that tie on `id`.
      const fresh = missingDefaultTemplates(candidates)
        .map(() => randomUUID())
        .sort();
      let next = 0;
      const seeds = instantiateMissingDefaults(tripId, candidates, () => fresh[next++]!, genesisOf(history));

      let folded = state;
      const events: PageEvent[] = [];
      for (const seed of seeds) {
        // Through the page decision like any create, with `system` as the
        // OWNER — the parameter exists for exactly this (`decidePageCommand`).
        // The envelope still names the person who asked.
        const decision = decidePageCommand(
          folded,
          {
            type: "CreatePage",
            tripId,
            pageId: seed.id,
            title: seed.title,
            context: seed.context,
            content: seed.content,
            seedKey: seed.seedKey,
          },
          SYSTEM_ACTOR_ID,
        );
        if (!decision.ok) return { ok: false, error: decision.rejection };
        for (const event of decision.events) {
          folded = evolvePages(folded, event);
          events.push(event);
        }
      }
      return { ok: true, events, pageId: null };
  });
}

const RACE_LOST: PageCommandResult = {
  ok: false,
  error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
};

/**
 * Puts a seeded notebook back to its current template — title and document —
 * as one more edit. The page keeps its id, so every link to it still resolves.
 * Owner only. `not-a-default` for a notebook no template recognises.
 *
 * The version it replaced stays in the log; `ResetPageResult.restoreSeq` names
 * it for `restorePageVersion`.
 */
export async function resetPageToDefault(
  tripId: string,
  pageId: string,
  actorId: string,
  expectedUpdatedAt?: string,
): Promise<PageCommandResult> {
  return commitPageStep(tripId, actorId, "owner", async ({ tx, pages: state }) => {
    const candidates = await seedCandidates(tx, tripId);
    const page = candidates.find((row) => row.id === pageId);
    if (page === undefined) return { ok: false, error: { code: "page-not-found", message: "No such page." } };
    const seed = defaultDocumentFor(page, candidates);
    if (seed === null) {
      return { ok: false, error: { code: "not-a-default", message: "This notebook did not come with the trip, so it has no default to reset to." } };
    }
    return editTo(tx, state, { tripId, pageId, ...seed }, actorId, expectedUpdatedAt);
  });
}

/**
 * Puts a notebook's title and document back to what they were at `toSeq` in
 * the trip's history, as one more edit — the undo for a reset. It never
 * deletes or recreates a notebook, so it cannot fall into KI-2026-09-22-c.
 * Owner only, because it is the reset's undo; a general page undo is that
 * entry's to design.
 */
export async function restorePageVersion(
  tripId: string,
  pageId: string,
  toSeq: number,
  actorId: string,
  expectedUpdatedAt?: string,
): Promise<PageCommandResult> {
  return commitPageStep(tripId, actorId, "owner", async ({ tx, history, pages: state }) => {
    const past = toSeq <= history.length ? foldPages(history, toSeq)[pageId] : undefined;
    if (past === undefined) {
      return { ok: false, error: { code: "page-version-not-found", message: "This notebook has no saved version from then." } };
    }
    return editTo(tx, state, { tripId, pageId, title: past.title, content: past.content }, actorId, expectedUpdatedAt);
  });
}

// The shared tail of a reset and a restore: an `EditPage` through the page
// decision, with the write check and the stale-save guard every edit gets.
async function editTo(
  tx: PageStep["tx"],
  state: PagesState,
  target: { tripId: string; pageId: string; title: string; content: PageDoc },
  actorId: string,
  expectedUpdatedAt: string | undefined,
): Promise<PageStepOutcome> {
  const checked = checkPageDocForWrite(target.content);
  if (!checked.ok) return { ok: false, error: { code: "invalid-page", message: checked.message } };
  const decision = decidePageCommand(state, { type: "EditPage", ...target, content: checked.doc }, actorId);
  if (!decision.ok) return { ok: false, error: decision.rejection };
  if (decision.events.length > 0 && expectedUpdatedAt !== undefined && !(await pageIsAt(tx, target.pageId, expectedUpdatedAt))) {
    return { ok: false, error: { code: PAGE_CHANGED_CODE, message: "This page changed since you opened it." } };
  }
  return { ok: true, events: decision.events, pageId: target.pageId };
}
