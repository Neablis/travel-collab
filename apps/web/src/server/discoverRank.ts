import { sql, type SQL } from "drizzle-orm";
import { SavedDayVisibility } from "@tc/contracts";
import { db } from "./db/client";

/**
 * The knobs of Discover's score (M61 decisions 1 to 4, ADR-090), in one place
 * so that tuning is a one-line change with a test. They are starting values:
 * the operator's *Discover rank* tab is how they are checked against production.
 *
 * ```
 * score       = quality × (interest + newDayLift)
 * interest    = addWeight·Σ adds·½^(age/addHalfLifeDays)
 *             + commentWeight·Σ comments·½^(age/commentHalfLifeDays)
 * newDayLift  = newDayWeight × ½^(dayAge/newDayHalfLifeDays)
 * quality     = clamp(bayes / libraryMean, qualityMin, qualityMax)
 * bayes       = (priorWeight·libraryMean + Σstars) / (priorWeight + n)
 * ```
 */
export const RANK_CONSTANTS = {
  addWeight: 3,
  addHalfLifeDays: 14,
  commentWeight: 2,
  commentHalfLifeDays: 30,
  newDayWeight: 4,
  newDayHalfLifeDays: 7,
  /** `C` in the Bayesian average: how many reviews of the library mean a day starts with. */
  priorWeight: 5,
  /** Stars move a day but cannot bury it or carry it alone. */
  qualityMin: 0.7,
  qualityMax: 1.3,
} as const;

/**
 * Rewrites `saved_day_ranks` for every public day, or for one (publish and
 * re-publish compute their own row in the request, so a new day is placed at
 * once). One statement and one implementation for both: the one-day form is the
 * same SQL with a filter, not a second formula.
 *
 * Which days get a row is the library's rule (public, not deleted, not
 * moderated). A day that has left the library keeps its stale row: the reads
 * join through `matchPredicate`, so it is never listed, and a republish
 * overwrites it.
 *
 * The library mean `m` is always taken over the whole library, even when one
 * day is recomputed, so a one-day row and a full-run row agree.
 *
 * `now` is injected so a test can move the clock; callers in the app pass nothing.
 */
export async function recomputeDiscoverRanks(
  opts: { savedDayId?: string; now?: Date } = {},
): Promise<void> {
  const c = RANK_CONSTANTS;
  const now = (opts.now ?? new Date()).toISOString();
  const only = opts.savedDayId ?? null;
  const day = 86400;
  // Age is floored at zero so an event stamped after `now` (clock skew, or a
  // test that moves the clock back) counts in full rather than above full.
  const decay = (at: SQL, halfLifeDays: number) =>
    sql`power(0.5::float8, greatest(0, extract(epoch from (${now}::timestamptz - ${at}))) / ${halfLifeDays * day}::float8)`;

  await db.execute(sql`
    with live as (
      select d.id, coalesce(d.published_at, d.created_at) as since
      from saved_days d
      where d.visibility = ${SavedDayVisibility.enum.public}
        and d.deleted_at is null
        and d.moderated_at is null
    ),
    lib as (
      select coalesce(avg(r.stars), 0)::float8 as mean
      from saved_day_reviews r
      join live on live.id = r.saved_day_id
      where r.hidden_at is null
    ),
    adds as (
      -- Distinct people, each at their latest add: three trips, one vote.
      select p.saved_day_id, sum(${decay(sql`p.latest`, c.addHalfLifeDays)}) as w
      from (
        select saved_day_id, added_by, max(created_at) as latest
        from saved_day_adds
        group by saved_day_id, added_by
      ) p
      group by p.saved_day_id
    ),
    comments as (
      select r.saved_day_id, sum(${decay(sql`r.updated_at`, c.commentHalfLifeDays)}) as w
      from saved_day_reviews r
      where r.hidden_at is null and nullif(btrim(r.note), '') is not null
      group by r.saved_day_id
    ),
    stars as (
      select r.saved_day_id, count(*)::float8 as n, sum(r.stars)::float8 as total
      from saved_day_reviews r
      where r.hidden_at is null
      group by r.saved_day_id
    ),
    parts as (
      select
        live.id,
        coalesce(adds.w, 0) * ${c.addWeight} + coalesce(comments.w, 0) * ${c.commentWeight} as interest,
        coalesce(adds.w, 0) as adds_recent,
        coalesce(comments.w, 0) as comments_recent,
        ${c.newDayWeight} * ${decay(sql`live.since`, c.newDayHalfLifeDays)} as lift,
        case
          when coalesce(stars.n, 0) = 0 or lib.mean = 0 then 1.0
          else least(${c.qualityMax}::float8, greatest(${c.qualityMin}::float8,
            ((${c.priorWeight} * lib.mean + stars.total) / (${c.priorWeight} + stars.n)) / lib.mean))
        end as quality
      from live
      cross join lib
      left join adds on adds.saved_day_id = live.id
      left join comments on comments.saved_day_id = live.id
      left join stars on stars.saved_day_id = live.id
      where (${only}::uuid is null or live.id = ${only}::uuid)
    )
    insert into saved_day_ranks
      (saved_day_id, score, adds_recent, comments_recent, quality, new_day_lift, computed_at)
    select id, quality * (interest + lift), adds_recent, comments_recent, quality, lift, ${now}::timestamptz
    from parts
    on conflict (saved_day_id) do update set
      score = excluded.score,
      adds_recent = excluded.adds_recent,
      comments_recent = excluded.comments_recent,
      quality = excluded.quality,
      new_day_lift = excluded.new_day_lift,
      computed_at = excluded.computed_at
  `);
}
