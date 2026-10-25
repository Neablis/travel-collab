ALTER TABLE "saved_day_covers" ALTER COLUMN "unsplash_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ALTER COLUMN "url_raw" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ALTER COLUMN "url_regular" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ALTER COLUMN "url_small" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ALTER COLUMN "photographer_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ALTER COLUMN "photographer_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ALTER COLUMN "photo_page_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "unsplash_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "url_raw" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "url_regular" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "url_small" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "photographer_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "photographer_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ALTER COLUMN "photo_page_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD COLUMN "source" text DEFAULT 'unsplash' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD COLUMN "credit_name" text;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD COLUMN "credit_url" text;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD COLUMN "position" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ADD COLUMN "source" text DEFAULT 'unsplash' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_covers" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "trip_covers" ADD COLUMN "credit_name" text;--> statement-breakpoint
ALTER TABLE "trip_covers" ADD COLUMN "credit_url" text;--> statement-breakpoint
ALTER TABLE "trip_covers" ADD COLUMN "position" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD CONSTRAINT "saved_day_covers_source" CHECK (("saved_day_covers"."source" = 'unsplash' and "saved_day_covers"."unsplash_id" is not null and "saved_day_covers"."url_raw" is not null and "saved_day_covers"."url_regular" is not null and "saved_day_covers"."url_small" is not null and "saved_day_covers"."photographer_name" is not null and "saved_day_covers"."photographer_url" is not null and "saved_day_covers"."photo_page_url" is not null) or ("saved_day_covers"."source" = 'url' and "saved_day_covers"."url" is not null));--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD CONSTRAINT "saved_day_covers_credit" CHECK ("saved_day_covers"."credit_url" is null or "saved_day_covers"."credit_name" is not null);--> statement-breakpoint
ALTER TABLE "saved_day_covers" ADD CONSTRAINT "saved_day_covers_position" CHECK ("saved_day_covers"."position" between 0 and 100);--> statement-breakpoint
ALTER TABLE "trip_covers" ADD CONSTRAINT "trip_covers_source" CHECK (("trip_covers"."source" = 'unsplash' and "trip_covers"."unsplash_id" is not null and "trip_covers"."url_raw" is not null and "trip_covers"."url_regular" is not null and "trip_covers"."url_small" is not null and "trip_covers"."photographer_name" is not null and "trip_covers"."photographer_url" is not null and "trip_covers"."photo_page_url" is not null) or ("trip_covers"."source" = 'url' and "trip_covers"."url" is not null));--> statement-breakpoint
ALTER TABLE "trip_covers" ADD CONSTRAINT "trip_covers_credit" CHECK ("trip_covers"."credit_url" is null or "trip_covers"."credit_name" is not null);--> statement-breakpoint
ALTER TABLE "trip_covers" ADD CONSTRAINT "trip_covers_position" CHECK ("trip_covers"."position" between 0 and 100);