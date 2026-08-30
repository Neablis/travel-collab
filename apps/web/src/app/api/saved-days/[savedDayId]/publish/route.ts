import { SavedDay, SavedDayVisibility } from "@tc/contracts";
import { auth } from "@/server/auth";
import { setSavedDayVisibility } from "@/server/savedDays";

// Publishing, and taking it back (M11b link 3).
//
// Two methods on one route rather than `/publish` and `/unpublish`, because
// they are one fact with two values and a single handler is what keeps
// `visibility` and `published_at` from ever being moved by only one of them.
// POST puts the day in the public library; DELETE removes it. No request body
// on either — there is nothing for a client to say beyond which of the two it
// meant, and a body would be a second place the visibility vocabulary is
// spelled.
//
// Author-only, scoped in the WHERE clause (see `setSavedDayVisibility`): a day
// that is not yours is a 404, the same answer `DELETE /api/saved-days/:id`
// already gives, so a refusal never confirms that an id names something.
// Publishing someone else's day and REPORTING someone else's day are different
// questions; the second one is M12's.

async function setVisibility(
  savedDayId: string,
  visibility: SavedDayVisibility,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const day = await setSavedDayVisibility(savedDayId, session.user.id, visibility);
  if (day === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ savedDay: SavedDay.parse(day) });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const { savedDayId } = await params;
  return setVisibility(savedDayId, SavedDayVisibility.enum.public);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const { savedDayId } = await params;
  return setVisibility(savedDayId, SavedDayVisibility.enum.private);
}
