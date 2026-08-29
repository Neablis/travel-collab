import { TripAccess } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { effectiveMembers, removeMember, withProfiles } from "@/server/access/members";
import { listInvites } from "@/server/access/invites";
import { getTripDetail } from "@/server/projections";
import { db } from "@/server/db/client";

/**
 * Take a person off a trip (KI-65). Owner-only; the policy itself lives in
 * `removeMember` so it is decided in one place rather than per route.
 *
 * The response is the same `TripAccess` shape `GET .../access` returns, not a
 * bare `{ ok: true }`: the caller's next question is always "so who is on it
 * now", and answering it here means the Travelers panel — when it is designed
 * (SPEC §8) — re-renders from the mutation instead of chasing it with a read.
 * It also means this endpoint introduced no new contract type, so nothing in
 * `packages/contracts` moved for it (AGENTS.md invariant 5).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; userId: string }> },
) {
  const { tripId, userId } = await params;
  const access = await requireTripAccess(tripId, "owner");
  if ("error" in access) return access.error;

  // The PLANNING LOG's member list, not `access.detail.members` — that one is
  // the effective (merged) list, and `removeMember`'s rule 2 is about who the
  // trip's owner *is*, not about who currently ranks as one. A granted
  // membership row carrying `role: "owner"` is a stray row, and a stray row is
  // what this endpoint is for (CodeRabbit, PR #85).
  const projected = await getTripDetail(tripId);
  if (projected === null) {
    // The trip was deleted between the access check and here. Nothing to do,
    // and nothing to report about a trip that no longer exists.
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const outcome = await removeMember(tripId, userId, projected.members);
  if (outcome === "owner") {
    // 409, not 403: the caller IS allowed to manage this trip's members — this
    // particular member is the one that cannot be expressed as a membership
    // row at all (it comes from the planning log). A 403 would read as "you
    // are not allowed", which would send an owner looking for a permission
    // they can grant themselves.
    return Response.json({ error: "The trip's owner cannot be removed." }, { status: 409 });
  }
  if (outcome === "not-a-member") {
    // Deliberately NOT idempotent-200, where the sibling invite revoke is.
    // Revoking an invite twice still has a row to report back; removing a
    // member who was never here has nothing to describe, and reporting success
    // for it would make a typo'd user id look like a completed removal —
    // exactly the false confidence that lets a stray row survive.
    return Response.json({ error: "That person is not a member of this trip." }, { status: 404 });
  }

  // Re-derived AFTER the delete, from the projected list plus what the grants
  // now say. `access.detail.members` is the pre-removal snapshot and would
  // report the person still on the trip they were just taken off; filtering
  // them out of it by hand would be wrong in the one case that is subtle — an
  // owner who ALSO held a stray granted row, whose row is gone but who is
  // still, per the log, the owner.
  const members = await effectiveMembers(db, tripId, projected.members);
  return Response.json({
    access: TripAccess.parse({
      tripId,
      myRole: access.role,
      members: await withProfiles(members),
      invites: await listInvites(tripId),
    }),
  });
}
