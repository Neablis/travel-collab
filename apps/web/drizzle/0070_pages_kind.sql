-- The Overview is a column, not a field of `context` (M43 decision 2). Add it,
-- give it to the one Overview each trip has, take the old marker out of every
-- stored context, then let the database hold one Overview per trip.
ALTER TABLE "pages" ADD COLUMN "kind" text;--> statement-breakpoint
-- The backfill, and it answers what a replay of the log answers: the
-- projection writes a row's kind from its seed key (`pageKindOf` in
-- @tc/contracts), so the Overview is the row keyed `overview`. Migration 0032
-- already chose that row from `context->>'kind'`, one winner per trip — a
-- `system` page carrying the marker, oldest by the log — and the key has moved
-- with every replayed event since. A page a PERSON marked was never keyed, and
-- stays an ordinary notebook here as it does on a rebuild: that marker was the
-- hole decision 2 closes, a second undeletable Overview.
-- kind backfill: begin
UPDATE "pages" SET "kind" = 'overview' WHERE "seed_key" = 'overview';--> statement-breakpoint
-- The marker leaves the stored context. Events keep theirs (a log is never
-- rewritten); `pageContextOf` drops it on the way to a row.
UPDATE "pages" SET "context" = "context" - 'kind' WHERE "context" ? 'kind';
-- kind backfill: end
--> statement-breakpoint
CREATE UNIQUE INDEX "pages_overview_unique" ON "pages" USING btree ("trip_id") WHERE "pages"."kind" = 'overview';
