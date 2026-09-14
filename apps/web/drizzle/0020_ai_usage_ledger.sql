-- M20 link 9 — what an account costs. One row per AI request.
--
-- TOKENS AND MODEL IDS, NEVER DOLLARS. Prices move: DeepSeek's rates for the
-- configured model changed on 2026-08-16, mid-scoping. A stored dollar figure
-- freezes one price into history, cannot be re-derived, and silently corrupts
-- the series the day a model changes. Price is a JOIN against a dated
-- append-only rate record (src/server/entitlements/modelRates.ts), performed
-- at read time, as at a point in time.
--
-- And `Money` in particular must not be used: ADR-008 defines it in integer
-- minor units, and a live request costs $0.0006 — which rounds to zero. Every
-- request would record as free.
--
-- Nullable token columns mean "the provider reported no usage", never zero.
-- Zero is a measurement, and a rate join has to be able to tell them apart.
--
-- No question text and no trip content: there is no column one could go in.
--
-- No foreign keys, per the schema's standing convention (ADR-025).

CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"outcome" text NOT NULL,
	"task_class" text NOT NULL,
	"turn_model" text NOT NULL,
	"turn_tokens_in" integer,
	"turn_tokens_out" integer,
	"classifier_model" text,
	"classifier_tokens_in" integer,
	"classifier_tokens_out" integer,
	"steps" integer NOT NULL,
	"plan_version_ref" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_usage_user_created" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");