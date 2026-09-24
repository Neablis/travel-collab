-- `api_idempotency_keys` — `Idempotency-Key` for `v1` writes that opt in
-- (ADR-051; first user: POST /v1/trips/{tripId}/playbook-applications).
--
-- One row per (user, key). It is inserted before the handler runs, so the
-- primary key is the lock that keeps two concurrent requests with one key from
-- both running; `completed_at` null means still in flight. A new, empty table:
-- no backfill, nothing rewritten.
CREATE TABLE "api_idempotency_keys" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "api_idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
