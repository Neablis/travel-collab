CREATE TABLE "trip_suggestion_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"commands" jsonb NOT NULL,
	"description" text NOT NULL,
	"depends_on" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trip_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"note" text,
	"base_seq" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_suggestion_changes" ADD CONSTRAINT "trip_suggestion_changes_suggestion_id_trip_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."trip_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_suggestion_changes_trip_status" ON "trip_suggestion_changes" USING btree ("trip_id","status");--> statement-breakpoint
CREATE INDEX "trip_suggestion_changes_suggestion" ON "trip_suggestion_changes" USING btree ("suggestion_id");