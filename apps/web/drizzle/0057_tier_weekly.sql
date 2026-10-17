CREATE TABLE "tier_weekly" (
	"week_start" date NOT NULL,
	"plan_id" text NOT NULL,
	"accounts" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tier_weekly_week_plan" ON "tier_weekly" USING btree ("week_start","plan_id");