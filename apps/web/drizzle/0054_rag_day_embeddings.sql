-- pgvector ships the `vector` type and its operators. Neon's project gets it
-- from the SQL editor (`CREATE EXTENSION vector;`, which Mitchell ran on
-- the Neon project himself); CI's service image (`pgvector/pgvector:pg17`)
-- and the local dev DB carry it too. `IF NOT EXISTS` so the migrator stays
-- idempotent on a database that already has it.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "day_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536),
	"fts" "tsvector",
	"city" text,
	"country_code" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"owner_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "day_embeddings_source_day" UNIQUE("source_type","source_id","day_index"),
	CONSTRAINT "day_embeddings_source_type" CHECK ("day_embeddings"."source_type" in ('playbook', 'trip'))
);
--> statement-breakpoint
CREATE TABLE "pending_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pending_embeddings_source_day" UNIQUE("source_type","source_id","day_index"),
	CONSTRAINT "pending_embeddings_status" CHECK ("pending_embeddings"."status" in ('pending','processing','done','dead'))
);
--> statement-breakpoint
CREATE INDEX "day_embeddings_embedding" ON "day_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "day_embeddings_fts" ON "day_embeddings" USING gin ("fts");--> statement-breakpoint
CREATE INDEX "pending_embeddings_status" ON "pending_embeddings" USING btree ("status");