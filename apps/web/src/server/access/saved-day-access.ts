import type { SavedDay } from "@tc/contracts";
import { auth } from "../auth";
import { readableSavedDay } from "../savedDays";

/**
 * "May this session read this saved day, and what is the day?" — the seam every
 * read of somebody else's day goes through (M11b link 3).
 *
 * **Why this is not `requireTripAccess`, and must not become a role on it.**
 * A trip's access question is *"what may you DO here"* and its answer is a
 * `TripRole` on a members list: someone was invited, a grant exists, and the
 * rank decides read from write. A published saved day has none of that. Nobody
 * is invited to it, there is no members list to be on, and the only thing the
 * answer ever gates is a read. The question is *"is this day out in the
 * open"* — a property of the day, not a relationship between two parties — so
 * modelling it as a role would mean minting a membership for every signed-in
 * account against every published day, which is a way of saying "no membership
 * at all" that costs a table.
 *
 * They also fail differently, and the difference matters. `requireTripAccess`
 * distinguishes 403 from 404 carefully, because a trip that exists is itself
 * information. Here it must NOT: a private day and a nonexistent day are the
 * same 404, so that probing ids cannot enumerate what people have kept to
 * themselves. That is the same rule `DELETE /api/saved-days/:id` already
 * follows by scoping its WHERE clause to the owner, and it is why this seam
 * scopes its read the same way rather than reading first and judging after.
 *
 * The three cases the exit gate walks as two actors:
 *
 *   * the author reads their own day, published or not;
 *   * another signed-in account reads a **published** day;
 *   * another signed-in account gets a 404 for a **private** one.
 *
 * `isAuthor` rides along because every caller needs it and re-deriving
 * `day.ownerId === readerId` at each of them is how one of them eventually
 * gets it backwards.
 */
export type SavedDayReadResult =
  | { error: Response }
  | { readerId: string; day: SavedDay; isAuthor: boolean };

export async function requireSavedDayRead(savedDayId: string): Promise<SavedDayReadResult> {
  // Signed-in only. The exit gate's wording is "findable by another SIGNED-IN
  // account" — publishing puts a day in the invited population's library, not
  // on the open internet, and M11a's gate is what bounds that population
  // (M11b's "moderation waits on the invite gate"). An anonymous public read
  // would step past the precondition this milestone's scope rests on.
  const session = await auth();
  if (!session?.user?.id) {
    return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const readerId = session.user.id;
  const day = await readableSavedDay(savedDayId, readerId);
  if (day === null) {
    return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  }
  return { readerId, day, isAuthor: day.ownerId === readerId };
}
