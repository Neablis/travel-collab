import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Guest } from "@tc/contracts";
import { mayLinkGuest, mayManageGuests, mayUnlinkGuest } from "../accessPolicy";
import { db, type Queryable } from "../db/client";
import { tripGuests } from "../db/schema";
import { getTripDetail } from "../projections";
import { isGuestId, isUuid } from "../ids";
import type { AccessResult } from "./invites";
import { bumpAccessRev, effectiveMembers } from "./members";

// Named travellers with no account (guests spec P1): "Baby", "Grandma".
// Access CRUD, not events (extends ADR-065 D1): a guest is who is coming, and
// every write bumps the access revision in its own transaction so the poll
// recosts everyone else's board (D11).

const NO_TRIP = { ok: false, error: { code: "not-found", message: "This trip does not exist." } } as const;
const NO_GUEST = { ok: false, error: { code: "not-found", message: "That guest is not on this trip." } } as const;

const MAX_NAME = 120;

type GuestRow = typeof tripGuests.$inferSelect;

/** A `trip_guests` row as the `Guest` DTO. */
function toGuest(row: GuestRow): Guest {
  return {
    guestId: row.guestId,
    tripId: row.tripId,
    name: row.name,
    travelling: row.travelling,
    linkedUserId: row.linkedUserId,
    createdBy: row.createdBy,
    // One shape on the wire (KI-53): `mode: "date"` above, ISO here.
    createdAt: row.createdAt.toISOString(),
  };
}

/** A name is valid when something remains after trimming (guests spec P1). */
function validName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_NAME;
}

/** The trip's guests, as DTOs, in the order they were added. */
export async function listGuests(tripId: string): Promise<Guest[]> {
  if (!isUuid(tripId)) return [];
  const rows = await db
    .select()
    .from(tripGuests)
    .where(eq(tripGuests.tripId, tripId))
    .orderBy(tripGuests.createdAt, tripGuests.guestId);
  return rows.map(toGuest);
}

async function readGuest(tx: Queryable, tripId: string, guestId: string): Promise<GuestRow | undefined> {
  if (!isGuestId(guestId)) return undefined;
  const rows = await tx
    .select()
    .from(tripGuests)
    .where(and(eq(tripGuests.tripId, tripId), eq(tripGuests.guestId, guestId)));
  return rows[0];
}

/**
 * Name a guest on a trip (guests spec P1). The name is trimmed; empty or over
 * 120 chars is `invalid`, not a silent store. Owner or editor — "anyone with
 * edit" (Mitchell), so the policy is `mayManageGuests` rather than the route's
 * role gate, which a later internal caller would not pass through. The id is
 * minted as `guest_<uuid>` (Mitchell): the prefix keeps the guest namespace
 * disjoint from `users.id` wherever the id drops into person-keyed fields
 * later (participants picks, the cost overlay).
 */
export async function addGuest(
  tripId: string,
  name: string,
  actorId: string,
): Promise<AccessResult<Guest>> {
  if (!validName(name)) {
    return { ok: false, error: { code: "invalid", message: "A guest needs a name (1-120 characters)." } };
  }
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<Guest>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!mayManageGuests(actorId, members)) {
      return { ok: false, error: { code: "forbidden", message: "Only the trip's owner or an editor can manage guests." } };
    }
    const [row] = await tx
      .insert(tripGuests)
      .values({ tripId, guestId: `guest_${randomUUID()}`, name: name.trim(), createdBy: actorId, createdAt: new Date() })
      .returning();
    await bumpAccessRev(tx, tripId);
    return { ok: true, value: toGuest(row!) };
  });
}

/**
 * Rename a guest or change whether they are travelling (guests spec P1).
 * Owner or editor. A guest the id does not name is `not-found`, whatever its
 * shape — a malformed id and an unknown one are the same fact to the holder.
 */
export async function updateGuest(
  tripId: string,
  guestId: string,
  patch: { name?: string; travelling?: boolean },
  actorId: string,
): Promise<AccessResult<Guest>> {
  if (patch.name !== undefined && !validName(patch.name)) {
    return { ok: false, error: { code: "invalid", message: "A guest needs a name (1-120 characters)." } };
  }
  // An empty patch moves nothing: refuse before the transaction, the way the
  // route's `UpdateGuestInput` refine does, so a save handler that does not
  // diff cannot bump `accessRev` for a no-op.
  if (patch.name === undefined && patch.travelling === undefined) {
    return { ok: false, error: { code: "invalid", message: "Nothing to update." } };
  }
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<Guest>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!mayManageGuests(actorId, members)) {
      return { ok: false, error: { code: "forbidden", message: "Only the trip's owner or an editor can manage guests." } };
    }
    const row = await readGuest(tx, tripId, guestId);
    if (row === undefined) return NO_GUEST;
    const [updated] = await tx
      .update(tripGuests)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        ...(patch.travelling === undefined ? {} : { travelling: patch.travelling }),
        updatedAt: new Date(),
      })
      .where(and(eq(tripGuests.tripId, tripId), eq(tripGuests.guestId, row.guestId)))
      .returning();
    await bumpAccessRev(tx, tripId);
    return { ok: true, value: toGuest(updated!) };
  });
}

/**
 * Remove a guest (guests spec P1). Owner or editor. Returns the removed guest
 * — the public API's DELETE answers it, the way the trip delete and the
 * share/invite revokes do. Deletes the row only: historical `participants`
 * picks referencing the guest id stay, the way a departed member's picks do —
 * rewriting planning state from an Access change is the boundary smell
 * ADR-065 D6 names.
 */
export async function removeGuest(
  tripId: string,
  guestId: string,
  actorId: string,
): Promise<AccessResult<Guest>> {
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<Guest>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!mayManageGuests(actorId, members)) {
      return { ok: false, error: { code: "forbidden", message: "Only the trip's owner or an editor can manage guests." } };
    }
    const row = await readGuest(tx, tripId, guestId);
    if (row === undefined) return NO_GUEST;
    await tx.delete(tripGuests).where(and(eq(tripGuests.tripId, tripId), eq(tripGuests.guestId, row.guestId)));
    await bumpAccessRev(tx, tripId);
    return { ok: true, value: toGuest(row) };
  });
}

/**
 * Claim a guest record for a member (guests spec P1): the owner for anyone, a
 * member for themselves only — the "X signs up and claims their guest record"
 * flow. The target must be on the trip NOW, read inside the transaction, for
 * `setTravelling`'s reason (a remove racing this still lets the row land, and
 * is harmless for the same reason). A guest already linked to someone else is
 * refused — the owner unlinks first, never a silent overwrite. Re-linking the
 * same person is a no-op success that moves no revision.
 */
export async function linkGuest(
  tripId: string,
  guestId: string,
  userId: string,
  actorId: string,
): Promise<AccessResult<Guest>> {
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<Guest>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!mayLinkGuest(actorId, userId, members)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "Only the trip's owner can link a guest for someone else." },
      };
    }
    if (members.every((m) => m.userId !== userId)) {
      return { ok: false, error: { code: "not-found", message: "That person is not on this trip." } };
    }
    const row = await readGuest(tx, tripId, guestId);
    if (row === undefined) return NO_GUEST;
    if (row.linkedUserId !== null && row.linkedUserId !== userId) {
      return {
        ok: false,
        error: { code: "invalid", message: "That guest is already linked to someone else. Unlink it first." },
      };
    }
    if (row.linkedUserId === userId) return { ok: true, value: toGuest(row) };
    const [updated] = await tx
      .update(tripGuests)
      .set({ linkedUserId: userId, updatedAt: new Date() })
      .where(and(eq(tripGuests.tripId, tripId), eq(tripGuests.guestId, row.guestId)))
      .returning();
    await bumpAccessRev(tx, tripId);
    return { ok: true, value: toGuest(updated!) };
  });
}

/**
 * Unclaim a guest record (guests spec P1): owner only. Clearing someone
 * else's claim is taking an identity away — a membership operation, not
 * content — so the self-claim side of `mayLinkGuest` has no counterpart here.
 * Unlinking a guest nobody claimed is a no-op success that moves no revision.
 */
export async function unlinkGuest(
  tripId: string,
  guestId: string,
  actorId: string,
): Promise<AccessResult<Guest>> {
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<Guest>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!mayUnlinkGuest(actorId, members)) {
      return { ok: false, error: { code: "forbidden", message: "Only the trip's owner can unlink a guest." } };
    }
    const row = await readGuest(tx, tripId, guestId);
    if (row === undefined) return NO_GUEST;
    if (row.linkedUserId === null) return { ok: true, value: toGuest(row) };
    const [updated] = await tx
      .update(tripGuests)
      .set({ linkedUserId: null, updatedAt: new Date() })
      .where(and(eq(tripGuests.tripId, tripId), eq(tripGuests.guestId, row.guestId)))
      .returning();
    await bumpAccessRev(tx, tripId);
    return { ok: true, value: toGuest(updated!) };
  });
}
