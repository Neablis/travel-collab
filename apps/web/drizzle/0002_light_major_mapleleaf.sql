ALTER TABLE "events" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "origin" jsonb;--> statement-breakpoint
UPDATE "events" SET "batch_id" = gen_random_uuid(), "origin" = '{"kind":"user"}'::jsonb;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "batch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "origin" SET NOT NULL;
