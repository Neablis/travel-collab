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
//
// A SOFT delete since 2026-09-01 (Mitchell: *"add a button to delete a notebook
// activity you own. It should require it to be unpublished first, and it
// doesn't remove it from anyone, it just removes it here"*). Still this one
// endpoint rather than a second "archive" route — there is one delete on a
// saved day and the storage decision behind it is `savedDays.ts`'s, not a new
// URL. The two refusals it can now give:
//
//   * **409 for a published day.** A real refusal with a reason, deliberately
//     NOT the 404 everything else here answers with: the caller is the owner,
//     the day demonstrably exists to them, and there is nothing to withhold —
//     what they need is the next step, which is to unpublish it. Answering 404
//     would tell an author their own day does not exist.
//   * **404 for anything else** — not yours, never existed, or already deleted.
//     The same answer to all three, which is what stops ids being probed.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { savedDayId } = await params;
  const outcome = await deleteSavedDay(savedDayId, session.user.id);
  if (outcome === "published") {
    return Response.json(
      // `code` as well as a sentence: the client branches on the code and shows
      // the sentence, so the wording can change without breaking the branch.
      { error: "Unpublish this day before deleting it.", code: "published" },
      { status: 409 },
    );
  }
  if (outcome === "not-found") return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ ok: true });
}
