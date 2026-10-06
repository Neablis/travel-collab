-- A playbook day's cover photo (M37 part 5): one row per saved day, set and
-- cleared by its author. Community CRUD beside saved_days, not a projection
-- and not an event, so rebuildProjections never touches it.
-- No foreign key, as saved_day_adds and saved_day_reviews have none:
-- saved_days is soft-deleted, so ON DELETE CASCADE would never fire. A
-- deleted or moderated day hides its cover because every read reaches this
-- table only through a day it may already show. The images are Unsplash CDN
-- URLs, hotlinked and never copied; the photographer's credit is stored with
-- them so no page view asks Unsplash for it. No backfill.

CREATE TABLE "saved_day_covers" (
	"saved_day_id" uuid PRIMARY KEY NOT NULL,
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
