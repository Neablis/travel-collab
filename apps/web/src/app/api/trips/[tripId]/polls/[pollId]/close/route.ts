import { PollResults } from "@tc/pages";
import { requireTripAccess } from "@/server/access/trip-access";
import { closePoll, pollOnTrip, pollToday, resultsFor } from "@/server/polls/votes";

/**
 * Close a poll by hand; 200 with the results. An editor or the owner, the
 * people who can edit the notebook the poll is written in (a suggester and a
 * viewer vote but do not close). Closing a closed poll is the same answer.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string; pollId: string }> }) {
  const { tripId, pollId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  const spec = await pollOnTrip(tripId, pollId);
  if (spec === null) return Response.json({ error: "not-found" }, { status: 404 });
  const now = new Date();
  await closePoll(tripId, spec, access.userId, now);
  return Response.json(PollResults.parse(await resultsFor(tripId, spec, access, pollToday(now))));
}
