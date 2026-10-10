CREATE TABLE "trip_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_snapshots_name_length" CHECK (char_length("trip_snapshots"."name") between 1 and 80),
	CONSTRAINT "trip_snapshots_seq_positive" CHECK ("trip_snapshots"."seq" > 0)
);
--> statement-breakpoint
CREATE INDEX "trip_snapshots_trip_created" ON "trip_snapshots" USING btree ("trip_id","created_at");