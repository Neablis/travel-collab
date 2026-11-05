import { PollResults, PollVoteBody } from "@tc/pages";
import { readBody } from "@/server/readBody";
import { requireTripAccess } from "@/server/access/trip-access";
import { castVote, pollOnTrip, pollToday, resultsFor } from "@/server/polls/votes";

// A poll's votes (M58 decision 8). Not a planning command: a vote is written
// to its own table, never to the event log. Every seat on the trip, a viewer
// included, may read and vote; the poll id in the path is checked against the
// trip's own pages on every request, so it can never reach another trip's poll.

const notFound = () => Response.json({ error: "not-found" }, { status: 404 });

/** The poll's counts, who voted for what, and the reader's own pick. Any member. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string; pollId: string }> }) {
  const { tripId, pollId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  const spec = await pollOnTrip(tripId, pollId);
  if (spec === null) return notFound();
  return Response.json(PollResults.parse(await resultsFor(tripId, spec, access, pollToday())));
}

/** Vote, or change a vote; 200 with the results. 409 once the poll is closed. Any member. */
export async function PUT(request: Request, { params }: { params: Promise<{ tripId: string; pollId: string }> }) {
  const { tripId, pollId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  const body = await readBody(request, PollVoteBody, "invalid-poll-vote", { maxBytes: 4 * 1024 });
  if ("error" in body) return body.error;
  const spec = await pollOnTrip(tripId, pollId);
  if (spec === null) return notFound();
  const today = pollToday();
  const voted = await castVote(tripId, access.userId, spec, body.data.optionIds, today);
  if (!voted.ok && voted.error === "closed") {
    return Response.json({ error: "This poll is closed.", code: "poll-closed" }, { status: 409 });
  }
  if (!voted.ok) return Response.json({ error: "That isn't an option of this poll.", code: "invalid-poll-vote" }, { status: 400 });
  return Response.json(PollResults.parse(await resultsFor(tripId, spec, access, today)));
}
