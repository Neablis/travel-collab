// Server-only: never import from UI code. Hybrid (dense + sparse) retrieval
// over the plan-retrieval RAG corpus (`day_embeddings`), Part 1 of the RAG
// stack. The embed side is `embeddings.ts`; the caller that spends the
// budget and injects the context is Part 4.
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

/** One retrieved day-chunk: a playbook or trip day the model can adapt from. */
export interface DayChunk {
  id: string;
  sourceType: "playbook" | "trip";
  sourceId: string;
  dayIndex: number;
  chunkText: string;
  city: string | null;
  countryCode: string | null;
  tags: string[];
  /** Reciprocal-rank-fusion score, higher is more relevant. Relative only. */
  score: number;
}

/** The RRF smoothing constant (the standard k=60): one shared leg can never dominate the fusion. */
const RRF_K = 60;

/**
 * The system account that owns seeded sample content (Mitchell's decision,
 * 2026-10-16: "anything owned by that id is owned by everyone"). Chunks with
 * this owner are treated as public: visible to every reader, including
 * logged-out, in both the playbook and trip legs of the privacy filter.
 */
export const PUBLIC_LIBRARY_OWNER_ID = "service-ai-library";

// The privacy predicate, written ONCE and interpolated into both legs.
// Duplicating it per leg would let a later edit change one leg's idea of
// who may see a chunk and not the other's — the privacy invariant is the
// one thing in this query that must never drift between legs.
const privacyFilter = (userId: string | null) => sql`
  (
    (source_type = 'playbook' AND (
      visibility = 'public'
      OR owner_id = ${userId}
      OR owner_id = ${PUBLIC_LIBRARY_OWNER_ID}
    ))
    OR (source_type = 'trip' AND (
      owner_id = ${userId}
      OR owner_id = ${PUBLIC_LIBRARY_OWNER_ID}
      OR EXISTS (
        SELECT 1 FROM trip_memberships
        WHERE trip_memberships.trip_id = day_embeddings.source_id
          AND trip_memberships.user_id = ${userId}
      )
    ))
  )
`;

/**
 * The top-k day-chunks for a plan query, fused from two ranked legs:
 *
 * - **Dense:** cosine distance (`<=>`) between the query embedding and the
 *   chunk's, served by the HNSW index, top 2k.
 * - **Sparse:** full-text rank (`ts_rank` over `plainto_tsquery('english')`),
 *   top 2k.
 * - **Fusion:** reciprocal rank fusion, `1 / (RRF_K + rank)` summed over
 *   both legs — a chunk found by both legs outranks one found by either
 *   alone, and a leg that ranks something 2nd vs 200th barely differs,
 *   which is the property that makes RRF robust to the legs' different
 *   score scales. (The fused subquery is aliased `legs`: `both` is a
 *   reserved word in Postgres — `TRIM(BOTH ...)` — and cannot be a bare
 *   alias.)
 *
 * **Privacy is enforced in the query, in the app layer — not Postgres RLS**
 * (this codebase has no RLS precedent). A chunk is visible when:
 * - it is a playbook day that is public, or the reader owns it; or
 * - it is a trip day and the reader is the trip's owner (Part 2 records
 *   `owner_id` at write time — the owner has no `trip_memberships` row, so
 *   membership alone would hide their own trip from them) or a member; or
 * - it is owned by `PUBLIC_LIBRARY_OWNER_ID` (the system account holding
 *   seeded sample content) — treated as public for every reader, including
 *   logged-out.
 * Logged out (`userId: null`) sees public playbook days and public-library
 * days only: the `owner_id = NULL` and `user_id = NULL` comparisons can
 * never match.
 *
 * **This function is total: it never throws.** A database error returns
 * `[]` (logged) — the caller treats "no examples" as a normal case and
 * generates from scratch, today's path. The 2s latency budget is enforced
 * by the CALLER (Part 4's serving path), not here: a retrieval helper that
 * races itself would double the failure modes.
 */
export async function retrieveDayChunks({
  queryEmbedding,
  queryText,
  userId,
  k = 8,
  excludeSourceIds = [],
}: {
  queryEmbedding: number[];
  queryText: string;
  userId: string | null;
  k?: number;
  /**
   * `day_embeddings.source_id` values to exclude from retrieval. Used by the
   * Gate 1 eval to keep test trips out of the production corpus; the serving
   * path does not pass it. Excluded chunks never consume rank positions.
   */
  excludeSourceIds?: string[];
}): Promise<DayChunk[]> {
  // node-postgres serializes a JS array as a Postgres array literal
  // (`{1,2,3}`), which does NOT cast to `vector` — pgvector only accepts its
  // own text form (`[1,2,3]`). Build that form here and cast at the bind.
  const queryVector = `[${queryEmbedding.join(",")}]`;
  const legLimit = 2 * k;
  // Test-source exclusion for the eval: omitted entirely when the list is
  // empty (`NOT IN ()` is invalid SQL), applied in both legs otherwise so
  // excluded chunks never consume RRF rank positions.
  const exclusion =
    excludeSourceIds.length > 0
      ? sql`AND source_id NOT IN (${sql.join(
          excludeSourceIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  try {
    const { rows } = await db.execute<{
      id: string;
      source_type: string;
      source_id: string;
      day_index: number;
      chunk_text: string;
      city: string | null;
      country_code: string | null;
      tags: string[];
      score: number;
    }>(sql`
      WITH
      dense AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> (${queryVector}::vector), id) AS rnk
        FROM day_embeddings
        WHERE embedding IS NOT NULL
          AND ${privacyFilter(userId)}
          ${exclusion}
        ORDER BY embedding <=> (${queryVector}::vector), id
        LIMIT ${legLimit}
      ),
      sparse AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(fts, q) DESC, id) AS rnk
        FROM day_embeddings, plainto_tsquery('english', ${queryText}) AS q
        WHERE fts @@ q
          AND ${privacyFilter(userId)}
          ${exclusion}
        ORDER BY ts_rank(fts, q) DESC, id
        LIMIT ${legLimit}
      ),
      fused AS (
        SELECT id, COALESCE(SUM(1.0 / (${RRF_K} + rnk)), 0)::float8 AS score
        FROM (
          SELECT id, rnk FROM dense
          UNION ALL
          SELECT id, rnk FROM sparse
        ) AS legs
        GROUP BY id
      )
      SELECT
        e.id, e.source_type, e.source_id, e.day_index, e.chunk_text,
        e.city, e.country_code, e.tags, fused.score
      FROM fused
      JOIN day_embeddings AS e ON e.id = fused.id
      ORDER BY fused.score DESC, e.id
      LIMIT ${k}
    `);
    return rows.map((r) => ({
      id: r.id,
      sourceType: r.source_type as DayChunk["sourceType"],
      sourceId: r.source_id,
      dayIndex: r.day_index,
      chunkText: r.chunk_text,
      city: r.city,
      countryCode: r.country_code,
      tags: r.tags,
      score: r.score,
    }));
  } catch (error) {
    // Fail-open: retrieval is a cost optimization and must never break a
    // turn. The log is the record; the caller proceeds without examples.
    console.error("rag: retrieval failed, continuing without examples", { error });
    return [];
  }
}
