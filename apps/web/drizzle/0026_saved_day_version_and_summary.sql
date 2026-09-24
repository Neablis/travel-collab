-- `saved_days.version` and `saved_days.summary` — Playbook content edits over
-- `v1` (ADR-050, Pass A).
--
-- `version` is the content revision an editor must name (`expectedVersion`) to
-- change a Playbook's name, summary or days; the UPDATE that bumps it is guarded
-- by `version = expectedVersion`, so the compare and the write are one
-- statement. Every existing row is "never edited", which is what 1 says, and a
-- NOT NULL column with a constant default is metadata-only — no rewrite, no
-- backfill (`0024_saved_day_day_count`'s reasoning).
--
-- `summary` is one authored paragraph. Nullable, because "no summary" is the
-- state of every existing row; its 500-character bound lives in the contract,
-- beside `name`'s, rather than in a CHECK.
ALTER TABLE "saved_days" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN "summary" text;
