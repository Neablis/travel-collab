import type { InviteRole, TripMember } from "@tc/contracts";
import { hasAtLeast, maySetTravelling } from "../accessPolicy";
import { db } from "../db/client";
import { getTripDetail } from "../projections";
import type { AccessResult } from "./invites";
import { bumpAccessRev, changeMemberRole, effectiveMembers, writeTravelling } from "./members";

// The two in-place changes to a person on a trip (travellers spec D4, D8).
// Access CRUD, not events (D1): neither is in the trip's history, and each
// bumps the access revision in its own transaction so the poll recosts
// everyone else's board (D11).

const NO_TRIP = { ok: false, error: { code: "not-found", message: "This trip does not exist." } } as const;

/**
 * Say whether `userId` is travelling on this trip.
 *
 * Authorised against the EFFECTIVE member list, read inside the transaction
 * that writes: the target has to be on the trip now, not when the caller last
 * looked, or a row would be written for someone just removed. A refusal
 * writes nothing and moves no revision.
 */
export async function setTravelling(
  tripId: string,
  actorId: string,
  userId: string,
  travelling: boolean,
  now: string = new Date().toISOString(),
): Promise<AccessResult<TripMember>> {
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<TripMember>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!maySetTravelling(actorId, userId, members)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "Only the trip's owner can change this for someone else." },
      };
    }
    const target = members.find((m) => m.userId === userId);
    if (target === undefined) {
      return { ok: false, error: { code: "not-found", message: "That person is not on this trip." } };
    }
    await writeTravelling(tx, { tripId, userId, travelling, updatedBy: actorId, now });
    await bumpAccessRev(tx, tripId);
    return { ok: true, value: { ...target, travelling } };
  });
}

/**
 * Change a member's role in place (D8). The owner's operation only, and the
 * owner cannot be its target — `changeMemberRole` holds that rule and why.
 * `InviteRole`, so it can never grant `owner` (D9).
 *
 * The returned member carries the STORED role, uncapped: a lapsed owner
 * changing a role sees what resubscribing restores, and every read of the
 * member list caps it as before.
 */
export async function changeRole(
  tripId: string,
  actorId: string,
  userId: string,
  role: InviteRole,
): Promise<AccessResult<TripMember>> {
  const detail = await getTripDetail(tripId);
  if (detail === null || detail.status === "deleted") return NO_TRIP;
  return db.transaction(async (tx): Promise<AccessResult<TripMember>> => {
    const members = await effectiveMembers(tx, tripId, detail.members);
    if (!hasAtLeast(actorId, members, "owner")) {
      return { ok: false, error: { code: "forbidden", message: "Only the trip's owner can change roles." } };
    }
    const outcome = await changeMemberRole(tx, tripId, userId, role, detail.members);
    if (outcome === "owner") {
      return { ok: false, error: { code: "invalid", message: "The trip's owner cannot be given another role." } };
    }
    if (outcome === "not-a-member") {
      return { ok: false, error: { code: "not-found", message: "That person is not a member of this trip." } };
    }
    const target = members.find((m) => m.userId === userId);
    return { ok: true, value: { userId, role, travelling: target?.travelling ?? true } };
  });
}
