import { TripCommand } from "@tc/contracts";
import { auth } from "@/server/auth";
import { executeTripCommand } from "@/server/commands";
import { readBody } from "@/server/readBody";

const STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
  // An undo whose `undoesBatchId` is no longer on top (M27 D17): the request
  // was well-formed, the trip moved under it. Unlike `concurrency-conflict`,
  // retrying the same request cannot succeed.
  "undo-target-changed": 409,
};

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = await readBody(request, TripCommand, "malformed command");
  if ("error" in body) return body.error;
  if (body.data.type === "CreateTrip") {
    return Response.json({ error: "use POST /api/trips to create trips" }, { status: 400 });
  }
  if (body.data.tripId !== tripId) {
    return Response.json({ error: "command tripId does not match the URL" }, { status: 400 });
  }
  const result = await executeTripCommand(body.data, session.user.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
}
