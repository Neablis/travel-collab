// **"Rebuild equals stored" for the review counters** (M12 link 2's gate box).
//
// `saved_days.rating` / `review_count` are a denormalised copy of
// `saved_day_reviews`, and a copy is only as good as its last writer — KI-1,
// KI-14 and `budgetPerPerson` are this repo's three instances of one going
// wrong unnoticed. This recomputes the aggregate independently of
// `recomputeReviewCounters` (its own query, not a call to it) and returns every
// day whose stored numbers disagree. Any path that writes or hides a review —
// the reviews module, moderation, an importer — asserts it comes back empty.
//
// Pass the ids a test owns. The unscoped form reads the whole table, and some
// Discover and board tests write the counters directly as fixtures (drift by
// construction), so in the int lane it answers "which files ran first".
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

/** One day whose stored counters disagree with its visible review rows. */
export type ReviewCounterDrift = {
  savedDayId: string;
  stored: { rating: number | null; reviewCount: number };
  actual: { rating: number | null; reviewCount: number };
};

/**
 * Every day (or every one of `savedDayIds`) whose `rating` / `review_count`
 * differ from an aggregate over its non-hidden `saved_day_reviews`. Empty means
 * no drift.
 */
// The rating is compared within 1e-9 rather than exactly: both sides are an
// average of small integers, but they are two different queries and a counter
// that is "right to the fifteenth digit" is not the defect this looks for.
export async function reviewCounterDrift(savedDayIds?: readonly string[]): Promise<ReviewCounterDrift[]> {
  const scope =
    savedDayIds === undefined ? sql`` : sql`and d.id = any(${sql.param([...savedDayIds])}::uuid[])`;
  const rows = await db.execute<{
    id: string;
    rating: number | null;
    review_count: number;
    actual_rating: number | null;
    actual_count: number;
  }>(sql`
    select d.id, d.rating, d.review_count,
      agg.average as actual_rating, coalesce(agg.n, 0)::int as actual_count
    from saved_days d
    left join (
      select saved_day_id, avg(stars)::float8 as average, count(*)::int as n
      from saved_day_reviews
      where hidden_at is null
      group by saved_day_id
    ) agg on agg.saved_day_id = d.id
    where (
      d.review_count <> coalesce(agg.n, 0)
      or (d.rating is null) <> (agg.average is null)
      or abs(d.rating - agg.average) > 1e-9
    ) ${scope}
  `);
  return rows.rows.map((r) => ({
    savedDayId: String(r.id),
    stored: { rating: r.rating === null ? null : Number(r.rating), reviewCount: Number(r.review_count) },
    actual: { rating: r.actual_rating === null ? null : Number(r.actual_rating), reviewCount: Number(r.actual_count) },
  }));
}
