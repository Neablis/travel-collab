-- `trip_summaries.start_date` — the trip's first calendar day on the summary
-- read model (KI-034), so Home can choose its "Next trip" by date and a trip
-- card can print the date instead of "Created …".
--
-- Nullable: "undated" is a real state, and the state of every trip that never
-- had a date set. `text`, not `date`, because the value is copied from a
-- `TripStartDateSet` event, whose contract checks shape only — a `date` cast
-- could refuse a row that history is allowed to hold.
--
-- The backfill reads the value the other projection already carries.
-- `trip_details` is rebuilt from the same log in the same transaction as
-- `trip_summaries`, so its `startDate` is exactly what a replay of
-- `TripStartDateSet` would give this column; a `rebuildProjections` run
-- afterwards writes the same values. `->>` of a JSON null is SQL NULL, so an
-- undated trip stays NULL.
ALTER TABLE "trip_summaries" ADD COLUMN "start_date" text;--> statement-breakpoint
UPDATE "trip_summaries" AS s
SET "start_date" = d."doc"->>'startDate'
FROM "trip_details" AS d
WHERE d."trip_id" = s."trip_id";
