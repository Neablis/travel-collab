import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  SavedDayVisibility,
  type PutReviewInput,
  type Review,
  type ReviewDayChanged,
  type ReviewSummary,
  type SavedDayReviewsResponse,
} from "@tc/contracts";
import { displayNameFor } from "@/lib/displayName";
import { db, type Queryable } from "./db/client";
import { savedDayReviews, savedDays } from "./db/schema";
import { isUuid } from "./ids";

// Reviews of a published Playbook (M12 links 1-4). Ordinary CRUD on
// `saved_day_reviews`, NOT the event log: a review is not trip state (see the
// schema note), so nothing here goes near `commands.ts`.
//
// **The counters are the risk, not the rows.** `saved_days.rating` and
// `review_count` exist so Discover can sort and floor without an aggregate per
// card, and they are `adds`' kind of number: right only for as long as every
// writer keeps them right. So there is exactly one way they move —
// `recomputeReviewCounters`, an aggregate over the rows, never a `+1` — and
// every write here runs it in the same transaction as the row it wrote.
// `reviews.int.test.ts` fails if a counter drifts from the rows (M12's gate
// box), and `test-support/reviewCounters.ts` is the check other writers reuse.
//
// Names are `displayNameFor({ userId })`, the same resolver and the same input
// the shared day's author strip and the board use. A `users` join could pass
// the chosen M17 name, but then a reviewer would be called one thing on the
// rail and another on their profile — the seam's own rule is one answer.

type ReviewRow = typeof savedDayReviews.$inferSelect;

function toReview(row: ReviewRow, readerId: string): Review {
  return {
    savedDayId: row.savedDayId,
    reviewerId: row.reviewerId,
    reviewerDisplayName: displayNameFor({ userId: row.reviewerId }),
    stars: row.stars,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isMine: row.reviewerId === readerId,
  };
}

/** Only rows a moderator has not hidden count anywhere — the rail, the list, the counters. */
const visible = isNull(savedDayReviews.hiddenAt);

// Why the lock has to come before the review write and not merely before the
// recompute: under READ COMMITTED an UPDATE that waits on a row lock re-checks
// its WHERE against the newer row but does NOT re-run its FROM subquery. Two
// reviewers writing concurrently would each aggregate from a snapshot missing
// the other's row, and the later commit would store a count one short — drift
// with no bug in either statement. Serialising on the parent row means the
// second writer's statements all start after the first has committed.
/**
 * Take the row lock every review write serialises on. Call it FIRST in the
 * transaction — before writing or hiding a review row — and then
 * `recomputeReviewCounters` last.
 *
 * Returns the day's row, or null when there is no such day at all.
 */
export async function lockSavedDayForReviewWrite(tx: Queryable, savedDayId: string) {
  const rows = await tx.select().from(savedDays).where(eq(savedDays.id, savedDayId)).for("update");
  return rows[0] ?? null;
}

// An aggregate with no GROUP BY yields exactly one row even over no input —
// `count` 0 and `avg` null — so a day whose last review went away gets back
// to "nobody has rated this yet" (null, 0) rather than keeping its old number.
/**
 * Set `saved_days.rating` and `review_count` from `saved_day_reviews` — the
 * visible rows only — for one day. The ONLY writer of either column after a
 * row is created.
 *
 * Takes the caller's transaction: the review write that occasioned it and this
 * must commit together, or the counters describe rows that do not exist. The
 * caller holds `lockSavedDayForReviewWrite` first (see there for why).
 */
export async function recomputeReviewCounters(tx: Queryable, savedDayId: string): Promise<void> {
  await tx.execute(sql`
    update saved_days d
    set rating = r.average, review_count = r.count
    from (
      select avg(stars)::float8 as average, count(*)::int as count
      from saved_day_reviews
      where saved_day_id = ${savedDayId} and hidden_at is null
    ) r
    where d.id = ${savedDayId}
  `);
}

/** The rating rail's numbers for one day, counted from the visible rows. */
async function summaryOf(q: Queryable, savedDayId: string): Promise<ReviewSummary> {
  const rows = await q
    .select({
      average: sql<number | null>`avg(${savedDayReviews.stars})::float8`,
      count: sql<number>`count(*)::int`,
      s1: sql<number>`count(*) filter (where ${savedDayReviews.stars} = 1)::int`,
      s2: sql<number>`count(*) filter (where ${savedDayReviews.stars} = 2)::int`,
      s3: sql<number>`count(*) filter (where ${savedDayReviews.stars} = 3)::int`,
      s4: sql<number>`count(*) filter (where ${savedDayReviews.stars} = 4)::int`,
      s5: sql<number>`count(*) filter (where ${savedDayReviews.stars} = 5)::int`,
    })
    .from(savedDayReviews)
    .where(and(eq(savedDayReviews.savedDayId, savedDayId), visible));
  const r = rows[0]!;
  return {
    average: r.average === null ? null : Number(r.average),
    count: Number(r.count),
    histogram: { 1: Number(r.s1), 2: Number(r.s2), 3: Number(r.s3), 4: Number(r.s4), 5: Number(r.s5) },
  };
}

/** What `putReview` answered with — one success and three refusals, each its own status. */
export type PutReviewOutcome =
  | { kind: "saved"; review: Review; summary: ReviewSummary }
  | { kind: "not-found" }
  | { kind: "own-day" }
  | { kind: "day-changed"; body: ReviewDayChanged };

// Only a PUBLIC, undeleted, unmoderated day can be reviewed — including by its
// author, who is refused anyway (D2). A private day is readable by its owner,
// but "reviewing" one is meaningless, and it gets the same `not-found` a
// stranger's private day does, so this path cannot confirm an id exists.
//
// That test is re-made here under the row lock even though the route has
// already been through `requireSavedDayRead`: the author could unpublish
// between the route's read and this write, and a review must not attach to a
// day that stopped being public in between.
/**
 * Create or replace `reviewerId`'s review of a published day, and recompute
 * the day's counters in the same transaction. Returns the review as stored
 * with the fresh summary, so a client can redraw the rail without a reload.
 */
export async function putReview(
  savedDayId: string,
  reviewerId: string,
  input: PutReviewInput,
  now: Date = new Date(),
): Promise<PutReviewOutcome> {
  if (!isUuid(savedDayId)) return { kind: "not-found" };
  return db.transaction(async (tx) => {
    const day = await lockSavedDayForReviewWrite(tx, savedDayId);
    if (
      day === null ||
      day.deletedAt !== null ||
      day.moderatedAt !== null ||
      day.visibility !== SavedDayVisibility.enum.public
    ) {
      return { kind: "not-found" };
    }
    // "The author is not their own audience" — the adds ledger's rule (D2).
    // Refused rather than silently uncounted as a self-add is: a star rating
    // you gave yourself is a visible claim on the rail, not an invisible tally.
    if (day.ownerId === reviewerId) return { kind: "own-day" };

    // D4. `undefined` means the client did not ask for the check. A public
    // day always has a `published_at` (the two move together in
    // `setSavedDayVisibility`); the null guard is for the type, not a case.
    if (input.seenPublishedAt !== undefined && day.publishedAt !== null) {
      const seen = input.seenPublishedAt === null ? null : new Date(input.seenPublishedAt).getTime();
      if (seen !== day.publishedAt.getTime()) {
        return {
          kind: "day-changed",
          body: {
            error: "day-changed",
            changedAt: day.publishedAt.toISOString(),
            authorDisplayName: displayNameFor({ userId: day.ownerId }),
          },
        };
      }
    }

    // An upsert on the primary key, so a second post is an update by
    // construction. `created_at` is left alone on conflict — it is when this
    // person first reviewed the day — and `hidden_at` is too: a moderator's
    // hide must not be undone by the reviewer editing their stars.
    const [row] = await tx
      .insert(savedDayReviews)
      .values({ savedDayId, reviewerId, stars: input.stars, note: input.note, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [savedDayReviews.savedDayId, savedDayReviews.reviewerId],
        set: { stars: input.stars, note: input.note, updatedAt: now },
      })
      .returning();
    await recomputeReviewCounters(tx, savedDayId);
    return { kind: "saved", review: toReview(row!, reviewerId), summary: await summaryOf(tx, savedDayId) };
  });
}

// Not gated on the day still being public: a review is its writer's text, and
// withdrawing it from a day that has since gone private is theirs to do.
/**
 * Withdraw `reviewerId`'s own review and recompute the day's counters.
 * Returns the fresh summary, or null when this person has no review here.
 */
export async function deleteReview(savedDayId: string, reviewerId: string): Promise<ReviewSummary | null> {
  if (!isUuid(savedDayId)) return null;
  return db.transaction(async (tx) => {
    await lockSavedDayForReviewWrite(tx, savedDayId);
    const removed = await tx
      .delete(savedDayReviews)
      .where(and(eq(savedDayReviews.savedDayId, savedDayId), eq(savedDayReviews.reviewerId, reviewerId)))
      .returning({ reviewerId: savedDayReviews.reviewerId });
    if (removed.length === 0) return null;
    await recomputeReviewCounters(tx, savedDayId);
    return summaryOf(tx, savedDayId);
  });
}

/**
 * How many reviews the rail lists. The summary counts every visible review;
 * only the list is capped, newest-updated first, and the reader's own review
 * is returned beside it wherever it falls.
 */
const REVIEW_LIST_LIMIT = 100;

// `mine` excludes a hidden review too. The contract says `mine` is also in
// `reviews`, and the list shows no hidden row, so the alternative would break
// that promise; a hidden review is also a moderator's decision, and showing it
// back to its author as if it were live would misstate where it stands.
/**
 * The rating rail for one day: summary, visible reviews newest-updated first,
 * and the reader's own. Readability is the CALLER's check
 * (`requireSavedDayRead`) — this function reads whatever id it is given.
 */
export async function reviewsFor(savedDayId: string, readerId: string): Promise<SavedDayReviewsResponse> {
  const [summary, rows, own] = await Promise.all([
    summaryOf(db, savedDayId),
    db
      .select()
      .from(savedDayReviews)
      .where(and(eq(savedDayReviews.savedDayId, savedDayId), visible))
      .orderBy(desc(savedDayReviews.updatedAt), savedDayReviews.reviewerId)
      .limit(REVIEW_LIST_LIMIT),
    db
      .select()
      .from(savedDayReviews)
      .where(
        and(eq(savedDayReviews.savedDayId, savedDayId), eq(savedDayReviews.reviewerId, readerId), visible),
      ),
  ]);
  return {
    summary,
    reviews: rows.map((row) => toReview(row, readerId)),
    mine: own[0] === undefined ? null : toReview(own[0], readerId),
  };
}
