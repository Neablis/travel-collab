-- The read cursor becomes the pair the chat is listed by, `(created_at, id)`,
-- so a message stamped the same millisecond as the one marked read is still
-- unread. A separate migration, not an edit to 0048: previews had already run
-- 0048, and the migrator never re-runs an applied file.
--
-- The backfill is the largest uuid, which keeps an existing cursor meaning
-- exactly what it meant under 0048 (everything at or before `last_read_at` is
-- read): `(t, id) > (last_read_at, 'ffffffff-…')` holds iff `t > last_read_at`.
ALTER TABLE "trip_chat_reads" ADD COLUMN "last_read_id" uuid;--> statement-breakpoint
UPDATE "trip_chat_reads" SET "last_read_id" = 'ffffffff-ffff-ffff-ffff-ffffffffffff';--> statement-breakpoint
ALTER TABLE "trip_chat_reads" ALTER COLUMN "last_read_id" SET NOT NULL;
