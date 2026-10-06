-- One row per client unit of work applied to a trip, keyed by the id the
-- client minted for it (ADR-066, KI-5). Written in the same transaction as the
-- unit's events; the primary key is what stops a page and its unload flush
-- from both applying the same unit. No backfill: units sent before this
-- shipped carried no key.

CREATE TABLE "command_receipts" (
	"trip_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "command_receipts_trip_id_key_pk" PRIMARY KEY("trip_id","key")
);
