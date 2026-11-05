import { PollResults } from "@tc/pages";
import { requireTripAccess } from "@/server/access/trip-access";
import { pollOnTrip, pollToday, reopenPoll, resultsFor } from "@/server/polls/votes";

/**
 * Take back a poll's close; 200 with the results, the votes as they were. The
 * same people as close (an editor or the owner). Reopening an open poll is the
 * same answer. 409 `poll-date-passed` when its closing date is past: the date
 * is in the notebook, and this never edits the notebook.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string; pollId: string }> }) {
  const { tripId, pollId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  const spec = await pollOnTrip(tripId, pollId);
  if (spec === null) return Response.json({ error: "not-found" }, { status: 404 });
  const today = pollToday();
  const reopened = await reopenPoll(tripId, spec, today);
  if (!reopened.ok) {
    return Response.json(
      { error: "The close date has passed. Move it to reopen the poll.", code: "poll-date-passed" },
      { status: 409 },
    );
  }
  return Response.json(PollResults.parse(await resultsFor(tripId, spec, access, today)));
}
