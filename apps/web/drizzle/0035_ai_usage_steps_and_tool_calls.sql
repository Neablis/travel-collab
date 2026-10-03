-- The per-step and per-tool ledger (M31 Phase 1, ADR-062 §5).
--
-- ai_usage keeps one row per turn and gains latency_ms. Two child tables hang
-- off it by turn_id (= ai_usage.id): one row per agent step, with the model it
-- ran on and its cached-read tokens, and one row per tool call, with how it
-- ended and how big its input and result were. Composite primary keys, so a
-- replayed write upserts instead of adding a row.
--
-- Tokens and model ids, never dollars: price is a join against modelRates.ts
-- (usage.noMoney.test.ts covers both tables and this file). No content: sizes,
-- never the arguments or results. No user id on the child tables; the turn's
-- row carries it. No foreign keys, per ADR-025.

CREATE TABLE "ai_usage_steps" (
	"turn_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"model" text NOT NULL,
	"tier" text,
	"tokens_in" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"tokens_out" integer,
	"finish_reason" text,
	"escalated" boolean NOT NULL,
	"pivoted" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_usage_steps_turn_id_step_index_pk" PRIMARY KEY("turn_id","step_index")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_tool_calls" (
	"turn_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"step_index" integer,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer,
	"input_bytes" integer,
	"output_bytes" integer,
	"reached_proposal" boolean,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_usage_tool_calls_turn_id_call_id_pk" PRIMARY KEY("turn_id","call_id")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
CREATE INDEX "ai_usage_steps_created" ON "ai_usage_steps" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_tool_calls_created" ON "ai_usage_tool_calls" USING btree ("created_at");