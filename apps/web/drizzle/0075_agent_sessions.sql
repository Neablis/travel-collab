CREATE TABLE "agent_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"task" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"sid" text NOT NULL,
	"agent_user_id" text NOT NULL,
	"agent_id" text,
	"account_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_client_blocks" (
	"client_id" text PRIMARY KEY NOT NULL,
	"blocked_at" timestamp with time zone NOT NULL,
	"blocked_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "logo_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD COLUMN "token_endpoint_auth_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_feedback_created" ON "agent_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sessions_client_sid_user" ON "agent_sessions" USING btree ("client_id","sid","agent_user_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_last_seen" ON "agent_sessions" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_auth_method" CHECK ("oauth_grants"."token_endpoint_auth_method" in ('none', 'private_key_jwt'));