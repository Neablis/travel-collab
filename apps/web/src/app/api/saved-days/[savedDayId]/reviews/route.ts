import {
  PutReviewInput,
  Review,
  ReviewDayChanged,
  ReviewSummary,
  SavedDayReviewsResponse,
} from "@tc/contracts";
import { auth } from "@/server/auth";
import { requireSavedDayRead } from "@/server/access/saved-day-access";
import { deleteReview, putReview, reviewsFor } from "@/server/reviews";

// A published day's reviews (M12 links 1-4): read the rail, post or replace
// your own review, withdraw it. Signed-in only, for the reason
// `saved-day-access.ts` gives for every read of somebody else's day.
//
// GET and PUT go through `requireSavedDayRead` first, so a day you cannot read
// is the same 404 here as on the day itself — this route never becomes a way to
// ask whether an id exists. PUT then narrows further inside `putReview`
// (public and unmoderated, under a row lock); see there.

type Params = { params: Promise<{ savedDayId: string }> };

/** The rating rail: summary, visible reviews newest first, and the reader's own. */
export async function GET(_request: Request, { params }: Params) {
  const { savedDayId } = await params;
  const access = await requireSavedDayRead(savedDayId);
  if ("error" in access) return access.error;
  return Response.json(SavedDayReviewsResponse.parse(await reviewsFor(savedDayId, access.readerId)));
}

/**
 * Create or replace the caller's review. 200 with the stored review and the
 * fresh summary; 400 invalid (a note over 140 characters included); 401; 403
 * `own-day`; 404; 409 `day-changed`.
 */
// A note over the cap is REFUSED at this parse, never truncated — M12's gate
// box, and why the limit lives in the contract rather than in a `maxLength`.
export async function PUT(request: Request, { params }: Params) {
  const { savedDayId } = await params;
  const access = await requireSavedDayRead(savedDayId);
  if ("error" in access) return access.error;
  const body = PutReviewInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-review" }, { status: 400 });

  const outcome = await putReview(savedDayId, access.readerId, body.data);
  switch (outcome.kind) {
    case "not-found":
      return Response.json({ error: "not-found" }, { status: 404 });
    // 403, not 404: the author can read their own day, so there is nothing to
    // withhold, and what they need to know is that this is not theirs to rate.
    case "own-day":
      return Response.json({ error: "own-day" }, { status: 403 });
    case "day-changed":
      return Response.json(ReviewDayChanged.parse(outcome.body), { status: 409 });
    case "saved":
      return Response.json({ review: Review.parse(outcome.review), summary: ReviewSummary.parse(outcome.summary) });
  }
}

/** Withdraw the caller's own review. 200 with the fresh summary; 401; 404 when there is none. */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { savedDayId } = await params;
  const summary = await deleteReview(savedDayId, session.user.id);
  if (summary === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ summary: ReviewSummary.parse(summary) });
}
