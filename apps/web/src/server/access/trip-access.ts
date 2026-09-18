import { z } from "zod";
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
  const outcome = await tripAccessFor(session.user.id, tripId, minimum);
  if (outcome.ok) return { userId: outcome.userId, role: outcome.role, detail: outcome.detail };
  return { error: DENIAL_RESPONSES[outcome.denial](tripId) };
}

/**
 * The BFF's wire shapes for a denial, unchanged from when they were inline.
 *
 * **Bare-string errors, deliberately preserved.** Every one of these is what a
 * `/api/*` route has answered since M1, and 46 call sites plus their tests
 * depend on it. `v1` does not share them — it has its own envelope, and the
 * whole reason `tripAccessFor` returns a *reason* rather than a `Response` is so
 * two surfaces can answer the same denial in two vocabularies without either
 * one re-deciding who may read a trip.
 */
const DENIAL_RESPONSES: Record<TripAccessDenial, (tripId: string) => Response> = {
  "not-found": () => Response.json({ error: "not-found" }, { status: 404 }),
  // 403 for a member without the rank AND for a stranger: telling a stranger
  // apart from an under-privileged member would confirm the trip exists.
  forbidden: () => Response.json({ error: "forbidden" }, { status: 403 }),
  // 500, not 4xx: the request is well-formed and the actor is authorized — what
  // is broken is a row this server wrote, and no caller can retry their way out
  // of it.
  "malformed-trip": () => Response.json({ error: "malformed-trip" }, { status: 500 }),
};

/** Why a trip was not served. A reason, deliberately not a `Response`. */
export type TripAccessDenial = "not-found" | "forbidden" | "malformed-trip";

export type TripAccessOutcome =
  | { ok: true; userId: string; role: TripRole; detail: TripDetail }
  | { ok: false; denial: TripAccessDenial };

/**
 * **The same authorization, for an actor who is already known** (M22 Phase 2).
 *
 * `requireTripAccess` above calls `auth()` itself, which is right for a route
 * serving a browser and useless to one serving a bearer token. This is the
 * sibling that takes the actor instead — and it is the *implementation*, with
 * `requireTripAccess` now a thin session-resolving wrapper over it, so there is
 * exactly one place that decides whether somebody may read a trip.
 *
 * **This is gate two, and it is unchanged.** A token's scopes are checked
 * before this is ever reached; what happens here is the same membership
 * question a session has always asked. That ordering is what makes a token
 * unable to grant more than its owner holds, and it is what makes a token
 * degrade automatically: remove someone's membership and every token they hold
 * loses that trip on the next request, because this query is the same query it
 * always was and no token state was ever copied from it.
 *
 * **No `allowDemo`.** The demo is an anonymous session-less browser read
 * (ADR-031); a bearer token is neither anonymous nor a browser, and a public
 * API that served the demo trip under someone's credential would be answering a
 * question nobody asked.
 */
export async function tripAccessFor(
  userId: string,
  tripId: string,
  minimum: TripRole,
): Promise<TripAccessOutcome> {
  // **`getTripDetail` THROWS on a stored doc it cannot parse**, so until this
  // catch existed the `malformed-trip` denial below could only ever fire for
  // the member overlay — the stored-document case it was written for escaped
  // the seam entirely. Past `route()` that matters twice over: the trip gate
  // runs BEFORE the handler try/catch, so the ZodError left the wrapper
  // without producing the `ApiError` envelope every v1 response promises, and
  // the caller got whatever Next.js renders for an unhandled throw.
  //
  // Only the parse failure is converted. A dropped connection or a `22P02` is
  // still an exception, because those are not "this trip is unreadable" —
  // they are "the database did not answer", and swallowing them here would
  // report a healthy trip as corrupt.
  let projected: TripDetail | null;
  try {
    projected = await getTripDetail(tripId);
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, denial: "malformed-trip" };
    throw error;
  }
  if (projected === null) return { ok: false, denial: "not-found" };
  const members = await effectiveMembers(db, tripId, projected.members);
  if (!hasAtLeast(userId, members, minimum)) return { ok: false, denial: "forbidden" };
  const parsed = TripDetail.safeParse({ ...projected, members });
  if (!parsed.success) {
    // The issues are logged because the response deliberately does not carry
    // them: the shape of a stored document is not something an API client gets
    // to read, and the trip id is what makes the row findable.
    console.error("trip_details doc failed TripDetail parse", {
      tripId,
      issues: parsed.error.issues,
    });
    return { ok: false, denial: "malformed-trip" };
  }
  return { ok: true, userId, role: memberRole(userId, members)!, detail: parsed.data };
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
