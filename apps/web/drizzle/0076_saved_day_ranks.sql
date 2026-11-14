CREATE TABLE "saved_day_ranks" (
	"saved_day_id" uuid PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"adds_recent" double precision NOT NULL,
	"comments_recent" double precision NOT NULL,
	"quality" double precision NOT NULL,
	"new_day_lift" double precision NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "first_published_at" timestamp with time zone;
--> statement-breakpoint
-- M61 decision 11: a day already public has been published at least since its
-- current `published_at`, which is the best date this table still holds.
UPDATE "saved_days" SET "first_published_at" = "published_at" WHERE "published_at" IS NOT NULL;
