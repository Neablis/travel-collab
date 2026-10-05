-- Which AI Gateway provider served each step, and the Gateway's generation id.
--
-- The Gateway sells one model through many providers at different prices
-- (zai/glm-5.3-flash: $0.075-0.45 in per MTok across ~20 of them), so the
-- model id alone does not say what a step was billed at. provider is
-- providerMetadata.gateway.routing.finalProvider; gateway_generation_id is
-- the id the billed cost is looked up by (GET /v1/generation). No dollar is
-- stored: usage.noMoney.test.ts still holds. Nullable: rows before this, and
-- steps that did not go through the Gateway, have none.

ALTER TABLE "ai_usage_steps" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "ai_usage_steps" ADD COLUMN "gateway_generation_id" text;