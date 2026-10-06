import { z } from "zod";
import { BatchableCommand, TripCommandUnit } from "@tc/contracts";
import { auth } from "@/server/auth";
import { executeTripCommandBatch } from "@/server/commands";
import { readBody } from "@/server/readBody";

const STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
};

// Either plain `commands`, or `units` (ADR-066): queued units with the key the
// client minted for each, so a unit the server already applied is left out
// rather than applied twice. The page's unload flush sends `units`.
const BatchRequest = z.union([
  z.object({ commands: z.array(BatchableCommand).min(1) }),
  z.object({ units: z.array(TripCommandUnit).min(1) }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = await readBody(request, BatchRequest, "malformed batch");
  if ("error" in body) return body.error;
  const units = "units" in body.data ? body.data.units : undefined;
  const commands = "units" in body.data ? body.data.units.flatMap((u) => u.commands) : body.data.commands;
  if (!commands.every((c) => c.tripId === tripId)) {
    return Response.json({ error: "a command tripId does not match the URL" }, { status: 400 });
  }
  const result = await executeTripCommandBatch(commands, session.user.id, undefined, {
    units: units?.map((u) => ({ key: u.key, size: u.commands.length })),
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
}
