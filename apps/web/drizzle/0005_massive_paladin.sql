-- KI-6: `listPages`'s zero-rows seed guard is not atomic, so a database that
-- already hit the race holds duplicate system-seeded default pages, and the
-- unique index below cannot be created while they exist. Collapse each
-- (trip_id, title) system group to its earliest-created row — that is the one
-- the winning first request returned and that any deep link points at — and
-- drop the strictly redundant later copies. No-op on a clean database.
DELETE FROM "pages" a
USING "pages" b
WHERE a."actor_id" = 'system'
  AND b."actor_id" = 'system'
  AND a."trip_id" = b."trip_id"
  AND a."title" = b."title"
  AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pages_system_seed_unique" ON "pages" USING btree ("trip_id","title") WHERE "pages"."actor_id" = 'system';
