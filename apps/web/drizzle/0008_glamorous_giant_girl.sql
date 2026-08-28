CREATE TABLE IF NOT EXISTS "trip_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"token" text NOT NULL,
	"seq" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trip_shares_token" ON "trip_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_shares_trip" ON "trip_shares" USING btree ("trip_id");