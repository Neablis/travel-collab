CREATE TABLE "external_data_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_modified" text,
	"source_updated_at" timestamp with time zone,
	"backoff_until" timestamp with time zone
);
