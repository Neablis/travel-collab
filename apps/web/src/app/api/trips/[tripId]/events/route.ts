import { z } from "zod";
import { TripEventsPage } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { getTripEventsAfter } from "@/server/broadcast";

/**
 * `GET /api/trips/:tripId/events?after=<seq>` — what happened on this trip
 * after the cursor the caller holds (M13 link 2, ADR-049).
 *
 * **Receiving an event is reading, so this asks the same question the trip GET
 * asks**: `requireTripAccess(..., "viewer")`, the one seam that knows a viewer
 * ranks below an editor (AGENTS.md invariant 6c). Because every poll is a fresh
 * request, a member whose access is revoked mid-session stops being served on
 * their next poll with no teardown path to get wrong — which is ADR-049's
 * second argument for a cursor over a held connection, and M13's third gate box.
 */

// Required, and a bad value is a 400 rather than a coerced one. `Number("x")`
// would be `NaN`, and `seq > NaN` matches no row — so a typo'd cursor would be
// answered "nothing has happened", which is the silent-wrong-answer class this
// repo keeps paying for. `z.coerce.number()` maps "" and null to 0, so both are
// rejected before they reach it rather than read as "from the start".
const AfterParam = z.coerce.number().int().nonnegative();

export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true });
  if ("error" in access) return access.error;

  const raw = new URL(request.url).searchParams.get("after");
  const after = raw === null || raw.trim() === "" ? null : AfterParam.safeParse(raw);
  if (after === null || !after.success) {
    return Response.json(
      { error: "`after` is required and must be a non-negative integer seq" },
      { status: 400 },
    );
  }

  const page = await getTripEventsAfter(tripId, after.data);
  return Response.json(TripEventsPage.parse(page));
}
