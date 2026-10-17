# ADR-075: Plan examples are retrieved from pgvector in the app's own Postgres

**Status:** **Accepted — 2026-10-17.** Mitchell chose the store on 2026-10-12 and said *"go ahead"*
to recording it on 2026-10-17. Built 2026-10-15/16 in PRs 459 to 467, ahead of the milestone
order, with Mitchell's approval; PR 461, the Gate 1 eval, is the one still open, as a draft. This file records what was built; it adds no decision
the code did not make.
**Deciders:** Mitchell (product: the store, 2026-10-12; the library owner rule, 2026-10-16); Sunny
(the build); Claude — drafted
Related: **ADR-019** (no model id as a literal in kernel code), **ADR-043** (outside text arrives as
a labelled data block), **ADR-048** (a playbook is a sequence of days), **ADR-061** (the public
library), **ADR-067** (a plan turn writes suggestions), milestone
`docs/milestones/M48-plans-start-from-examples.md` (decisions 8, 9 and 10).

## Context

M48 has a `plan` turn adapt a few example days that already exist instead of writing every day
from nothing. The brief proposed an Upstash Vector index: hybrid search, a dense
`TEXT_EMBEDDING_3_SMALL` model hosted by Upstash, cosine, and BM25 for the sparse half. Mitchell
created one on 2026-10-11 to test with. The next day he chose the app's own database instead:
*"I actually didnt realize we could use our existing DB for a vector db using pgvector in neon"*
(Mitchell, 2026-10-12, quoted in M48's file).

That choice brings three things the hosted index had hidden (M48's file lists them): stock
`postgres:17` has no pgvector, the app has to call an embedding model itself, and Postgres has no
BM25.

## Decision

1. **The index is pgvector in Neon, the Postgres the app already uses.** No vector service.
   Migration `0054_rag_day_embeddings` runs `CREATE EXTENSION IF NOT EXISTS vector` (Mitchell ran
   it on the Neon project by hand first) and creates two tables. Neither has a foreign key to
   the row it describes:
   - **`day_embeddings`**: one row per day of a source, unique on
     `(source_type, source_id, day_index)`. `source_type` is `playbook` (a `saved_days` row) or
     `trip` (a planning stream). It holds the chunk text, `embedding vector(1536)`, `fts tsvector`,
     `city`, `country_code`, `tags`, and `visibility` and `owner_id` copied from the source when
     the day is embedded. It has an HNSW index (`vector_cosine_ops`) and a GIN index on `fts`.
   - **`pending_embeddings`**: the embed queue. Same unique key, plus `status`
     (`pending | processing | done | dead`) and `attempts`.

   CI's two Postgres services run `pgvector/pgvector:pg17` (`.github/workflows/ci.yml`).
2. **The unit is the day** (M48 decision 9). Playbook days are grouped by `dayIndex` (ADR-048),
   and trip days come from `TripDetail.days`. One pure, deterministic builder owns the chunk text
   (`server/ai/chunks.ts`): name, summary, cities, then each stop's title, tags, notes and place.
   The write path, the sweep and the backfill all use it, so they cannot disagree about what a
   day says.
3. **The embedding model is `openai/text-embedding-3-small` at 1536 dimensions, called through
   the Vercel AI Gateway** (`server/ai/embeddings.ts`). Its id lives in
   `serverConfig.embeddingModel` (`AI_EMBEDDING_MODEL`), as ADR-019 requires. The call builds its
   own gateway client and does not go through `ai/gateway.ts`, which is the chokepoint for
   *language* models: an embedding has no tier and no simulated-model seam. A call that fails
   returns `null` and never throws, under a 30 s ceiling (`AI_EMBEDDING_TIMEOUT_MS`). A wrong
   dimension also returns `null`. To change the model you change the column and re-embed the
   whole corpus, so it is not a setting to tune.
4. **Retrieval is hybrid: dense HNSW plus full-text search, fused by reciprocal rank**
   (`server/ai/retrieval.ts`, `retrieveDayChunks`). It is one SQL statement:
   - the dense leg takes the top `2k` by cosine distance (`<=>`);
   - the sparse leg takes the top `2k` by `ts_rank` over `plainto_tsquery('english', …)`;
   - the two are fused by summing `1 / (60 + rank)` across both legs and ordered by that score.

   Full-text search stands in for the BM25 that Upstash had. The `english` dictionary is used on
   write (`sweep.ts`) and on read, by construction. The function never throws: a database error
   returns `[]`.
5. **Days are embedded when they are written, never while a turn waits.** The only embedding
   call inside a turn is for the request itself.
   - Writes **enqueue** day indexes (`server/ai/queue.ts`). Playbooks enqueue from `storeSavedDay`
     and `updatePlaybookContent`. Trips enqueue from `appendAndProject` (`server/commands.ts`),
     every day on every command, inside the command's transaction and under a savepoint. A
     rolled-back command leaves no queue row, and a failed enqueue never fails the trip write.
     Re-enqueueing resets a `done` or `dead` row to `pending`.
   - **A daily Vercel Cron sweep** drains the queue: `GET /api/cron/embed-days` at 04:00 UTC
     (`apps/web/vercel.json`; daily is the Hobby plan's limit), authorised by a
     `CRON_SECRET` bearer. A request without it gets 401, and with the secret unset every
     request does. Each run:
     - claims 50 rows with `FOR UPDATE SKIP LOCKED` and first resets any orphaned `processing`
       rows;
     - reads visibility, owner and metadata fresh from the source at embed time;
     - retries a row that fails and moves it to `dead` after 5 attempts;
     - tombstones the embeddings of a source that has been deleted or cannot be read.

     One bad row never stops the batch (`server/ai/sweep.ts`).
   - `pnpm --filter web db:backfill-embeddings` queues every day of every playbook and active
     trip, to fill an empty corpus.
6. **Who may see a chunk is decided in the query, in the app layer, not by Postgres RLS.** The
   codebase has no RLS precedent. The predicate is written once (`privacyFilter`) and used in both
   legs, so the legs cannot disagree about who may see a chunk:
   - **a playbook day** is visible when it is public or the reader owns it;
   - **a trip day** is visible when the reader is the trip's owner or a member. The owner's id is
     stored at embed time, because the owner has no `trip_memberships` row. Membership is read
     live from `trip_memberships`;
   - **content owned by `PUBLIC_LIBRARY_OWNER_ID` (`"service-ai-library"`)** is visible to every
     reader, including a reader who is logged out, in both legs. Mitchell, 2026-10-16: *"anything
     owned by that id is owned by everyone"*;
   - **a logged-out reader** (`userId: null`) sees only public playbook days and the library's
     days.

   **Playbook rows are also checked against the live `saved_days` row** (PR 470; audit
   2026-10-16 §5.1). A source that is deleted, or that someone other than the reader has
   unpublished or that moderation has taken down (library content included), overrides the
   embedding's stored `visibility`, which can never allow more than the source does. The same
   commit re-enqueues the days from `setSavedDayVisibility` and `deleteSavedDay`, so the sweep
   refreshes the copy or tombstones it, and adds red-first integration tests for both cases. On
   `main` until it merges, the playbook leg reads only the copy that was stored when the day was
   embedded.
7. **Serving is behind a flag and never breaks the turn** (`server/ai/planExamples.ts`, called
   from `handleAskRequest.ts`):
   - It runs only when `RAG_PLAN_RETRIEVAL=1` (off by default) and only on a turn already
     classified `plan`.
   - The request is embedded and retrieved within a 2 s budget for the whole turn. The turn
     retrieves `RAG_PLAN_EXAMPLE_COUNT` days (default 5), and the top
     `RAG_PLAN_EXAMPLE_PROMPT_COUNT` of them (default 3), each cut to `RAG_PLAN_EXAMPLE_CHARS`
     (default 250) characters, go into the prompt.
   - They arrive as one server-written `rule` and one `data` block, as ADR-043 requires.
   - With the flag off, nothing is embedded or queried, and the prompt is byte-identical to the
     prompt without this feature.
   - If the flag is off, the embedding comes back null, retrieval finds nothing, the budget runs
     out, or anything throws, the turn has no examples and plans from nothing as before.

## Rejected

- **Upstash Vector** (the brief's design, and the index Mitchell created on 2026-10-11). It is a
  second store with its own lifecycle. With pgvector, an embedding is a row beside the day it
  describes.
- **Postgres row-level security** for the privacy rule. Nothing else in the codebase uses it. The
  predicate is one function, tested by `retrieval.int.test.ts`.

Not compared: the plainer option M48 decision 8 asked about, filtering playbook days by city and
tags with no extension and no embedding call. Nothing in the repo measured it against this index.

## Consequences

- **Embeddings are ordinary rows.** Each Neon branch (preview, production) has its own corpus, and
  each fills from its own queue or from the backfill.
- **Local Postgres runs the CI image.** `docker-compose.yml` moved from stock `postgres:17`, which
  does not ship pgvector and failed a local `db:migrate` at `0054`, to `pgvector/pgvector:pg17`
  (PR 470). An existing local volume keeps working; the new image adds the
  extension's files.
- **Every plan turn with the flag on makes one embedding call.** Embedding on write costs one
  provider call per queued day, whatever the flag says: the queue and the sweep do not read
  `RAG_PLAN_RETRIEVAL`.
- **Trip text goes to a hosted embedding model** (OpenAI, through the gateway), because trip days
  are queued on every command, flag on or off. Users are not told, by decision: Mitchell, 2026-10-17: *"the data in the app is ours, we don't need to communicate that with users."* Embedding
  stays independent of the flag, so the corpus is ready the day the flag turns on.
- **Planning now imports the AI module.** `server/commands.ts` imports `./ai/queue`. Each command
  re-queues every day of the trip, and a daily sweep of 50 rows can fall behind (audit 2026-10-16
  §5.2, §5.3). PR 470 fixes the cost half: the sweep skips days whose text has not changed, the
  enqueue becomes one statement, the summary reports the backlog, `maxDuration` is set and the
  sweep stops at a 240 s budget. It does not invert the import (KI-2026-10-17-a).
- **Changing the embedding model needs a manual reset.** The sweep skips a day whose chunk text
  is unchanged, and rows do not record which model made their vector. After changing
  `AI_EMBEDDING_MODEL`, run `UPDATE day_embeddings SET embedding = NULL` and then the backfill,
  or every row keeps the old model's vectors.
- **A deleted trip's days are hidden at once.** The trip leg reads `trip_summaries.status` and a
  deleted trip vetoes its rows, as a withdrawn playbook does (PR 470, with a red-first test). The delete is a command, so it also re-queues the days and the sweep
  tombstones them.
- **The `service-ai-library` account sees past the privacy rule.** Anything it owns, in either
  leg, is served to every reader. Content that must stay private must not be stored under that
  owner.
