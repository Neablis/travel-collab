import { SavedDay } from "@tc/contracts";
import { auth } from "@/server/auth";
import { requireSavedDayRead } from "@/server/access/saved-day-access";
import { deleteSavedDay } from "@/server/savedDays";

// Read one saved day: your own, or anybody's published one (M11b link 3).
// The rule and its reasoning live in the seam, not here — see
// `server/access/saved-day-access.ts` for why "may I read this day" is not a
// role on `requireTripAccess`.
//
// `isAuthor` is on the response because PR3's shared-day route needs it to
// decide whether to offer Unpublish, and the client cannot derive it: the
// signed-in id is not something the browser is handed to compare against.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const { savedDayId } = await params;
  const access = await requireSavedDayRead(savedDayId);
  if ("error" in access) return access.error;
  return Response.json({ savedDay: SavedDay.parse(access.day), isAuthor: access.isAuthor });
}

// Owner-only, and scoped in the query rather than checked after the read: a
// saved day belonging to someone else is indistinguishable from one that does
// not exist, which is the right answer to both.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { savedDayId } = await params;
  const removed = await deleteSavedDay(savedDayId, session.user.id);
  if (!removed) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ ok: true });
}
