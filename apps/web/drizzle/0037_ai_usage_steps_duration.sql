-- Per-step wall time on the step ledger (M32).
--
-- duration_ms is the milliseconds from the previous step's end (step 0: the
-- agent's start, after admission and the classifier) to this step's end, its
-- tool calls included. Model time is this less the step's tool-call durations
-- in ai_usage_tool_calls. A 162-second turn on 2026-10-04 had three steps and
-- nothing to say which was slow. Nullable: rows written before this have none.

ALTER TABLE "ai_usage_steps" ADD COLUMN "duration_ms" integer;