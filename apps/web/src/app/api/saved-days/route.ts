import { CreateSavedDayInput, SavedDay } from "@tc/contracts";
import { auth } from "@/server/auth";
import { requireTripAccess } from "@/server/access/trip-access";
import { listSavedDays, saveDay } from "@/server/savedDays";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  // The library is per-person; there is no "everyone's saved days" read, and
  // no route that takes an ownerId.
  return Response.json({ savedDays: await listSavedDays(session.user.id) });
}

export async function POST(request: Request) {
  const body = CreateSavedDayInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-saved-day" }, { status: 400 });
  // `viewer`, matching cloning (ADR-028): saving a day into your own library
  // copies what you can already read and takes nothing from the source. It is
  // still an access check, though — you cannot save a day out of a trip you
  // have never been let into.
  const access = await requireTripAccess(body.data.tripId, "viewer");
  if ("error" in access) return access.error;

  // A Playbook has no dates, so a calendar-date anchor is dropped on the way in,
  // as `POST /v1/playbooks` does (ADR-050 decision 8, KI-2026-09-24-c). The
  // Keep dialog names the stops that lose one before the button acts.
  const result = await saveDay({ ...body.data, dateAnchors: "strip" }, access.detail, access.userId);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message },
      { status: result.error.code === "not-found" ? 404 : 400 },
    );
  }
  return Response.json({ savedDay: SavedDay.parse(result.value) }, { status: 201 });
}
