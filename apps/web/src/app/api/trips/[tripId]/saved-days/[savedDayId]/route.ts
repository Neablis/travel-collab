import { z } from "zod";
import { requireTripAccess } from "@/server/access/trip-access";
import { insertSavedDay } from "@/server/savedDays";

const STATUS: Record<string, number> = {
  "not-found": 404,
  "invalid-command": 400,
  forbidden: 403,
  "concurrency-conflict": 409,
  "unknown-day": 400,
};

// An optional body. Without one the day is appended, which is what the page's
// *Add to trip* sends. `startingAt` is the trip's day the playbook's first day
// merges onto: the day a person named to the playbook pages' assistant (M45
// D9), approved through this same route so the insert stays the button's.
const InsertBody = z.object({ startingAt: z.string().uuid().optional() });

// Insert one of your saved days into a trip. TWO checks, because two different
// things are being reached for: `editor` on the target trip (this appends a
// day and its stops), and ownership of the saved day (enforced inside
// `insertSavedDay`, which only ever looks the row up scoped to the caller).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string; savedDayId: string }> },
) {
  const { tripId, savedDayId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;

  const raw = await request.text();
  let body: unknown = {};
  try {
    body = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return Response.json({ error: "The body must be JSON.", code: "invalid-command" }, { status: 400 });
  }
  const parsed = InsertBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "startingAt must be a day id.", code: "invalid-command" }, { status: 400 });
  }

  const result = await insertSavedDay(savedDayId, tripId, access.userId, parsed.data);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
}
