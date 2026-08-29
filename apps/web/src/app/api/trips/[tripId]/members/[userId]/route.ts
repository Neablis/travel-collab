import { TripAccess } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { removeMember, withProfiles } from "@/server/access/members";
import { listInvites } from "@/server/access/invites";

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

  const outcome = await removeMember(tripId, userId, access.detail.members);
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

  // `access.detail.members` is the PRE-removal snapshot, so returning it would
  // report the person still on the trip they were just taken off. Filtered
  // rather than re-read: the delete removed exactly this user's granted row and
  // touched nothing else, and re-running `effectiveMembers` over this already
  // MERGED list would re-add them from the snapshot anyway (`mergeMembers`
  // unions its two arguments — it is not a way to subtract).
  const members = access.detail.members.filter((member) => member.userId !== userId);
  return Response.json({
    access: TripAccess.parse({
      tripId,
      myRole: access.role,
      members: await withProfiles(members),
      invites: await listInvites(tripId),
    }),
  });
}
