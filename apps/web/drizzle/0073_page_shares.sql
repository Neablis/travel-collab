CREATE TABLE "page_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "page_shares_token" ON "page_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "page_shares_trip" ON "page_shares" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_shares_page_live" ON "page_shares" USING btree ("page_id") WHERE "page_shares"."revoked_at" is null;