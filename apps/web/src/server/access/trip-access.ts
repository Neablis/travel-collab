import { TripDetail, type TripRole } from "@tc/contracts";
import { auth } from "../auth";
import { hasAtLeast, memberRole } from "../accessPolicy";
import { db } from "../db/client";
import { getTripDetail } from "../projections";
import { effectiveMembers } from "./members";

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
 *
 * It is also PARSED here, not cast. `getTripDetail` hands back the stored
 * `trip_details.doc` raw, and a doc is only rewritten when its trip next
 * changes — so every document written before a field existed is missing that
 * key entirely, and the contract's `.default()`s (`kind`, `tags`,
 * `forkedFrom`) only apply when something actually parses. Typing the raw doc
 * as `TripDetail` made that a silent lie every consumer inherited: the trip
 * GET route hit it as Mitchell's "500 loading any trip", and `POST
 * /api/saved-days` hit it again by handing the same doc to `stopsForDay`,
 * which copied `undefined` into a required `SavedStop.kind` and threw at the
 * response boundary AFTER the library row had already been inserted (PR #71
 * review §2). Parsing at the seam makes the type true once, for every caller.
 */
export type TripAccessResult =
  | { error: Response }
  | { userId: string; role: TripRole; detail: TripDetail };

export async function requireTripAccess(
  tripId: string,
  minimum: TripRole,
): Promise<TripAccessResult> {
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
  const detail = TripDetail.parse({ ...projected, members });
  return { userId, role: memberRole(userId, members)!, detail };
}

/** The same member overlay, for a detail the caller already holds. */
export async function withEffectiveMembers(detail: TripDetail): Promise<TripDetail> {
  return { ...detail, members: await effectiveMembers(db, detail.tripId, detail.members) };
}
