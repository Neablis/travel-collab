import { z } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { auth } from "@/server/auth";
import { executeTripCommandBatch } from "@/server/commands";

const STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
};

const BatchRequest = z.object({ commands: z.array(BatchableCommand).min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = BatchRequest.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "malformed batch" }, { status: 400 });
  }
  if (!body.data.commands.every((c) => c.tripId === tripId)) {
    return Response.json({ error: "a command tripId does not match the URL" }, { status: 400 });
  }
  const result = await executeTripCommandBatch(body.data.commands, session.user.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
}
