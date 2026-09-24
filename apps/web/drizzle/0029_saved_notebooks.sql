CREATE TABLE "saved_notebooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"doc_version" integer NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"source_trip_id" uuid NOT NULL,
	"source_trip_name" text NOT NULL,
	"source_page_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "saved_notebooks_owner" ON "saved_notebooks" USING btree ("owner_id");