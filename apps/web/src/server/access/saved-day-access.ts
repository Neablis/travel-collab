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
 * A day its owner soft-deleted joins that last case, author included: the
 * `deleted_at is null` clause lives in `readableSavedDay`'s WHERE beside the
 * visibility test, so a deleted day produces no row and this seam answers 404
 * without ever having to know the column exists. That is the property worth
 * preserving — the number of things a caller here can distinguish stays at
 * exactly one ("you may read this day, or you may not"), and every new reason a
 * day is unreadable is spelled in the query rather than as another branch.
 *
 * A day an operator moderated (M12 link 6) is the next such reason, and it is
 * spelled there too — for everyone EXCEPT its author, who keeps their copy:
 * a non-owner gets this same 404, identical to a private day's.
 *
 * `isAuthor` rides along because every caller needs it and re-deriving
 * `day.ownerId === readerId` at each of them is how one of them eventually
 * gets it backwards.
 */
export type SavedDayReadResult =
  | { error: Response }
  | { readerId: string; day: SavedDay; isAuthor: boolean };

export async function requireSavedDayRead(savedDayId: string): Promise<SavedDayReadResult> {
  // Signed-in only — this is the seam for WRITES now (review, report). The
  // reads moved to `readSavedDayAsViewer` below when the library opened to
  // readers with no account (ADR-061). Its original reason: M11b's exit gate
  // read "findable by another SIGNED-IN account", with M11a's invite gate
  // bounding who that was.
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

/**
 * The same read, for a reader who may have no account at all (ADR-061) — what
 * the public library's GETs go through, so a shared link opens for somebody
 * who has not signed up.
 *
 * **Why the precondition above no longer binds these reads.** M11b kept the
 * library to signed-in accounts because M11a's invite gate was what bounded the
 * population that could see a published day. Publishing is now a decision to
 * show a day to anyone holding the link, so the read is opened — and only the
 * read. `requireSavedDayRead` stays as it was and still guards every write
 * (review, report, add to a trip): an anonymous caller gets 401 there, never a
 * row.
 *
 * **The one-answer property is unchanged.** A reader with no account owns
 * nothing, so `readableSavedDay` keeps only its published-and-unmoderated
 * branch for them: a private day, a moderated one, a deleted one and an
 * unknown id are the same 404, exactly as they are for another signed-in
 * account. `isAuthor` is always false — nobody without an account wrote it.
 *
 * Rate limiting is the route's job (`publicLibraryLimit.ts`), not this seam's:
 * a limiter needs the request, and this answers a question about a day.
 */
export type SavedDayViewResult =
  | { error: Response }
  | { readerId: string | null; day: SavedDay; isAuthor: boolean };

/** Read `savedDayId` for whoever is asking, signed in or not; 404 unless they may see it. */
export async function readSavedDayAsViewer(savedDayId: string): Promise<SavedDayViewResult> {
  const session = await auth();
  const readerId = session?.user?.id ?? null;
  const day = await readableSavedDay(savedDayId, readerId);
  if (day === null) {
    return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  }
  return { readerId, day, isAuthor: readerId !== null && day.ownerId === readerId };
}

/**
 * `requireSavedDayRead`, and then **only its author** — for a write that
 * changes how the day looks to everyone who opens it, such as its cover
 * (M37 part 5). A day this reader cannot open is the same 404 it always is;
 * one they can open but did not write is a 403, which says nothing they could
 * not already see on the page.
 */
export async function requireSavedDayAuthor(
  savedDayId: string,
): Promise<{ error: Response } | { readerId: string; day: SavedDay }> {
  const read = await requireSavedDayRead(savedDayId);
  if ("error" in read) return read;
  if (!read.isAuthor) return { error: Response.json({ error: "not-the-author" }, { status: 403 }) };
  return { readerId: read.readerId, day: read.day };
}
