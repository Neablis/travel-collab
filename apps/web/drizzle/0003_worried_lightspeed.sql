CREATE TABLE IF NOT EXISTS "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"context" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_trip" ON "pages" USING btree ("trip_id");