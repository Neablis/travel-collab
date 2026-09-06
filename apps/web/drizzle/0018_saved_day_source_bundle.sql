-- `saved_days.source_bundle` — which content bundle a row was imported from,
-- or NULL for a day a person saved themselves.
--
-- Re-importing a bundle was ALREADY idempotent: every id is derived from
-- (bundle.id, key), so the write deletes exactly the rows it wrote last time
-- and rewrites them. What it could not do is notice a REMOVAL. Delete a
-- playbook from a bundle and its row simply stays in the database, with nothing
-- to distinguish it from a day somebody saved by hand, and so nothing that
-- could safely clean it up.
--
-- This column is what makes that answerable: everything from bundle X, minus
-- the ids bundle X currently declares, is exactly the set to remove.
--
-- Nullable with no default, deliberately. There is no sensible value for the
-- rows already here — they came from people, not from a file — and NULL is the
-- honest way to say so. `--prune` only ever considers rows where this is set,
-- so a person's saved day can never be caught by it.
ALTER TABLE "saved_days" ADD COLUMN "source_bundle" text;

-- The prune path asks "everything from this bundle", and Discover never does.
CREATE INDEX IF NOT EXISTS "saved_days_source_bundle_idx"
  ON "saved_days" ("source_bundle") WHERE "source_bundle" IS NOT NULL;
