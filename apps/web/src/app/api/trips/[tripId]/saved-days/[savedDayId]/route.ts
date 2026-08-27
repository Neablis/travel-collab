import { requireTripAccess } from "@/server/access/trip-access";
import { insertSavedDay } from "@/server/savedDays";

const STATUS: Record<string, number> = {
  "not-found": 404,
  "invalid-command": 400,
  forbidden: 403,
  "concurrency-conflict": 409,
};

// Insert one of your saved days into a trip. TWO checks, because two different
// things are being reached for: `editor` on the target trip (this appends a
// day and its stops), and ownership of the saved day (enforced inside
// `insertSavedDay`, which only ever looks the row up scoped to the caller).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; savedDayId: string }> },
) {
  const { tripId, savedDayId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;

  const result = await insertSavedDay(savedDayId, tripId, access.userId);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
}
