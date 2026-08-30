import { TripDetail, type TripRole } from "@tc/contracts";
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
 *
 * `safeParse`, not `parse`: every other failure here is a returned
 * `{ error: Response }`, and a caller that writes `if ("error" in access)
 * return access.error` is entitled to assume that covers every way this can
 * fail. A doc malformed in a way the `.default()`s cannot repair is exactly
 * the legacy-row case this parse exists for, so throwing out of the seam
 * would reintroduce the unhandled 500 — with no logged context — for the one
 * input it was added to handle.
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
  const parsed = TripDetail.safeParse({ ...projected, members });
  if (!parsed.success) {
    // 500, not 4xx: the request is well-formed and the actor is authorized —
    // what is broken is a row this server wrote, and no caller can retry their
    // way out of it. The issues are logged because the response deliberately
    // does not carry them: the shape of a stored document is not something an
    // API client gets to read, and the trip id is what makes the row findable.
    console.error("trip_details doc failed TripDetail parse", {
      tripId,
      issues: parsed.error.issues,
    });
    return { error: Response.json({ error: "malformed-trip" }, { status: 500 }) };
  }
  return { userId, role: memberRole(userId, members)!, detail: parsed.data };
}

/**
 * The same member overlay, for a detail the caller already holds.
 *
 * PARSED on the way out, for the reason `requireTripAccess` above is (KI-74).
 * The parameter type is not the guarantee it looks like: `getTripDetail` hands
 * back the stored `trip_details.doc` typed `TripDetail` and parsed by nothing,
 * so "the caller already holds a `TripDetail`" is exactly the claim that was
 * false for eight milestones and produced the "500 loading any trip". Spreading
 * such a doc and returning it under this signature would hand the lie on
 * intact — the contract's `.default()`s (`kind`, `tags`, `forkedFrom`) only
 * exist inside a parse.
 *
 * `parse`, not `requireTripAccess`'s `safeParse`, because this function has no
 * error channel: its result type is a bare `TripDetail`, so there is no
 * `{ error: Response }` a caller could be entitled to assume covers a malformed
 * row. Throwing is the only way it can decline to return one, and a silent
 * mis-typed object is what this entry exists to stop. A caller that needs the
 * softer failure should route through `requireTripAccess`, which has the
 * channel for it.
 */
export async function withEffectiveMembers(detail: TripDetail): Promise<TripDetail> {
  const members = await effectiveMembers(db, detail.tripId, detail.members);
  return TripDetail.parse({ ...detail, members });
}
