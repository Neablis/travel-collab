ALTER TABLE "trip_messages" ADD COLUMN "kind" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD COLUMN "reply_to" uuid;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD COLUMN "suggestion_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_suggestions" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD CONSTRAINT "trip_messages_kind" CHECK ("trip_messages"."kind" in ('member', 'assistant', 'system'));