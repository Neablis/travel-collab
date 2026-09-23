-- M12 — reviews, reports, moderation and country search: every column and
-- table the milestone needs, in one migration (M12 D1-D9).
--
-- Reviews and reports are ordinary CRUD tables and never enter the event log:
-- neither is trip state (ADR-029's reasoning for saved days, one table over).
--
-- `saved_days.rating` / `review_count` are derived counters over
-- `saved_day_reviews`, recomputed with every review write, on `adds`' terms.
-- Every new `saved_days` column is nullable or carries a non-volatile default,
-- so each ADD COLUMN is metadata-only: no rewrite, and no backfill in here.
-- `countries` is backfilled separately, from `stops`, by the app's own
-- derivation — SQL cannot run `countriesOfStops`.
--
-- `UNIQUE NULLS NOT DISTINCT` needs Postgres 15+. Local (16) and CI (17) have
-- it; production's version was not checked when this was written, and an older
-- server fails this statement loudly rather than building a weaker constraint.
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_kind" text NOT NULL,
	"saved_day_id" uuid NOT NULL,
	"review_author_id" text,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	CONSTRAINT "content_reports_reporter_target" UNIQUE NULLS NOT DISTINCT("reporter_id","target_kind","saved_day_id","review_author_id"),
	CONSTRAINT "content_reports_target_shape" CHECK (("content_reports"."target_kind" = 'review') = ("content_reports"."review_author_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "saved_day_reviews" (
	"saved_day_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"stars" smallint NOT NULL,
	"note" text,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saved_day_reviews_saved_day_id_reviewer_id_pk" PRIMARY KEY("saved_day_id","reviewer_id"),
	CONSTRAINT "saved_day_reviews_stars" CHECK ("saved_day_reviews"."stars" between 1 and 5),
	CONSTRAINT "saved_day_reviews_note_length" CHECK (char_length("saved_day_reviews"."note") <= 140)
);
--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "rating" double precision;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "countries" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "moderation_note" text;--> statement-breakpoint
CREATE INDEX "content_reports_status" ON "content_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "saved_days_countries" ON "saved_days" USING gin ("countries");