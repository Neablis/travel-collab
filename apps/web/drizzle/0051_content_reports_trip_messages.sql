ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_reporter_target";--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_shape";--> statement-breakpoint
ALTER TABLE "content_reports" ALTER COLUMN "saved_day_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "trip_message_id" uuid;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_target" UNIQUE NULLS NOT DISTINCT("reporter_id","target_kind","saved_day_id","review_author_id","trip_message_id");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_shape" CHECK (("content_reports"."target_kind" = 'saved_day' and "content_reports"."saved_day_id" is not null and "content_reports"."review_author_id" is null and "content_reports"."trip_id" is null and "content_reports"."trip_message_id" is null)
        or ("content_reports"."target_kind" = 'review' and "content_reports"."saved_day_id" is not null and "content_reports"."review_author_id" is not null and "content_reports"."trip_id" is null and "content_reports"."trip_message_id" is null)
        or ("content_reports"."target_kind" = 'trip_message' and "content_reports"."saved_day_id" is null and "content_reports"."review_author_id" is null and "content_reports"."trip_id" is not null and "content_reports"."trip_message_id" is not null));