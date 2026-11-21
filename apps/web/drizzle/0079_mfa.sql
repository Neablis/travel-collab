CREATE TABLE "mfa_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"reason" text NOT NULL,
	"email_confirmation" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"credential_id" text,
	"public_key" text,
	"counter" integer,
	"transports" text[],
	"sealed_secret" text,
	"last_used_step" integer,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"key_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "mfa_attempts_user_at" ON "mfa_attempts" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "mfa_resets_user" ON "mfa_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_factors_user" ON "user_factors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_factors_credential" ON "user_factors" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "user_recovery_codes_user" ON "user_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_recovery_codes_hash" ON "user_recovery_codes" USING btree ("code_hash");