CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"kind" text NOT NULL,
	"cimd_url" text,
	"registered_ip_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"first_used_at" timestamp with time zone,
	CONSTRAINT "oauth_clients_kind" CHECK ("oauth_clients"."kind" in ('dcr', 'cimd')),
	CONSTRAINT "oauth_clients_cimd_url" CHECK (("oauth_clients"."kind" = 'cimd') = ("oauth_clients"."cimd_url" is not null))
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] NOT NULL,
	"resource" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "oauth_grants_revoked_reason" CHECK ("oauth_grants"."revoked_reason" is null or ("oauth_grants"."revoked_at" is not null and "oauth_grants"."revoked_reason" in ('owner', 'code-reuse', 'refresh-reuse')))
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_tokens_kind" CHECK ("oauth_tokens"."kind" in ('access', 'refresh'))
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_cimd_url" ON "oauth_clients" USING btree ("cimd_url");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_codes_hash" ON "oauth_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_codes_grant" ON "oauth_codes" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_owner" ON "oauth_grants" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_hash" ON "oauth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant" ON "oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_revoked_reason" CHECK ("api_tokens"."revoked_reason" is null or ("api_tokens"."revoked_at" is not null and "api_tokens"."revoked_reason" in ('owner', 'storage-changed')));--> statement-breakpoint
-- **Every live `tc_` token is revoked, not upgraded** (ADR-083 §3). Rows minted
-- before this migration hold a scrypt digest the HMAC lookup can never find, so
-- they are cut off here with a reason the token list and the 401 can name. An
-- UPDATE, never a DELETE: the row is how its owner learns why an integration
-- stopped (`apiTokens.retention.test.ts`). Irreversible once applied: the
-- revocation is the point, and nothing restores a scrypt row to service.
--
-- **Dispatch `migrate-production` as soon as this merges.** The deploy reads
-- `api_tokens.revoked_reason` on every v1 request and every token list, which
-- fail until this has run.
UPDATE "api_tokens" SET "revoked_at" = now(), "revoked_reason" = 'storage-changed' WHERE "revoked_at" IS NULL;
