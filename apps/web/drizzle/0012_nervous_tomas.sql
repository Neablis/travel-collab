CREATE TABLE IF NOT EXISTS "saved_day_adds" (
	"saved_day_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saved_day_adds_saved_day_id_trip_id_pk" PRIMARY KEY("saved_day_id","trip_id")
);
--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "cities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "adds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_days_cities" ON "saved_days" USING gin ("cities");