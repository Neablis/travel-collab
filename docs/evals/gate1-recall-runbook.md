# Gate 1 runbook: offline recall@5 for plan retrieval

**What this decides.** Whether the RAG stack continues. The eval runs 25
hand-labeled plan queries through `embedText` → `retrieveDayChunks` and
reports macro-averaged recall@5.

- **PASS (≥ 0.7)** — the stack resumes (Part 4, serving).
- **FAIL (< 0.7)** — the stack STOPS. The report shows exactly which queries
  missed, which is the diagnosis input; do not re-tune and re-run until the
  miss pattern is understood.

Two modes: **fixture** (default — seeds fixtures into a throwaway DB) and
**production** (`RECALL_EVAL_PRODUCTION=1` — runs against your live Neon
database with real data). The production path is recommended: it measures
recall on the corpus that will actually serve.

## Production mode (recommended)

Prerequisites: branch `sunny/rag-part3-gate1`, Node 22, pnpm, and
`TRAVEL_COLLAB_EVAL_KEY` (a Vercel AI Gateway key).

**Step 0 — backfill the corpus.** The eval measures against `day_embeddings`;
production mode does not embed anything itself. Run the Part 2 backfill
against Neon first (this is the same backfill that runs before launch):

```sh
DATABASE_URL=<your-neon-url> pnpm --filter web db:backfill-embeddings
```

It prints the chunk count before embedding. This makes paid embedding calls
(once per day-chunk); the sweep is idempotent, so re-running is safe.

**Step 1 — find your user id.** The eval reads as `RECALL_EVAL_USER_ID` so
trip-day labels pass the privacy filter (the fixture default `eval-actor`
owns no production trips). In Neon's SQL editor:

```sql
SELECT id, email FROM users WHERE email = '<your-email>';
```

**Step 2 — run the eval.**

```sh
RECALL_EVAL_PRODUCTION=1 RECALL_EVAL_USER_ID=<your-user-id> \
  RECALL_EVAL_CONFIRM=1 TRAVEL_COLLAB_EVAL_KEY=<your-key> \
  DATABASE_URL=<your-neon-url> \
  pnpm --filter web eval -- planRetrieval.recall
```

What happens: the eval verifies `day_embeddings` is non-empty (fails loud
otherwise — an empty corpus would score a lying 0), resolves all 25 labels
by name against your live `saved_days` / `trip_details` (fails loud on any
missing or ambiguous name), then embeds and retrieves each query. Only the
25 query embeds are paid in this mode.

Expected output:

```
recall eval plan (production mode): 25 querie(s) x embed+retrieve@5, corpus = live database, ≈25 paid embedding calls ...
    production corpus: 231 embedded day-chunk(s)
    q-01 recall@5 1.00 (3/3): plan a 6-day food trip to Tokyo
    ...
recall eval: 25 queries, macro recall@5 = 0.84 — PASS (bar 0.7)
report: apps/web/eval-results/recall-gate1-<timestamp>.json
```

**Label resolution failures.** Five queries (q-01, q-09, q-18, q-19, q-20)
are labeled against a Japan trip (`"Japan (recall eval)"`). If you don't
have a Japan trip in production, those labels fail to resolve and the run
throws before spending. Options: seed the Japan fixture trip (it's the same
14-day trip the fixture mode uses — clearly named, delete it after), or
exclude those queries with `RECALL_EVAL_ONLY`.

## Fixture mode (default)

**What it costs.** 187 embedding calls on `openai/text-embedding-3-small`
(162 chunk embeds + 25 query embeds, ~150k tokens total — on the order of
cents at the published rate). Nothing else is paid: retrieval is local
Postgres, and the database is a throwaway the lane provisions and drops.

### Prerequisites

- Node 22, pnpm (the repo's pinned versions), on branch `sunny/rag-part3-gate1`.
- **Local Postgres 17 with pgvector.** The repo's `docker-compose.yml` ships
  plain `postgres:17`, which is NOT enough — migration 0054 runs
  `CREATE EXTENSION IF NOT EXISTS vector;`, which fails without the extension
  files. Run pgvector's image instead (a separate container, so the compose
  DB is untouched):

  ```sh
  docker run -d --name travel-pgvector \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=travel \
    -p 5433:5432 pgvector/pgvector:pg17
  ```

  Point `DATABASE_URL` at it (the lane reads `.env.local` first, then the
  environment; `postgresql://postgres:postgres@127.0.0.1:5433/travel` matches
  the repo's default port). The lane refuses non-local hosts — this never
  touches Neon.

- `TRAVEL_COLLAB_EVAL_KEY` — a Vercel AI Gateway key kept for evals, so eval
  spend never lands on production's key (the eval lane's convention;
  `vitest.eval.config.ts` maps it to `AI_GATEWAY_API_KEY` for the run).

### Step 1 — install

```sh
pnpm install
```

No manual `db:migrate`: the eval wrapper builds a migrated template database
on first run (including the `vector` extension via migration 0054) and clones
a throwaway copy per run, then drops it.

### Step 2 — run the eval

```sh
RECALL_EVAL_CONFIRM=1 TRAVEL_COLLAB_EVAL_KEY=<your-key> \
  pnpm --filter web eval -- planRetrieval.recall
```

What happens, in order: the wrapper provisions the throwaway DB; the eval
prints its plan (query count, corpus size, paid-call estimate) and refuses to
spend without `RECALL_EVAL_CONFIRM=1`; it seeds the corpus (the 19 bundles
under `content/playbooks/` through the importer's own server-side writers,
plus the 14-day Japan fixture trip); it drains the embed queue through the
production sweep (`runEmbedSweep`, the same function the cron route calls);
then it embeds and retrieves each query.

Expected output:

```
recall eval plan (fixture mode): 25 querie(s) x embed+retrieve@5, corpus ~162 day-chunks ...
    seeded 148 bundle playbook day(s) + 14 Japan trip day(s) = 162 chunks
    sweep pass 1: claimed 162, embedded 162, retried 0, dead 0, tombstoned 0
    q-01 recall@5 1.00 (3/3): plan a 6-day food trip to Tokyo
    ...
recall eval: 25 queries, macro recall@5 = 0.84 — PASS (bar 0.7)
report: apps/web/eval-results/recall-gate1-<timestamp>.json
```

Rough duration: a few minutes (162 chunk embeds dominate; the 25 queries are
seconds). The JSON report (git-ignored) carries per-query recall, hits,
misses, and the retrieved chunk ids for diagnosis.

To debug one query without paying for the corpus twice on a re-run (each run
re-embeds — the throwaway DB is dropped):

```sh
RECALL_EVAL_CONFIRM=1 RECALL_EVAL_ONLY=q-07 TRAVEL_COLLAB_EVAL_KEY=<key> \
  pnpm --filter web eval -- planRetrieval.recall
```

## Step 3 — report the number back

Reply with the macro recall@5 and the verdict line, plus the report path.
PASS ≥ 0.7 resumes the stack; FAIL < 0.7 stops it — attach the per-query
misses from the report either way.

## Troubleshooting

- **`CREATE EXTENSION vector` fails / migration 0054 errors.** The local
  Postgres is not the pgvector image. `docker ps` should show
  `pgvector/pgvector:pg17`; the repo's `docker-compose.yml` postgres is plain
  `postgres:17` and will not work. (On Neon this step was already done —
  `CREATE EXTENSION vector;` in the SQL editor.)
- **`TRAVEL_COLLAB_EVAL_KEY is not set.`** The lane refuses before anything is
  sent — set the key and re-run. (An *invalid* key surfaces later: every
  query "would not embed" and the run fails loudly rather than scoring zeros.)
- **Production: `day_embeddings is empty`.** Run the Part 2 backfill first
  (Step 0 above). The eval refuses to measure recall on an empty corpus.
- **Production: `label resolution failed`.** A named playbook/trip isn't in
  the database (or the name is ambiguous). The error lists every miss. For
  the Japan trip labels, see the note above.
- **Production: trip-day labels resolve but recall is 0.** The eval actor
  (`RECALL_EVAL_USER_ID`) is not the trip's owner/member — the privacy
  filter hides those days. Set it to your user id.
- **Sweep shows `dead` rows, or the queue never drains.** The run throws
  instead of measuring a partial corpus. Check the sweep log lines for the
  failing `(sourceType, sourceId, dayIndex)`; `pending_embeddings` rows go
  dead after 5 attempts. Common cause: provider errors (key/quota) — the
  `retried` count climbs first.
- **Recall is 0 across the board / retrieval returns [].** The corpus did not
  embed (the eval throws on an empty queue, so this means embeds returned
  null — again, key/quota). Do not "fix" it by re-running blindly; the spend
  is per run.
- **One query misses its labels.** Open the JSON report: `missed` lists the
  labeled chunks that fell outside the top 5, `retrieved` shows what beat
  them. That is the whole diagnosis input for a FAIL.
- **The corpus changed?** It cannot mid-run: the database is provisioned fresh
  per run. If `content/playbooks/` or the Japan fixture changed on the branch,
  the free dataset test (`pnpm --filter web test -- planRetrieval.recall.dataset`)
  fails in CI first — labels are re-derived from the checked-in content.
