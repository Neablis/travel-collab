import { TripEvent, type EventEnvelope, type TripDetail } from "@tc/contracts";
import { projectTripDetails, projectTripSummaries } from "@tc/domain";
import { and, eq, or, sql } from "drizzle-orm";
import { hasMembershipRow } from "./access/members";
import { serverConflictContext } from "./conflictContext";
import { db, type Db } from "./db/client";
import { tripDetails, tripSummaries } from "./db/schema";
import { readAll } from "./eventStore";

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

export async function getTripDetail(tripId: string): Promise<TripDetail | null> {
  const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
  return rows[0]?.doc ?? null;
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
