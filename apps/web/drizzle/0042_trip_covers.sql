-- A trip's cover photo (M37 D1-D3): one row per trip, set and cleared by an
-- editor. Ordinary CRUD, not a projection: a cover is a decoration, not a plan
-- fact, so it is never an event and rebuildProjections never touches it.
-- No foreign key, as trip_travellers (0039) has none: the only table keyed by
-- trip id is trip_summaries, a projection a rebuild deletes and re-inserts, so
-- ON DELETE CASCADE to it would wipe every cover on every rebuild. The images
-- are Unsplash CDN URLs, hotlinked and never copied; the photographer's credit
-- is stored with them so no page view asks Unsplash for it. No backfill.

CREATE TABLE "trip_covers" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"unsplash_id" text NOT NULL,
	"url_raw" text NOT NULL,
	"url_regular" text NOT NULL,
	"url_small" text NOT NULL,
	"alt" text,
	"photographer_name" text NOT NULL,
	"photographer_url" text NOT NULL,
	"photo_page_url" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL
);
