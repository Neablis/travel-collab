CREATE TABLE IF NOT EXISTS "events" (
	"global_seq" bigserial PRIMARY KEY NOT NULL,
	"stream_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_summaries" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"members" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_stream_seq" ON "events" USING btree ("stream_id","seq");