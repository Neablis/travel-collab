CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL
);
