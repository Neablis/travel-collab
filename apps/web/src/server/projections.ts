import {
  PageEvent,
  TripDetail,
  TripEvent,
  isPageEventType,
  seedKeyOf,
  serializePageDoc,
  type EventEnvelope,
  PageCreatedV1,
  type PageContent,
  type PageDoc,
} from "@tc/contracts";
import { projectTripDetails, projectTripSummaries } from "@tc/domain";
import { and, desc, eq, getTableColumns, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { hasMembershipRow } from "./access/members";
import { serverConflictContext } from "./conflictContext";
import { db, type Queryable } from "./db/client";
import { events, pages, tripCovers, tripDetails, tripSummaries } from "./db/schema";
import { readAll } from "./eventStore";
import { isUuid } from "./ids";
import { TRIP_COVER_JSON } from "./tripCovers";

// The ONLY code allowed to write trip_summaries (AGENTS.md invariant 1).
export async function applyTripEvents(
  tx: Queryable,
  envelopes: EventEnvelope[],
): Promise<void> {
  for (const env of envelopes) {
    const event = TripEvent.parse({
      type: env.type,
      version: env.version,
      payload: env.payload,
    });
    switch (event.type) {
      case "TripCreated":
        await tx.insert(tripSummaries).values({
          tripId: event.payload.tripId,
          name: event.payload.name,
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
          status: "active",
          startDate: null,
        });
        break;
      case "TripStartDateSet":
        await tx.update(tripSummaries)
          .set({ startDate: event.payload.startDate })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      case "TripNameSet":
        await tx.update(tripSummaries)
          .set({ name: event.payload.name })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      case "TripDeleted":
        await tx.update(tripSummaries)
          .set({ status: "deleted" })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      case "TripRestored":
        await tx.update(tripSummaries)
          .set({ status: "active" })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      // Other planning events don't touch the summaries read model.
    }
  }
}

/**
 * The `pages` table, brought into line with page events. **The ONLY code
 * allowed to write `pages` from the log** (AGENTS.md invariant 1): the command
 * path runs it inside the command's transaction, so the row and the event land
 * together or not at all, and `rebuildProjections` replays the whole log
 * through it, so a rebuild writes what the command path wrote by construction
 * rather than through a second copy that could drift.
 *
 * It applies EVENTS rather than reconciling folded state against the table:
 * a trip with thirty notebooks does not rewrite twenty-nine of them to save one.
 *
 * **Timestamps are the log's, with one exception, and the exception is the
 * backfill.** `createdAt`/`updatedAt` come from `occurredAt`, so a replay
 * writes the times the events say. But a `PageCreated` that lands on a row
 * which already exists is a BACKFILLED genesis (`missingGenesis`): the row
 * predates the log, the event was written the first time a page on its trip
 * was commanded, and its `occurredAt` is that moment, not when the page was
 * made. `createdAt` orders the notebook list and `updatedAt` is its "edited …"
 * line, so adopting the event's time would reorder the notebooks and mark each
 * one edited just now. Those two stay; every field the event DOES know (title,
 * context, content, owner) is taken from it, so the row holds nothing about the
 * document that the log does not.
 */
export async function applyPageEvents(tx: Queryable, envelopes: EventEnvelope[]): Promise<void> {
  for (const envelope of envelopes) {
    // Parsed, not cast: the same function has to be correct for a replay
    // reading rows off disk, and a parse is what makes the switch narrow
    // honestly instead of being told what to believe.
    const event = PageEvent.parse({ type: envelope.type, version: envelope.version, payload: envelope.payload });
    switch (event.type) {
      case "PageCreated": {
        const fromLog = {
          title: event.payload.title,
          context: event.payload.context,
          content: storedContent(event.payload.content),
          actorId: event.payload.actorId,
          seedKey: await projectedSeedKey(tx, event.payload),
        };
        await tx
          .insert(pages)
          .values({
            id: event.payload.pageId,
            tripId: event.payload.tripId,
            ...fromLog,
            createdAt: envelope.occurredAt,
            updatedAt: envelope.occurredAt,
          })
          .onConflictDoUpdate({ target: pages.id, set: fromLog });
        break;
      }
      case "PageEdited":
        await tx
          .update(pages)
          .set({
            ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
            ...(event.payload.content === undefined ? {} : { content: storedContent(event.payload.content) }),
            updatedAt: envelope.occurredAt,
          })
          .where(eq(pages.id, event.payload.pageId));
        break;
      case "PageDeleted": {
        const [gone] = await tx
          .delete(pages)
          .where(eq(pages.id, event.payload.pageId))
          .returning({ seedKey: pages.seedKey });
        if (gone?.seedKey != null) await passSeedKeyOnRows(tx, event.payload.tripId, gone.seedKey, envelope.seq);
        break;
      }
    }
  }
}

// The seed key a `PageCreated` gives its row: the one it names, or, for an
// event from before keys, the one it implies (`seedKeyOf`) unless another row
// of the trip already holds it. A NAMED key takes the key from any other row
// holding it (an undo bringing a deleted seed back after its heir inherited),
// and that row waits to inherit again. The page fold does the same to its
// state (`evolvePages`), and the migration that added the column answered it
// for the rows that existed, oldest first — so a rebuild of an old log gives
// the keys the backfill gave.
async function projectedSeedKey(tx: Queryable, payload: PageCreatedV1["payload"]): Promise<string | null> {
  const { key, derived } = seedKeyOf(payload);
  if (key === null) return null;
  const heldElsewhere = and(eq(pages.tripId, payload.tripId), eq(pages.seedKey, key), ne(pages.id, payload.pageId));
  if (!derived) {
    await tx.update(pages).set({ seedKey: null }).where(heldElsewhere);
    return key;
  }
  const [holder] = await tx.select({ id: pages.id }).from(pages).where(heldElsewhere);
  return holder === undefined ? key : null;
}

/**
 * A deleted seed's key, handed to its heir: the trip's keyless row whose
 * `PageCreated` (its latest as of `seq`, the delete) is from before keys and
 * implies `key`, the oldest such by that event's `seq`. `passSeedKeyOn` in
 * `@tc/domain` does the same to the page fold, and migration 0032's backfill
 * picks the same page among the rows it saw (`seq` first), so a rebuild keys
 * the page the backfill keyed even when a replay met the first holder alive.
 *
 * A row with no `PageCreated` is never an heir. Every live page has one by the
 * time a delete is written (`commitPageStep` backfills the trip's genesis
 * first, naming each row's key), and the rows it skips, as unreadable, are left
 * alone by a rebuild too. Reading geneses up to `seq` rather than the whole
 * stream is what keeps a replay from seeing a create that comes later.
 */
async function passSeedKeyOnRows(tx: Queryable, tripId: string, key: string, seq: number): Promise<void> {
  const keyless = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.tripId, tripId), isNull(pages.seedKey)));
  if (keyless.length === 0) return;
  const pageIdOf = sql<string>`${events.payload}->>'pageId'`;
  const geneses = await tx
    .selectDistinctOn([pageIdOf], { seq: events.seq, version: events.version, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.streamId, tripId),
        eq(events.type, "PageCreated"),
        lte(events.seq, seq),
        inArray(pageIdOf, keyless.map((row) => row.id)),
      ),
    )
    .orderBy(pageIdOf, desc(events.seq));
  const [heir] = geneses
    .map((g) => ({ seq: g.seq, ...PageCreatedV1.parse({ type: "PageCreated", version: g.version, payload: g.payload }) }))
    .filter((g) => {
      const implied = seedKeyOf(g.payload);
      return implied.derived && implied.key === key;
    })
    .sort((a, b) => a.seq - b.seq);
  if (heir !== undefined) await tx.update(pages).set({ seedKey: key }).where(eq(pages.id, heir.payload.pageId));
}

/**
 * `serializePageDoc`, typed for the `pages.content` column, and never the
 * parse output. `PageDoc`'s parse wraps a node this build does not know as
 * `{ type: "unknown", raw }`, and storing THAT means the next parse wraps it
 * again (KI-2026-09-05-g). Serialising unwraps it back to the bytes that came
 * in, which is also what keeps a replay idempotent over a document stored
 * wrapped before that fix (KI-2026-09-24-d item 1): the parse wraps once, this
 * unwraps once, and the row comes back as it was.
 */
function storedContent(doc: PageDoc): PageContent {
  return serializePageDoc(doc) as PageContent;
}

// The ONLY code allowed to write trip_details (AGENTS.md invariant 1).
export async function upsertTripDetail(tx: Queryable, detail: TripDetail): Promise<void> {
  await tx
    .insert(tripDetails)
    .values({ tripId: detail.tripId, doc: detail })
    .onConflictDoUpdate({ target: tripDetails.tripId, set: { doc: detail } });
}

/**
 * The stored `trip_details` document, PARSED (KI-2026-09-05-r).
 *
 * `trip_details.doc` is `jsonb(...).$type<TripDetail>()`, and a Drizzle
 * `$type` is a compile-time cast with no runtime check behind it — see the
 * note at `db/schema.ts`. This function returning `rows[0]?.doc` under a
 * `Promise<TripDetail | null>` signature therefore asserted something no code
 * had ever verified, and handed that assertion to every caller: `cloneTrip`,
 * `shares`, `invites`, the member-removal route and `requireTripAccess`.
 *
 * Six of those callers survived on luck rather than design — they read only
 * `status`, `members` and `name`, which are day-one fields no contract change
 * has ever defaulted. The seventh did not: `requireTripAccess` had to grow its
 * own `safeParse` (KI-74) after a pre-M18 doc, missing `kind` and `tags`,
 * 500'd the board on every untouched trip. The parse belongs HERE, at the one
 * place the document leaves the database, so the next caller starts correct by
 * default instead of inheriting the lie and rediscovering KI-74.
 *
 * THROWING is how it declines, for the reason `withEffectiveMembers` throws:
 * `null` is this function's word for "no such trip", and a trip whose row is
 * malformed is not a trip that does not exist — answering 404 for it would
 * hide a broken row behind a routine miss. The issues are logged with the
 * `tripId` because the throw does not carry it, and the id is what makes the
 * row findable.
 */
export async function getTripDetail(tripId: string): Promise<TripDetail | null> {
  // `trip_id` is a uuid column, so a `tripId` that is not one is not a miss —
  // it is `22P02` out of the driver, and the 500 that reached the board as the
  // literal words "Internal Server Error" (KI-2026-09-05-x). This is the single
  // highest-traffic instance: `requireTripAccess` calls it before anything
  // else, so answering "no such trip" here is what turns `GET /api/trips/:id`,
  // `/history`, `/pages`, `/access`, `/globals` and `POST /duplicate` from 500
  // into the 404 they always meant.
  if (!isUuid(tripId)) return null;
  const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
  const doc = rows[0]?.doc;
  if (doc === undefined) return null;
  const parsed = TripDetail.safeParse(doc);
  if (!parsed.success) {
    console.error("trip_details doc failed TripDetail parse", {
      tripId,
      issues: parsed.error.issues,
    });
    throw parsed.error;
  }
  return parsed.data;
}

/**
 * Every projection, rebuilt from the log.
 *
 * **`pages` is REPLAYED, not truncated**, and the difference is the rows the
 * log has never heard of. `listPages` still seeds a trip's default notebook as
 * a row on first read (a read must not append events), and a page gets its
 * genesis only when some page on its trip is first commanded, so until then
 * the row is the only record there is. Deleting every row and re-inserting from
 * the log would delete those notebooks. Replaying every page event through
 * `applyPageEvents` instead rewrites each page the log knows (recreating a lost
 * row, restoring a changed one, removing one the log deleted) and leaves the
 * rest alone. The rows it leaves are also the ones the backfill skipped as
 * unreadable (ADR-038 decision 4), which must not be rewritten either.
 *
 * **The rows the log DOES know are cleared first, and their timestamps put
 * back after** (2026-09-27). Replaying onto them in place broke on the seed
 * index (then `pages_system_seed_unique`, on the title) once a seed could be
 * deleted and seeded again ("Add missing default notebooks"): the old seed's
 * genesis re-inserted its title while the new seed's row already held it.
 * Replayed from empty, the table passes through the same states the live
 * writes did, which the index already accepted — and which the seed key an old
 * event implies is read against (`projectedSeedKey`). `createdAt` is the row's (a backfilled genesis
 * is not when the page was made, and it orders the list); so is `updatedAt`,
 * unless an edit in the log moved it.
 */
export async function rebuildProjections(): Promise<void> {
  await db.transaction(async (tx) => {
    const envelopes = await readAll(tx);
    const summaries = projectTripSummaries(envelopes);
    await tx.delete(tripSummaries);
    for (const s of summaries) {
      await tx.insert(tripSummaries).values(s);
    }
    const details = projectTripDetails(envelopes, serverConflictContext());
    await tx.delete(tripDetails);
    for (const d of details) {
      await tx.insert(tripDetails).values({ tripId: d.tripId, doc: d });
    }
    const pageEnvelopes = envelopes.filter((e) => isPageEventType(e.type));
    const pageIdOf = (e: EventEnvelope) => (e.payload as { pageId: string }).pageId;
    const logged = [...new Set(pageEnvelopes.map(pageIdOf))];
    const edited = new Set(pageEnvelopes.filter((e) => e.type === "PageEdited").map(pageIdOf));
    const kept: { id: string; createdAt: string; updatedAt: string }[] = [];
    // In chunks: a statement takes at most 65,535 parameters.
    for (let i = 0; i < logged.length; i += 1000) {
      const ids = logged.slice(i, i + 1000);
      kept.push(
        ...(await tx
          .select({ id: pages.id, createdAt: pages.createdAt, updatedAt: pages.updatedAt })
          .from(pages)
          .where(inArray(pages.id, ids))),
      );
      await tx.delete(pages).where(inArray(pages.id, ids));
    }
    await applyPageEvents(tx, pageEnvelopes);
    for (const row of kept) {
      await tx
        .update(pages)
        .set({ createdAt: row.createdAt, ...(edited.has(row.id) ? {} : { updatedAt: row.updatedAt }) })
        .where(eq(pages.id, row.id));
    }
  });
}

/**
 * **A listed trip: its `trip_summaries` row plus `endDate`**
 * (KI-2026-09-24-e), for the two queries that answer with `TripSummary`.
 *
 * `endDate` is the date `trip_details` gives the trip's last day, read here
 * rather than stored as a summary column. The document already holds it —
 * `tripDetailFromState` dates every day from the start date — so a column
 * would be a second copy of that date math, kept by a second projector, plus
 * a migration and a backfill. Both tables are written in the same transaction
 * by the command path and by `rebuildProjections`, so the two cannot be read
 * out of step. The LEFT JOIN makes a summary with no document (none should
 * exist) list with an unknown end rather than vanish.
 *
 * Only this one scalar is read from the unparsed document (see the `$type`
 * note at `db/schema.ts`), so it is shape-checked here, with the contract's
 * own pattern: the client parses the whole list with `TripSummary`, and one
 * malformed value would fail every trip on Home, not just the one. Anything
 * else — including a document from before days carried dates, with no `date`
 * key — reads as null, "end unknown", the same as an undated trip.
 */
const LAST_DAY_DATE = sql`${tripDetails.doc} -> 'days' -> -1 ->> 'date'`;
/**
 * `dayCount` and `stopCount` (M37) come from the same document on the same
 * terms: no column, no second projector, no query of their own. A stop is an
 * activity on a day; the backlog is not on the plan, so it is not counted
 * (`TripSummary.stopCount`).
 *
 * A strict jsonpath, run silent, rather than `jsonb_array_length(doc -> 'days')`:
 * that raises on a `days` or `activityIds` that is not an array, and one bad
 * row would fail every trip on Home, as `endDate`'s shape check says. Silent,
 * a key that is missing or the wrong shape counts as nothing. Strict, not lax,
 * because lax mode wraps a non-array and would count an object as one day.
 * The `COALESCE` is the missing-document case of the LEFT JOIN.
 */
const countOf = (path: string) =>
  sql<number>`COALESCE(jsonb_array_length(jsonb_path_query_array(${tripDetails.doc}, ${path}::jsonpath, '{}', true)), 0)`;
const LISTED_SUMMARY = {
  ...getTableColumns(tripSummaries),
  endDate: sql<string | null>`CASE WHEN ${LAST_DAY_DATE} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${LAST_DAY_DATE} END`,
  dayCount: countOf("strict $.days[*]"),
  stopCount: countOf("strict $.days[*].activityIds[*]"),
  // The cover (M37 D1) is not planning state, so it is not on the projection:
  // it is its own CRUD table, LEFT JOINed here so the grid reads every card's
  // cover in the statement that reads the cards.
  cover: TRIP_COVER_JSON,
};

export async function listTripSummaries() {
  return db.select().from(tripSummaries).where(eq(tripSummaries.status, "active"));
}

/**
 * The home grid's query: active trips this user can see, narrowed in SQL.
 *
 * Visibility has two independent sources and the query has to cover both, or
 * it silently loses trips. The projection's own member list is the log talking
 * — `TripCreated` mints the creator as the sole `owner`, and it is the ONLY
 * record for every trip made before `trip_memberships` existed. The membership
 * table is the Access module talking: one row per accepted invite, which is
 * what makes a shared trip appear in the grid indistinguishable from your own
 * (M11 exit gate, SPEC R4). An inner join over memberships would answer the
 * second and drop the first entirely, so this is `OR` over a containment test
 * and an EXISTS.
 *
 * In SQL rather than a `.filter()` over `listTripSummaries()` because the old
 * shape loaded every trip on the instance and cost grew with total users, not
 * with the caller's trips — and because a predicate a caller can accidentally
 * delete is one edit away from a cross-tenant dump (project review L3, PR #71
 * review §6). The Access half comes from `hasMembershipRow` rather than being
 * rewritten here: Planning does not own `trip_memberships` and does not decide
 * who is invited (AGENTS.md module map).
 *
 * `members @> '[{"userId": ...}]'` is role-agnostic containment, so it keeps
 * matching if a planning event ever mints a non-owner — the JS predicate it
 * replaces (`members.some((m) => m.userId === userId)`) was role-agnostic too.
 */
/**
 * **One keyset page of the trips this user can see** (M22 Phase 2).
 *
 * The same visibility predicate as `listTripSummariesVisibleTo` — deliberately
 * the same expression rather than a second copy, because a predicate that can
 * drift is one edit away from a cross-tenant dump (project review L3).
 *
 * **Keyset, not offset.** The cursor is `createdAt|tripId` and the comparison is
 * a Postgres row comparison, so a trip created while someone is paging cannot
 * shift a later page and duplicate or skip a row. `tripId` is in the key because
 * `created_at` alone ties: two trips created in the same millisecond would make
 * the order non-deterministic, and a non-deterministic order is a pager that
 * silently loses rows.
 */
export async function listTripSummariesPage(
  userId: string,
  page: { limit: number; after: string | null },
) {
  const visible = and(
    eq(tripSummaries.status, "active"),
    or(
      sql`${tripSummaries.members} @> ${JSON.stringify([{ userId }])}::jsonb`,
      hasMembershipRow(tripSummaries.tripId, userId),
    ),
  );
  // A cursor we did not mint is treated as no cursor rather than as an error:
  // it can only cost the caller a first page, and 400-ing on an opaque string
  // we asked them not to interpret would be punishing them for obeying.
  //
  // **That promise was only kept for the SHAPE of the cursor, not its
  // contents.** `?cursor=invalid|invalid` split into two non-empty halves and
  // went straight into the casts below, where Postgres raised `22007` on the
  // timestamp — so the one input this comment says costs a first page cost a
  // 500 instead. Both halves are checked against what the casts will accept.
  const [createdAt, tripId] = (page.after ?? "").split("|");
  const minted =
    createdAt !== undefined &&
    tripId !== undefined &&
    isUuid(tripId) &&
    !Number.isNaN(Date.parse(createdAt));
  const seek = minted
    ? sql`(${tripSummaries.createdAt}, ${tripSummaries.tripId}) < (${createdAt}::timestamptz, ${tripId}::uuid)`
    : undefined;
  return db
    .select(LISTED_SUMMARY)
    .from(tripSummaries)
    .leftJoin(tripDetails, eq(tripDetails.tripId, tripSummaries.tripId))
    .leftJoin(tripCovers, eq(tripCovers.tripId, tripSummaries.tripId))
    .where(seek === undefined ? visible : and(visible, seek))
    .orderBy(desc(tripSummaries.createdAt), desc(tripSummaries.tripId))
    .limit(page.limit);
}

/**
 * Every trip this user can see, **newest-created first** (KI-034).
 *
 * The order is `listTripSummariesPage`'s, and it is stated because it used to
 * be absent: with no `ORDER BY` the rows came back in heap order, which an
 * `UPDATE` reshuffles, and Home made the head of that list its "Next trip".
 * Home now picks the hero by `startDate` and `endDate` itself
 * (`lib/homeTripOrder.ts`) — "under way" and "upcoming" depend on the
 * reader's own calendar day, which the server does not know — and uses this
 * order as its tie-break, so it has to be one.
 */
export async function listTripSummariesVisibleTo(userId: string) {
  return db
    .select(LISTED_SUMMARY)
    .from(tripSummaries)
    .leftJoin(tripDetails, eq(tripDetails.tripId, tripSummaries.tripId))
    .leftJoin(tripCovers, eq(tripCovers.tripId, tripSummaries.tripId))
    .where(
      and(
        eq(tripSummaries.status, "active"),
        or(
          sql`${tripSummaries.members} @> ${JSON.stringify([{ userId }])}::jsonb`,
          hasMembershipRow(tripSummaries.tripId, userId),
        ),
      ),
    )
    .orderBy(desc(tripSummaries.createdAt), desc(tripSummaries.tripId));
}
