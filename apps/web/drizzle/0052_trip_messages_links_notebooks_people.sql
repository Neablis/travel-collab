ALTER TABLE "trip_messages" DROP CONSTRAINT "trip_messages_link_kind";--> statement-breakpoint
ALTER TABLE "trip_messages" ALTER COLUMN "link_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD CONSTRAINT "trip_messages_link_kind" CHECK ("trip_messages"."link_kind" in ('day', 'stop', 'notebook', 'person'));