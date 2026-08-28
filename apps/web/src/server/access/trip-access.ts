import type { TripDetail, TripRole } from "@tc/contracts";
import { auth } from "../auth";
import { hasAtLeast, memberRole } from "../accessPolicy";
import { db } from "../db/client";
import { getTripDetail } from "../projections";
import { effectiveMembers } from "./members";
import { demoTripDetail } from "../demoTrip";
import { isDemoTripId } from "@/lib/demoTrip";

/**
 * "May this session read/act on this trip, and what is the trip?" — the single
 * seam every read route goes through, so no route re-hand-rolls
 * `detail.members.some(...)` and quietly forgets the role again.
 *
 * The returned `detail` carries the EFFECTIVE member list (log owner + granted
 * memberships), not the raw projection. The projection itself is untouched:
 * `trip_details` still stores exactly what the log produces, so the
 * rebuild-equals-stored golden test is unaffected (AGENTS.md invariant 2). The
 * overlay lives at the read boundary, which is the only place a person's
 * membership is a fact about the answer rather than a fact about the plan.
 */
/**
 * The only `minimum` the demo trip can satisfy. Written as a named constant
 * compared against, rather than `minimum !== "viewer"`, so the line reads as
 * the rule it is: a demo read is a viewer read, and anything asking for more
 * is a write in disguise.
 */
const RANK_VIEWER_IS_ENOUGH: TripRole = "viewer";

/**
 * Who the demo's reader is, as far as the access seam is concerned. Not a real
 * account and never authenticated as one — it exists because `TripAccessResult`
 * names a `userId`, and every consumer of the demo's result uses it only to
 * compute a role that is already decided.
 */
const DEMO_VISITOR_ID = "demo-visitor";

export type TripAccessResult =
  | { error: Response }
  | { userId: string; role: TripRole; detail: TripDetail };

export async function requireTripAccess(
  tripId: string,
  minimum: TripRole,
): Promise<TripAccessResult> {
  // The built-in demo trip (ADR-031), answered here and nowhere else.
  //
  // This is the one seam every trip read passes through, which is exactly why
  // the demo is answered at it: `GET /api/trips/:id`, `/history`, `/access` and
  // `/history/:seq` all become public reads of a trip that is folded in memory,
  // without one of those four routes gaining a branch or losing a check.
  //
  // Before `auth()`, because the whole point is a visitor with no session; and
  // as a **viewer**, which is what makes the demo read-only by the same rule
  // that makes an invited viewer read-only. `MINIMUM_ROLE` in accessPolicy.ts
  // has no `viewer` entry — a viewer executes no planning command at all — so
  // every write route asks for `editor` or `owner` here and is refused, and the
  // refusal is the product's own permission rule rather than a special case
  // somebody has to remember to write on each new endpoint.
  if (isDemoTripId(tripId)) {
    if (RANK_VIEWER_IS_ENOUGH !== minimum) {
      return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
    }
    const detail = demoTripDetail();
    return { userId: DEMO_VISITOR_ID, role: "viewer", detail };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const userId = session.user.id;
  const projected = await getTripDetail(tripId);
  if (projected === null) {
    return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  }
  const members = await effectiveMembers(db, tripId, projected.members);
  if (!hasAtLeast(userId, members, minimum)) {
    // 403 for a member without the rank AND for a stranger: telling a stranger
    // apart from an under-privileged member would confirm the trip exists.
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { userId, role: memberRole(userId, members)!, detail: { ...projected, members } };
}

/** The same member overlay, for a detail the caller already holds. */
export async function withEffectiveMembers(detail: TripDetail): Promise<TripDetail> {
  return { ...detail, members: await effectiveMembers(db, detail.tripId, detail.members) };
}
