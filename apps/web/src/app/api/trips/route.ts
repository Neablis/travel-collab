import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/server/auth";
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

const CreateTripBody = z.object({ name: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = CreateTripBody.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "name is required (1-200 chars)" }, { status: 400 });
  }
  const result = await executeTripCommand(
    { type: "CreateTrip", tripId: randomUUID(), name: body.data.name },
    session.user.id,
  );
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
