import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { SharedTripView, TripShare } from "@tc/contracts";
import { db } from "../db/client";
import { tripShares } from "../db/schema";
import { getTripDetailAtWithHead } from "../history";
import { getTripDetail } from "../projections";
import { readStream } from "../eventStore";
import { effectiveMembers } from "./members";
import type { AccessResult } from "./invites";

// Same shape and the same argument as an invite token (ADR-026): 32 bytes of
// CSPRNG entropy, unique-indexed, stored as issued so the person who created
// the link can re-copy it, revocable at any time.
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

type ShareRow = typeof tripShares.$inferSelect;

function toDto(row: ShareRow): TripShare {
  return {
    shareId: row.id,
    tripId: row.tripId,
    token: row.token,
    seq: row.seq,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Pin a share at the trip's CURRENT history point.
 *
 * The pin is the stream's length, read inside the same transaction that
 * inserts the row: anything less and a command landing between the read and
 * the write would produce a link pinned to a point the sharer never saw.
 *
 * A trip with no events cannot be shared — there is nothing to replay, and
 * `getTripDetailAt` requires `1 <= seq <= length`. That is unreachable in
 * practice (a trip exists only because `TripCreated` was appended) and is
 * refused explicitly rather than left to fail later at the read.
 */
export async function createShare(
  tripId: string,
  createdBy: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<TripShare>> {
  return db.transaction(async (tx): Promise<AccessResult<TripShare>> => {
    const envelopes = await readStream(tx, tripId);
    if (envelopes.length === 0) {
      return { ok: false, error: { code: "not-found", message: "This trip does not exist." } };
    }
    const row: ShareRow = {
      id: randomUUID(),
      tripId,
      token: mintToken(),
      seq: envelopes.length,
      createdBy,
      createdAt: now,
      revokedAt: null,
    };
    await tx.insert(tripShares).values(row);
    return { ok: true, value: toDto(row) };
  });
}

/** Newest first — the link just created is the one someone wants to copy. */
export async function listShares(tripId: string): Promise<TripShare[]> {
  const rows = await db.select().from(tripShares).where(eq(tripShares.tripId, tripId));
  return rows
    .map(toDto)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function revokeShare(
  tripId: string,
  shareId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<TripShare>> {
  const rows = await db
    .select()
    .from(tripShares)
    .where(and(eq(tripShares.id, shareId), eq(tripShares.tripId, tripId)));
  const row = rows[0];
  if (row === undefined) {
    return { ok: false, error: { code: "not-found", message: "This link does not exist." } };
  }
  // Idempotent: revoking an already-revoked link is a success, not a 404, so
  // a double-click cannot produce a scary error.
  if (row.revokedAt !== null) return { ok: true, value: toDto(row) };
  await db.update(tripShares).set({ revokedAt: now }).where(eq(tripShares.id, shareId));
  return { ok: true, value: toDto({ ...row, revokedAt: now }) };
}

/**
 * The public read. No session, by design — this is the one endpoint in the app
 * a stranger may call.
 *
 * It REPLAYS the log to the pinned seq (`getTripDetailAt`) and cannot use the
 * materialized `trip_details` projection: that projection is always the trip
 * as it is NOW, so serving it would make every share link track the live trip
 * and the feature would not exist. The cost is a stream read per view, which
 * is the same read the history preview has always done.
 */
export async function readShare(token: string): Promise<AccessResult<SharedTripView>> {
  const rows = await db.select().from(tripShares).where(eq(tripShares.token, token));
  const share = rows[0];
  if (share === undefined) {
    return { ok: false, error: { code: "not-found", message: "This link is not valid." } };
  }
  if (share.revokedAt !== null) {
    return { ok: false, error: { code: "gone", message: "This link has been turned off." } };
  }
  // A deleted trip's share is refused rather than served: the person who
  // deleted it has said it should not exist, and a link they handed out
  // earlier is not an exception to that.
  const current = await getTripDetail(share.tripId);
  if (current === null || current.status === "deleted") {
    return { ok: false, error: { code: "gone", message: "This trip is no longer available." } };
  }
  const replayed = await getTripDetailAtWithHead(share.tripId, share.seq);
  if (replayed === null) {
    return { ok: false, error: { code: "gone", message: "This trip is no longer available." } };
  }
  const members = await effectiveMembers(db, share.tripId, current.members);
  return {
    ok: true,
    value: toSharedView(replayed.detail, share, members.length, replayed.headSeq),
  };
}

/**
 * `TripDetail` → the public view, dropping `members`, `conflicts`,
 * `dismissedConflictIds` and `status`. Written as an explicit field list, not
 * a spread-and-delete: a new `TripDetail` field must be opted IN to the public
 * surface, never leak into it because someone added it upstream.
 */
export function toSharedView(
  at: Pick<
    SharedTripView,
    | "tripId"
    | "name"
    | "startDate"
    | "currency"
    | "budget"
    | "days"
    | "backlog"
    | "activities"
    | "unscheduledCostSubtotal"
    | "tripCostTotal"
  >,
  share: { seq: number; createdAt: string },
  travellerCount: number,
  currentSeq: number,
): SharedTripView {
  return {
    tripId: at.tripId,
    name: at.name,
    startDate: at.startDate,
    currency: at.currency,
    budget: at.budget,
    days: at.days,
    backlog: at.backlog,
    activities: at.activities,
    unscheduledCostSubtotal: at.unscheduledCostSubtotal,
    tripCostTotal: at.tripCostTotal,
    travellerCount,
    seq: share.seq,
    sharedAt: share.createdAt,
    stale: currentSeq > share.seq,
  };
}

/**
 * The landing page's "Look around a real trip" needs a trip to look around,
 * and M12 Community — a public gallery, discovery, and the trust & safety
 * surface that would decide which trip that is — is explicitly out of M11's
 * scope. So it is deployment configuration, not a product feature: one env
 * var naming one already-published share token.
 *
 * Deliberately NOT "fall back to the newest share on the instance": that
 * would publish some real user's private trip on the front page the moment
 * they clicked Share. Unset means unset — `/s/featured` says so, in a
 * designed empty state with a way onward, rather than dead-ending.
 */
export async function readFeaturedShare(): Promise<AccessResult<SharedTripView>> {
  const token = process.env.DEMO_SHARE_TOKEN?.trim();
  if (token === undefined || token === "") {
    return {
      ok: false,
      error: { code: "not-found", message: "No trip is published here yet." },
    };
  }
  return readShare(token);
}
