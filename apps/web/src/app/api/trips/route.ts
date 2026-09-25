import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { executeTripCommand } from "@/server/commands";
import { grantedMembersByTrip, mergeMembers } from "@/server/access/members";
import { db } from "@/server/db/client";
import { listTripSummariesVisibleTo } from "@/server/projections";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  // M11 exit gate: "Trips shared with me appear in the Home grid" — SPEC R4
  // deleted the "1 shared with you" label as duplicated information, so they
  // simply appear, in the same grid, indistinguishable except by the avatars.
  // The query decides that, not this handler: it used to load every trip on
  // the instance and narrow them here, which cost the whole instance per
  // request and put the tenant boundary one deleted `.filter()` away from a
  // cross-tenant dump (project review L3, PR #71 review §6).
  const rows = await listTripSummariesVisibleTo(userId);
  // The avatar stack on a card counts travellers, so each summary carries the
  // effective member list rather than the projection's owner-only one. One
  // batched read for all of them — this was an `effectiveMembers` per trip.
  // The stored projection is untouched (invariant 2): this is a read overlay,
  // `mergeMembers` is pure, and nothing here writes back.
  const granted = await grantedMembersByTrip(db, rows.map((r) => r.tripId));
  const trips = rows.map((r) => ({
    ...r,
    members: mergeMembers(r.members, granted.get(r.tripId) ?? []),
  }));
  return Response.json({ trips });
}

// **The client may mint the id** (KI-2026-09-12-e). `CreateTrip` in
// `packages/contracts/src/trip.ts` has always carried `tripId`; what forbade a
// caller from supplying one was this route-local schema, and what minted it was
// `randomUUID()` below. Optional, so every existing caller is unaffected.
//
// Why it matters: if the command commits and the browser then loses the
// response, `createTrip` returns `ok: false` and a retry used to mint a SECOND
// trip. With the id supplied by the caller the retry is the same command, and
// `decideCreateTrip` answers `trip-already-exists` — which the client reads as
// "it landed" rather than as a failure.
//
// A uuid, not any string: the id reaches the database as a key, and accepting
// an arbitrary caller-supplied string here would be a wider door than the
// defect needs.
const CreateTripBody = z.object({
  name: z.string().min(1).max(200),
  tripId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = await readBody(request, CreateTripBody, "name is required (1-200 chars)");
  if ("error" in body) return body.error;
  const result = await executeTripCommand(
    { type: "CreateTrip", tripId: body.data.tripId ?? randomUUID(), name: body.data.name },
    session.user.id,
  );
  if (!result.ok) {
    // **`code` on the wire, the way `POST /api/trips/:id/commands` already does
    // it.** That asymmetry was the whole gap on the create half: the server has
    // always distinguished `trip-already-exists` from a real failure, and this
    // route threw the distinction away before the client could read it.
    return Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
