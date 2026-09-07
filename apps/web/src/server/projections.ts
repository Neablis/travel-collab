import { TripDetail, TripEvent, type EventEnvelope } from "@tc/contracts";
import { projectTripDetails, projectTripSummaries } from "@tc/domain";
import { and, eq, or, sql } from "drizzle-orm";
import { hasMembershipRow } from "./access/members";
import { serverConflictContext } from "./conflictContext";
import { db, type Db } from "./db/client";
import { tripDetails, tripSummaries } from "./db/schema";
import { readAll } from "./eventStore";
import { isUuid } from "./ids";

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

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
        });
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
  });
}

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
export async function listTripSummariesVisibleTo(userId: string) {
  return db
    .select()
    .from(tripSummaries)
    .where(
      and(
        eq(tripSummaries.status, "active"),
        or(
          sql`${tripSummaries.members} @> ${JSON.stringify([{ userId }])}::jsonb`,
          hasMembershipRow(tripSummaries.tripId, userId),
        ),
      ),
    );
}
