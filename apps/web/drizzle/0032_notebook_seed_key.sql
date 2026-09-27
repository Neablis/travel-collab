-- A trip's default notebooks are known by a permanent key, not their title
-- (Mitchell, 2026-09-27; KI-2026-09-27-e). Add the key, give it to every seed
-- that exists, then swap the (trip, title) index for one on (trip, key), so
-- any notebook may take any title and two may share one.
ALTER TABLE "pages" ADD COLUMN "seed_key" text;--> statement-breakpoint
-- The backfill, and it answers the question a replay of the log answers
-- (`seedKeyOf` in @tc/contracts, `projectedSeedKey` in projections.ts), so a
-- rebuild gives the keys this gave. A page is read as the event that created
-- it said it was (its latest `PageCreated`), or as its row when the log has
-- none: a `system` page marked `kind: "overview"` is the Overview, and a
-- `system` page created with a seeded title is that seed, whatever it is
-- called now. Where two pages of a trip would get one key (a seed renamed away,
-- then added back beside it), only the first gets it: a row the log has never
-- seen, then the earliest-created by the log, then the oldest row. The other
-- stays an ordinary notebook until the first is deleted, when it inherits.
-- This sees only live rows, so where the first was ALREADY deleted it keys the
-- survivor; a replay meets the first alive, and agrees only because a deleted
-- holder's key passes to the oldest live keyless page implying it, by the
-- `seq` this orders by (`passSeedKeyOn` in @tc/domain, `passSeedKeyOnRows` in
-- projections.ts). Change this order and those two with it.
-- seed-key backfill: begin
WITH genesis AS (
  SELECT DISTINCT ON (e.stream_id, e.payload->>'pageId')
    e.stream_id AS trip_id, e.payload->>'pageId' AS page_id, e.seq, e.payload
  FROM "events" e
  WHERE e.type = 'PageCreated'
  ORDER BY e.stream_id, e.payload->>'pageId', e.seq DESC
),
candidate AS (
  SELECT p.id, p.trip_id, p.created_at, g.seq,
    CASE
      WHEN g.payload->'seedKey' IS NOT NULL THEN g.payload->>'seedKey'
      WHEN (CASE WHEN g.seq IS NULL THEN p.actor_id ELSE g.payload->>'actorId' END) <> 'system' THEN NULL
      WHEN (CASE WHEN g.seq IS NULL THEN p.context ELSE g.payload->'context' END)->>'kind' = 'overview' THEN 'overview'
      ELSE CASE (CASE WHEN g.seq IS NULL THEN p.title ELSE g.payload->>'title' END)
        WHEN 'Before you go' THEN 'before-you-go'
        WHEN 'Bookings' THEN 'bookings-and-confirmations'
        WHEN 'Money' THEN 'money'
      END
    END AS seed_key
  FROM "pages" p
  LEFT JOIN genesis g ON g.trip_id = p.trip_id AND g.page_id = p.id::text
),
ranked AS (
  SELECT id, seed_key,
    row_number() OVER (PARTITION BY trip_id, seed_key ORDER BY seq NULLS FIRST, created_at, id) AS n
  FROM candidate
  WHERE seed_key IS NOT NULL
)
UPDATE "pages" SET "seed_key" = ranked.seed_key
FROM ranked
WHERE "pages"."id" = ranked.id AND ranked.n = 1;
-- seed-key backfill: end
--> statement-breakpoint
DROP INDEX IF EXISTS "pages_system_seed_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "pages_seed_key_unique" ON "pages" USING btree ("trip_id","seed_key") WHERE "pages"."seed_key" is not null;
