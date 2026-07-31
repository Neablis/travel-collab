import { TripEvent, type EventEnvelope, type TripDetail } from "@tc/contracts";
import { projectTripDetails, projectTripSummaries } from "@tc/domain";
import { eq } from "drizzle-orm";
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
