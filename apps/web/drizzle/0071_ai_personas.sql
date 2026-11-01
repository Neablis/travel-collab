-- The ledger knows the persona (M57 part 2, ADR-085): where a turn entered,
-- which persona each step ran as and the edge it crossed to get there, and
-- capability gaps as rows rather than only a log line. Every new column is
-- nullable: rows written before this have no persona to report.
CREATE TABLE "ai_capability_gaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"persona" text NOT NULL,
	"target" text NOT NULL,
	"task" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "entry_persona" text;--> statement-breakpoint
ALTER TABLE "ai_usage_steps" ADD COLUMN "persona" text;--> statement-breakpoint
ALTER TABLE "ai_usage_steps" ADD COLUMN "from_persona" text;--> statement-breakpoint
ALTER TABLE "ai_usage_steps" ADD COLUMN "edge_kind" text;--> statement-breakpoint
CREATE INDEX "ai_capability_gaps_turn" ON "ai_capability_gaps" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "ai_capability_gaps_created" ON "ai_capability_gaps" USING btree ("created_at");