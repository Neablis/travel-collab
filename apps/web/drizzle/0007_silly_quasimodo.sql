CREATE TABLE IF NOT EXISTS "trip_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_memberships" (
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_memberships_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trip_invites_token" ON "trip_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_invites_trip" ON "trip_invites" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_memberships_user" ON "trip_memberships" USING btree ("user_id");