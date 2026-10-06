import { SavedDay, SavedDayModeration, TripCover } from "@tc/contracts";
import { auth } from "@/server/auth";
import { publicLibraryReader } from "@/server/publicLibraryLimit";
import { deleteSavedDay } from "@/server/savedDays";
import { sharedDayRead } from "@/server/sharedDayView";

// Read one saved day: your own, or anybody's published one (M11b link 3).
// The rule and its reasoning live in the seam, not here — see
// `server/access/saved-day-access.ts` for why "may I read this day" is not a
// role on `requireTripAccess`.
//
// `isAuthor` is on the response because PR3's shared-day route needs it to
// decide whether to offer Unpublish, and the client cannot derive it: the
// signed-in id is not something the browser is handed to compare against.
//
// `pinning` says a pass is putting this day's stops on its map after the
// response (M27 link 10, `server/savedDayPins.ts`), so the page shows the map
// frame loading and reads again. On the envelope rather than the `SavedDay`
// contract: it is a fact about this read, not about the day.
//
// `publishedAt` is on the envelope for the same reason (M12): a review held
// offline sends it back as `seenPublishedAt`, and a republish in between turns
// the flush into §15's conflict banner instead of stars on a day the reviewer
// never read.
//
// `moderation` is on the envelope too, and ONLY for the author
// (KI-2026-09-23-i): an operator's `hide-day` and its note are addressed to the
// person whose day it is. Everyone else gets `null` — and cannot open a hidden
// day anyway, so the branch is a second wall, not the only one.
//
// `cover` is the author's chosen photo and its credit (M37 part 5), or null.
// On the envelope for `publishedAt`'s reason, and read only once the seam has
// let this reader open the day — a day they may not read hides its cover with
// it, moderation included.
//
// A reader with no account (ADR-061) gets a published, unmoderated day or the
// same 404 as anyone else, and is charged per IP. They never start a pin
// backfill: it spends the reader's geocode quota, and they have none — the
// next signed-in reader's visit pins the day instead.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const { savedDayId } = await params;
  const reader = await publicLibraryReader(request);
  if ("refused" in reader) return reader.refused;
  const view = await sharedDayRead(savedDayId, reader.readerId);
  if (view === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    savedDay: SavedDay.parse(view.day),
    isAuthor: view.isAuthor,
    pinning: view.pinning,
    publishedAt: view.publishedAt,
    moderation: view.moderation === null ? null : SavedDayModeration.parse(view.moderation),
    cover: view.cover === null ? null : TripCover.parse(view.cover),
  });
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
