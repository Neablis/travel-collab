CREATE TABLE "trip_guests" (
	"trip_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"name" text NOT NULL,
	"travelling" boolean DEFAULT true NOT NULL,
	"linked_user_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "trip_guests_trip_id_guest_id_pk" PRIMARY KEY("trip_id","guest_id")
);
--> statement-breakpoint
CREATE INDEX "trip_guests_trip_idx" ON "trip_guests" USING btree ("trip_id");