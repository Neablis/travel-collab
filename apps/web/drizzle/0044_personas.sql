ALTER TABLE "users" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_display_name" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- M38 D2, as Mitchell answered it on 2026-10-08: the library already printed a
-- chosen display name before this column existed, so everyone who has one is
-- opted in. No public name changes at deploy; a name chosen from now on starts
-- private.
UPDATE "users" SET "public_display_name" = true WHERE "display_name" IS NOT NULL;
