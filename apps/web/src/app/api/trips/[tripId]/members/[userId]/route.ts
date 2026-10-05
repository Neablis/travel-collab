import { z } from "zod";
import { ChangeRoleInput, SetTravellingInput, TripAccess, type TripMember, type TripRole } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { accessRevForRead, effectiveMembers, removeMember, withProfiles } from "@/server/access/members";
import { listInvites, type AccessError } from "@/server/access/invites";
import { changeRole, setTravelling } from "@/server/access/travellers";
import { getTripDetail } from "@/server/projections";
import { db } from "@/server/db/client";
import { accountCan } from "@/server/entitlements/resolver";

/**
 * Take a person off a trip (KI-65). Owner-only; the policy itself lives in
 * `removeMember` so it is decided in one place rather than per route.
 *
 * The response is the same `TripAccess` shape `GET .../access` returns, not a
 * bare `{ ok: true }`: the caller's next question is always "so who is on it
 * now", and answering it here means the People section (travellers spec §4)
 * re-renders from the mutation instead of chasing it with a read.
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

  return Response.json({ access: await accessView(tripId, access, projected.members) });
}

// Both strict, so a body naming both fields matches neither and is a 400.
const PatchBody = z.union([SetTravellingInput, ChangeRoleInput]);

// `invalid` is `changeRole`'s refusal of the owner as its target, answered 409
// for the reason DELETE gives above.
const REFUSAL_STATUS: Record<AccessError["code"], number> = {
  "not-found": 404,
  forbidden: 403,
  invalid: 409,
  gone: 410,
};

/**
 * Change one person in place (travellers spec D4, D8): `{ travelling }` or
 * `{ role }`, never both. Access CRUD, so no event and no history entry (D1).
 *
 * The seam is asked only for membership, because a member may set their own
 * travelling (D4). Who may do what beyond that is `setTravelling`'s and
 * `changeRole`'s to decide, each in the transaction that writes, so this route
 * holds no second copy of the rule.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tripId: string; userId: string }> },
) {
  const { tripId, userId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  const body = PatchBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-member-change" }, { status: 400 });

  const result =
    "travelling" in body.data
      ? await setTravelling(tripId, access.userId, userId, body.data.travelling)
      : await changeRole(tripId, access.userId, userId, body.data.role);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: REFUSAL_STATUS[result.error.code] },
    );
  }

  const projected = await getTripDetail(tripId);
  if (projected === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ access: await accessView(tripId, access, projected.members) });
}

/**
 * The `TripAccess` both mutations answer with, re-derived AFTER the write from
 * the planning log's member list plus what the grants now say.
 * `access.detail.members` is the pre-write snapshot: it would report a removed
 * person still on the trip, or a role or travelling value just changed. And
 * filtering it by hand would be wrong in the one subtle case — an owner who
 * also held a stray granted row, whose row is gone but who is still, per the
 * log, the owner.
 */
async function accessView(
  tripId: string,
  access: { userId: string; role: TripRole },
  projected: readonly TripMember[],
): Promise<TripAccess> {
  // Before the members and invites, as `GET /access` reads it. It is read after
  // this request's own write, so it includes that write, and never a later one
  // the list below misses (KI-2026-10-05-g, spec W22).
  const accessRev = await accessRevForRead(tripId);
  const members = await effectiveMembers(db, tripId, projected);
  // The same field `GET /access` serves, from the same source: the trip
  // OWNER's `trip.collaborators` (M20 link 6). Neither mutation changes it,
  // but the panel re-renders from this response — serving a stale or absent
  // value would flip the invite form back on for an unentitled owner until
  // the next read. `projected[0]` is the owner, per the planning log.
  const owner = projected[0]?.userId ?? null;
  return TripAccess.parse({
    tripId,
    myRole: access.role,
    members: await withProfiles(members, access.userId),
    // Owner only, as `GET /access` rules: each invite carries its token, and
    // PATCH answers a member setting their own travelling too.
    invites: access.role === "owner" ? await listInvites(tripId) : [],
    collaboratorsEntitled: owner === null ? true : await accountCan(owner, "trip.collaborators"),
    accessRev,
  });
}
