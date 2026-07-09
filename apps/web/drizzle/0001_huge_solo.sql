CREATE TABLE IF NOT EXISTS "trip_details" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL
);
