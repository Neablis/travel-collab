-- Indexes for the queries Sentry reported slow, each checked against its
-- caller. Three replace a narrower index with a wider one (the DROPs), so no
-- read loses an index it had: the old key is a prefix of the new one.
--
--   trip_summaries_members (GIN, jsonb_path_ops) — every "my trips" list
--     (Home, /api/trips, /api/v1/trips, the assistant) asks
--     `members @> '[{"userId": …}]'`. It was a sequential scan of every trip
--     on the instance per request. `projections.ts`' `visibleTrips` was
--     rewritten in the same change so the planner can use it: under the old
--     `members @> … OR EXISTS (…)` it could not.
--   saved_days_public_published (partial) — public, not deleted, not
--     moderated: the sitemap (in its own order), the published count on every
--     Discover read, and the place and tag pages.
--   saved_day_adds_added_by_day — Discover's `saved` scope, an EXISTS on
--     `added_by` that the (saved_day_id, trip_id) primary key cannot answer.
--   trip_messages_trip_created_id — replaces (trip_id, created_at): the chat
--     page and the unread count order and compare on (created_at, id).
--   trip_suggestion_changes_trip_status_created — replaces (trip_id, status):
--     `openAt`'s `created_at >=` bound, on a poll that runs every two seconds.
--   pending_embeddings_status_created — replaces (status): the embed sweep's
--     claim takes the oldest n pending rows, `ORDER BY created_at LIMIT n`.
--   invite_codes_created_by — the referral mint's outstanding-code cap and
--     the account sheet's `codesMintedBy`.
--
-- **It locks writes to these tables while it builds, and three of them
-- against reads too.** Plain CREATE INDEX takes a SHARE lock: reads go on,
-- writes wait (0040 measured a btree build at 0.4 s for 300k rows; a GIN
-- build is slower per row). DROP INDEX takes an ACCESS EXCLUSIVE lock on its
-- table, which blocks reads as well, and every lock is held until the
-- migration commits. So the three DROPs come last, after every build, which
-- keeps `pending_embeddings`, `trip_messages` and `trip_suggestion_changes`
-- unreadable only for the moment between the last DROP and the commit, not
-- for the whole run (PR 481 review). It cannot be CONCURRENTLY:
-- `drizzle-kit migrate` applies every pending migration inside one
-- transaction, and Postgres refuses CREATE INDEX CONCURRENTLY in a
-- transaction block (0040 checked this against Postgres 16 and drizzle-orm
-- 0.45's migrator). So dispatch `migrate-production` when nobody is editing.
CREATE INDEX "invite_codes_created_by" ON "invite_codes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pending_embeddings_status_created" ON "pending_embeddings" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "saved_day_adds_added_by_day" ON "saved_day_adds" USING btree ("added_by","saved_day_id");--> statement-breakpoint
CREATE INDEX "saved_days_public_published" ON "saved_days" USING btree ("published_at" DESC NULLS LAST,"id") WHERE "saved_days"."visibility" = 'public' and "saved_days"."deleted_at" is null and "saved_days"."moderated_at" is null;--> statement-breakpoint
CREATE INDEX "trip_messages_trip_created_id" ON "trip_messages" USING btree ("trip_id","created_at","id");--> statement-breakpoint
CREATE INDEX "trip_suggestion_changes_trip_status_created" ON "trip_suggestion_changes" USING btree ("trip_id","status","created_at");--> statement-breakpoint
CREATE INDEX "trip_summaries_members" ON "trip_summaries" USING gin ("members" jsonb_path_ops);--> statement-breakpoint
DROP INDEX "pending_embeddings_status";--> statement-breakpoint
DROP INDEX "trip_messages_trip_created";--> statement-breakpoint
DROP INDEX "trip_suggestion_changes_trip_status";
