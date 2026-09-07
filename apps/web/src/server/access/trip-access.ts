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
 * The result is PARSED here, and the parse now guards the OVERLAY rather than
 * the stored doc. It was added (KI-74) because `getTripDetail` returned
 * `trip_details.doc` raw: a doc is only rewritten when its trip next changes,
 * so every document written before a field existed is missing that key
 * entirely, and the contract's `.default()`s (`kind`, `tags`, `forkedFrom`)
 * only apply when something actually parses. Typing the raw doc as
 * `TripDetail` made that a silent lie every consumer inherited: the trip GET
 * route hit it as Mitchell's "500 loading any trip", and `POST
 * /api/saved-days` hit it again by handing the same doc to `stopsForDay`,
 * which copied `undefined` into a required `SavedStop.kind` and threw at the
 * response boundary AFTER the library row had already been inserted (PR #71
 * review §2).
 *
 * `getTripDetail` parses at the source as of KI-2026-09-05-r, so `projected`
 * arrives valid and this is no longer what makes the legacy row safe. It is
 * NOT redundant: `members` here is not the doc's own list but
 * `effectiveMembers`, whose granted half is built in `members.ts` as
 * `{ userId: r.userId, role: r.role as TripRole }` from a `text` column — the
 * one unchecked value in the object being returned. A `trip_memberships` row
 * carrying a role no `TripRole` names (a bad migration, a hand-written row)
 * reaches the read boundary through here and nowhere else.
 *
 * `safeParse`, not `parse`: every other failure here is a returned
 * `{ error: Response }`, and a caller that writes `if ("error" in access)
 * return access.error` is entitled to assume that covers every way this can
 * fail — so a stray membership row is answered with a logged 500 rather than
 * an unhandled throw. (`getTripDetail`'s own failure DOES throw, deliberately:
 * it has no error channel, and it logs the `tripId` and issues before it does.)
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

/**
 * Options for {@link requireTripAccess}.
 *
 * `allowDemo` is OPT-IN, and that is the whole point (KI-2026-09-05-d).
 *
 * The demo answer used to be a property of this seam, so every caller asking
 * for `viewer` inherited an anonymous, session-less actor whether or not it
 * wanted one. ADR-031 intended FOUR anonymous READS and says so — "the only
 * database work in the whole demo is the clone" (ADR-031:186) — but the seam
 * is generic, and two write paths inherited it: `POST /api/saved-days`
 * returned 201 to a caller with no cookie at all, inserting an unbounded
 * number of `saved_days` rows owned by `demo-visitor` that no user can ever
 * list or delete, and the pages route seeded default rows for the same
 * anonymous caller.
 *
 * The tell that the generic answer was wrong: `handleAskRequest.ts` had to
 * hand-write its own demo refusal (KI-79) — one call site patching a default
 * the rest of the codebase silently accepted.
 *
 * So a route now ASKS for the demo rather than being handed it. A new route
 * that forgets is refused, which is the safe direction to forget in.
 */
export type TripAccessOptions = {
  /** Serve the built-in demo trip to an anonymous visitor. Reads only. */
  allowDemo?: boolean;
};

export async function requireTripAccess(
  tripId: string,
  minimum: TripRole,
  { allowDemo = false }: TripAccessOptions = {},
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
  if (allowDemo && isDemoTripId(tripId)) {
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
 * The parameter type is not the guarantee it looks like. It was `getTripDetail`
 * that made it a lie — the stored `trip_details.doc` typed `TripDetail` and
 * parsed by nothing, for eight milestones, which is what produced the "500
 * loading any trip"; that source now parses (KI-2026-09-05-r). The signature is
 * still only a claim, though: a `TripDetail` is whatever the compiler was told
 * one is, and the overlay this function performs adds `effectiveMembers`, whose
 * granted roles come off a `text` column through an unchecked cast. Spreading
 * and returning under this signature without a parse would hand both on intact.
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
