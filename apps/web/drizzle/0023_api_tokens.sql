-- M22 Phase 1 — scoped account API tokens.
--
-- A bearer credential an account mints for itself, scoped to what it may do and
-- to which trips it may touch. Shaped on `trip_shares`, which is the closest
-- structural precedent, and breaking with it on exactly one thing.
--
-- THE SECRET IS HASHED, AND THAT IS THE BREAK. `trip_invites` and `trip_shares`
-- store their tokens in plaintext and say why: the owner's invite list has to
-- re-show a link they already handed out. That reason does not transfer. An API
-- token is shown once at creation and never again, so nothing needs to re-show
-- it and nothing needs to store it. `token_hash` is `sha256(secret)` and
-- `prefix` is the first eight characters, for a list a person can read.
--
-- SHA-256 RATHER THAN A SLOW KDF, deliberately. The secret is 256 bits of
-- CSPRNG output, so there is no low-entropy space to brute-force; bcrypt or
-- argon2 would buy nothing and cost real latency on every API request.
--
-- `expires_at` IS NOT NULL BECAUSE EXPIRY IS MANDATORY (Decision 13). There is
-- no "never expires" to represent, so there is no null that could mean it. The
-- 365-day ceiling is enforced where the token is minted; a longer request is a
-- 400, never a silent clamp.
--
-- NOTHING MAY SWEEP THIS TABLE. Expiry and revocation are resolved on read —
-- the `entitlement_grants` rule two migrations back — and here it carries a
-- second reason of its own: an expired token is REFUSED, not deleted, so its
-- owner can still see what lapsed and understand why an integration stopped. A
-- cleanup job would erase exactly the evidence the person needs.
--
-- THERE IS NO PLAN COLUMN AND THERE MUST NEVER BE ONE. Whether the owner may
-- use a token is resolved per request from the database, never cached on this
-- row and never read from a JWT (M20's third rule). A token lives for months,
-- so a cached entitlement here would be a downgrade that never bites.
--
-- No foreign key on `owner_id`, per the standing convention (ADR-025).

CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"trip_ids" uuid[],
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_owner" ON "api_tokens" USING btree ("owner_id");