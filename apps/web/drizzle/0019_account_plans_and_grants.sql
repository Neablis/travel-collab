-- M20 link 2 — what an account holds, and who holds what they did not buy.
--
-- The Entitlements module's second store (ADR-045 rule 1). The committed file
-- `src/server/entitlements/planVersions.ts` says what a plan IS; these columns
-- and this table say what an account HAS. Neither answers the other's question.
--
-- No foreign keys, per the schema's standing convention — every user reference
-- in this database is a bare `text` upheld at the sign-in seam (ADR-025). This
-- table follows it rather than introducing the repo's first FK.
--
-- `users.plan_version` defaults to 1 as a floor for a row inserted by hand.
-- `upsertUser` passes the live version explicitly, which is what makes "a new
-- account gets v2" true once v2 is published.
--
-- NOTHING MAY DELETE FROM `entitlement_grants`. The trial is one time ever per
-- account and eligibility asks "has this account EVER held one", reading
-- expired and revoked rows alike. A cleanup job over this table hands a second
-- trial to everyone who ever had one, and it looks like generosity.

CREATE TABLE "entitlement_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"source" text NOT NULL,
	"granted_by" text,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_id" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "entitlement_grants_user" ON "entitlement_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_one_trial_ever" ON "entitlement_grants" USING btree ("user_id") WHERE "entitlement_grants"."source" = 'trial';--> statement-breakpoint
CREATE INDEX "entitlement_grants_source" ON "entitlement_grants" USING btree ("source");
--> statement-breakpoint
-- **The founder backfill** (M20's gate box: *"Every account existing at
-- migration time carries a permanent `founder` grant and loses no capability it
-- had the day before."*)
--
-- The day before this migration, `permitEverything` was the entitlement
-- resolver and every account could do everything. `premium@v1` is the version
-- that grants all three entitlements, so pinning the grant there is what makes
-- "loses no capability" literally true rather than approximately true.
--
-- `expires_at` NULL — permanent. A founder grant is not a trial and never lapses.
--
-- Idempotent: `NOT EXISTS` rather than a bare INSERT ... SELECT, so re-running
-- this migration against a database that already has it adds nothing. Drizzle
-- will not re-run it, but a restored snapshot replayed by hand might.
--
-- `gen_random_uuid()` is in core Postgres since 13 and is already used by
-- migration 0002.
INSERT INTO "entitlement_grants"
  ("id", "user_id", "plan_id", "plan_version", "source", "granted_by", "reason", "created_at", "expires_at")
SELECT
  gen_random_uuid(),
  u."id",
  'premium',
  1,
  'founder',
  NULL,
  'Account existed before entitlements were introduced (M20 migration 0019).',
  now(),
  NULL
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "entitlement_grants" g
  WHERE g."user_id" = u."id" AND g."source" = 'founder'
);
