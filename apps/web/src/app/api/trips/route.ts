import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/server/auth";
import { handleCreateTrip } from "@/server/commands";
import { listTripSummaries } from "@/server/projections";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const rows = await listTripSummaries();
  const trips = rows.filter((r) => r.members.some((m) => m.userId === userId));
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
  const result = await handleCreateTrip(
    { tripId: randomUUID(), name: body.data.name },
    session.user.id,
  );
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
