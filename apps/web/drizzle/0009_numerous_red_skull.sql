CREATE TABLE IF NOT EXISTS "saved_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"stops" jsonb NOT NULL,
	"source_trip_id" uuid NOT NULL,
	"source_trip_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_days_owner" ON "saved_days" USING btree ("owner_id");