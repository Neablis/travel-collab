CREATE TABLE "poll_closes" (
	"poll_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"closed_by" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "poll_closes_trip_id_poll_id_pk" PRIMARY KEY("trip_id","poll_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"option_ids" jsonb NOT NULL,
	"voted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_trip_poll_user" ON "poll_votes" USING btree ("trip_id","poll_id","user_id");