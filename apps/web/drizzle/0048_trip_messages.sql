CREATE TABLE "trip_chat_reads" (
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_chat_reads_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "trip_chat_revs" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"rev" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"link_kind" text,
	"link_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "trip_messages_link_kind" CHECK ("trip_messages"."link_kind" in ('day', 'stop')),
	CONSTRAINT "trip_messages_link_whole" CHECK (("trip_messages"."link_kind" is null) = ("trip_messages"."link_id" is null))
);
--> statement-breakpoint
CREATE INDEX "trip_messages_trip_created" ON "trip_messages" USING btree ("trip_id","created_at");