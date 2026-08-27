import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/server/auth";
import { executeTripCommand } from "@/server/commands";
import { effectiveMembers, sharedTripIds } from "@/server/access/members";
import { db } from "@/server/db/client";
import { listTripSummaries } from "@/server/projections";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const [rows, shared] = await Promise.all([listTripSummaries(), sharedTripIds(userId)]);
  // M11 exit gate: "Trips shared with me appear in the Home grid" — SPEC R4
  // deleted the "1 shared with you" label as duplicated information, so they
  // simply appear, in the same grid, indistinguishable except by the avatars.
  const sharedWithMe = new Set(shared);
  const mine = rows.filter((r) => r.members.some((m) => m.userId === userId) || sharedWithMe.has(r.tripId));
  // The avatar stack on a card counts travellers, so each summary carries the
  // effective member list rather than the projection's owner-only one. The
  // stored projection is untouched (invariant 2) — this is a read overlay.
  const trips = await Promise.all(
    mine.map(async (r) => ({ ...r, members: await effectiveMembers(db, r.tripId, r.members) })),
  );
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
