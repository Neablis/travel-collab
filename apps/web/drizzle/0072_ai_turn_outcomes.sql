-- What a person did with a turn's answer (M57 part 3, ADR-085): one row per
-- press or approval, joined to the turn by id; and the turn that stored an
-- assistant suggestion, nullable because rows before this have none.
CREATE TABLE "ai_turn_outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_suggestions" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
CREATE INDEX "ai_turn_outcomes_turn" ON "ai_turn_outcomes" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "ai_turn_outcomes_at" ON "ai_turn_outcomes" USING btree ("at");