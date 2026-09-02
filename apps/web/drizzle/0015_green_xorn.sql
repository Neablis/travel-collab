ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_airport" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "distance_unit" text DEFAULT 'km' NOT NULL;