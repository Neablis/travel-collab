ALTER TABLE "users" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_display_name" boolean DEFAULT false NOT NULL;