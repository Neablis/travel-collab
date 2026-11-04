import { eq, inArray, and, sql } from "drizzle-orm";
import type { TripRole } from "@tc/contracts";
import { pollClosed, pollsIn, type PollResults, type PollSpec } from "@tc/pages";
import { db } from "../db/client";
import { pages, pollCloses, pollVotes } from "../db/schema";
import { canEditNotebook } from "@/lib/tripRole";
import { isUuid } from "../ids";

// The Poll module's store (M58 decision 8, ADR-088 §8): ordinary CRUD on
// `poll_votes` and `poll_closes`, never an event, as the chat's is. The caller
// has already passed the trip's seat check; what is decided here is only what
// is about one poll: that it exists on this trip, what its options are, and
// whether votes are still being taken.

/** One poll as the group sees it: counts per option, who picked what, and whether it is closed. */
export interface PollTally {
  closed: boolean;
  counts: Record<string, number>;
  votes: { userId: string; optionIds: string[] }[];
}

/** What a write on a poll did, for the route to turn into a status. */
export type PollWrite = { ok: true } | { ok: false; error: "closed" | "invalid" };

/**
 * The poll with this id, as written on one of THIS trip's pages, or `null`. The
 * id is a widget param that anyone could type into a request, so the pages are
 * the authority on whether it is a poll here, and on its options and its
 * closing date: a vote is never judged against a request's own idea of them.
 */
export async function pollOnTrip(tripId: string, pollId: string): Promise<PollSpec | null> {
  if (!isUuid(pollId)) return null;
  const rows = await db.select({ content: pages.content }).from(pages).where(eq(pages.tripId, tripId));
  for (const row of rows) {
    const found = pollsIn(row.content).find((spec) => spec.pollId === pollId);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * The tally of each given poll. A vote for an option the poll no longer has
 * (its text was edited) is neither counted nor listed, but stays stored: put
 * the option back and the vote counts again. `today` is passed in, for the
 * closing date.
 */
export async function tallyFor(tripId: string, specs: readonly PollSpec[], today: string): Promise<Map<string, PollTally>> {
  const ids = specs.map((s) => s.pollId);
  if (ids.length === 0) return new Map();
  const [votes, closes] = await Promise.all([
    db.select().from(pollVotes).where(and(eq(pollVotes.tripId, tripId), inArray(pollVotes.pollId, ids))),
    db.select({ pollId: pollCloses.pollId }).from(pollCloses).where(and(eq(pollCloses.tripId, tripId), inArray(pollCloses.pollId, ids))),
  ]);
  const closedByHand = new Set(closes.map((c) => c.pollId));
  return new Map(
    specs.map((spec) => {
      const known = new Set(spec.options.map((o) => o.id));
      const mine = votes
        .filter((v) => v.pollId === spec.pollId)
        .map((v) => ({ userId: v.userId, optionIds: v.optionIds.filter((id) => known.has(id)) }))
        .filter((v) => v.optionIds.length > 0);
      const counts = Object.fromEntries(spec.options.map((o) => [o.id, mine.filter((v) => v.optionIds.includes(o.id)).length]));
      return [spec.pollId, { closed: pollClosed(spec.closesAt, closedByHand.has(spec.pollId), today), counts, votes: mine }];
    }),
  );
}

/**
 * Record `userId`'s vote, or change it. Refused once the poll is closed (the
 * vote in place stays), and when the picks are not options of the poll, or
 * are more than one on a poll that takes one.
 */
export async function castVote(tripId: string, userId: string, spec: PollSpec, optionIds: readonly string[], today: string): Promise<PollWrite> {
  const picks = [...new Set(optionIds)];
  const known = new Set(spec.options.map((o) => o.id));
  if (picks.length === 0 || picks.some((id) => !known.has(id)) || (!spec.multi && picks.length > 1)) {
    return { ok: false, error: "invalid" };
  }
  const tally = (await tallyFor(tripId, [spec], today)).get(spec.pollId)!;
  if (tally.closed) return { ok: false, error: "closed" };
  return (await writeVote(tripId, userId, spec, picks)) ? { ok: true } : { ok: false, error: "closed" };
}

/**
 * The vote's one write; `false` when an editor has closed the poll. The close
 * is checked inside the same statement as the upsert, not in a read before it,
 * so a close that lands between `castVote`'s read and this write still wins.
 */
export async function writeVote(tripId: string, userId: string, spec: PollSpec, picks: readonly string[]): Promise<boolean> {
  const written = await db.execute(sql`
    INSERT INTO poll_votes (poll_id, trip_id, user_id, option_ids, voted_at)
    SELECT ${spec.pollId}::uuid, ${tripId}::uuid, ${userId}, ${JSON.stringify(picks)}::jsonb, ${new Date().toISOString()}::timestamptz
    WHERE NOT EXISTS (SELECT 1 FROM poll_closes WHERE trip_id = ${tripId}::uuid AND poll_id = ${spec.pollId}::uuid)
    ON CONFLICT (trip_id, poll_id, user_id) DO UPDATE SET option_ids = EXCLUDED.option_ids, voted_at = EXCLUDED.voted_at
    RETURNING 1`);
  return written.rows.length > 0;
}

/** Close the poll by hand. Closing a closed poll changes nothing; there is no reopening in the first cut. */
export async function closePoll(tripId: string, spec: PollSpec, closedBy: string, at: Date): Promise<void> {
  await db
    .insert(pollCloses)
    .values({ pollId: spec.pollId, tripId, closedBy, closedAt: at })
    .onConflictDoNothing({ target: [pollCloses.tripId, pollCloses.pollId] });
}

/** The calendar day votes are judged against: the server's, UTC. A closing date is a day, not an instant. */
export const pollToday = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** The poll as one member reads it back after a read, a vote or a close. Closing is the notebook editors' (`canEditNotebook`). */
export async function resultsFor(tripId: string, spec: PollSpec, reader: { userId: string; role: TripRole }, today: string): Promise<PollResults> {
  const tally = (await tallyFor(tripId, [spec], today)).get(spec.pollId)!;
  return { ...tally, mine: tally.votes.find((v) => v.userId === reader.userId)?.optionIds ?? [], canClose: canEditNotebook(reader.role) };
}
