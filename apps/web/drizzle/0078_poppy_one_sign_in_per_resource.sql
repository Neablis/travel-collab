-- Poppy 1.0 §4.5: one sign-in for every resource. A Personal Agent that names
-- no resource at sign-in covers every resource, so its grant needs
-- `covers_all_resources`, its code needs a nullable `resource` (null binds to
-- none), and each access token needs its own `resource` (the audience it was
-- minted for). Refresh tokens stay null: they are not audience-bound.
--
-- Backfill: every access token minted before this column takes its grant's
-- resource, which is exactly the audience it was issued for under the old
-- single-resource rule. Re-runnable: a re-run sets the same value.
ALTER TABLE "oauth_codes" ALTER COLUMN "resource" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD COLUMN "covers_all_resources" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "resource" text;--> statement-breakpoint
UPDATE "oauth_tokens" SET "resource" = "oauth_grants"."resource" FROM "oauth_grants" WHERE "oauth_tokens"."grant_id" = "oauth_grants"."id" AND "oauth_tokens"."kind" = 'access';
