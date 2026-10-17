# M48 — A planned trip starts from trips that already exist

**Status:** **Built ahead of the milestone order, with Mitchell's approval; the gate is not
closed.** It was proposed on 2026-10-11 and placed after M47. The RAG stack merged on
2026-10-15/16 as PRs 459 to 467, all but 461 (migration `0054_rag_day_embeddings`). It is in production
behind `RAG_PLAN_RETRIEVAL`, which is off.
- **Decisions:** 2, 3, 5, 6, 7, 8, 9 and 10 are answered by what was built. Mitchell said on
  2026-10-17 to record them that way. Decision 4 is partly answered, and 1 and 11 are open.
- **The index:** ADR-075.
- **The gate:** 3 of 11 boxes, each with its evidence below.
- **PR 461**, the Gate 1 eval, is still an open draft. A disposition is recommended below,
  pending Mitchell.

Minted on Mitchell's ask the same day (*"Add as a
upcoming milestone this new feature … its a starting point to validate the proposal, not the
final product"*), from a product brief by Sunny (PM), *Retrieval-augmented plan generation*,
2026-10-11. The brief is not in the repo, so what it asked for is restated here.

**The feature is what this milestone commits to. The brief's technical design is not.** Mitchell,
2026-10-11: the brief was written by an agent outside the repo that could not read all the code,
so *"focus on the feature, we can change the technical decisions"*. Its design is kept below as a
starting sketch, and scoping is free to replace any part of it.

It is placed last because what it saves scales with how many plan turns are served, and there are
few until there are users (Mitchell, 2026-10-03: users before AI cost). **Its first two gates are
offline and touch no serving code**, so they can run earlier than the row order says, beside
another milestone, without moving the row.

## Why this exists

A `plan` turn (*"plan me a 6 day food trip to Tokyo"*) is the most expensive turn the assistant
serves. It runs on the strongest model tier and writes a whole itinerary from nothing, and output
tokens are the dearest tokens there are.

Caesura already holds itineraries the model never sees: the seeded playbooks, and trips people
have built. Every plan turn works out again what those already know.

**The feature:** when someone asks for a plan, the assistant finds a few example days that fit the
request and adapts them, instead of inventing every day. The traveller gets a plan at least as
good as today's. Caesura spends less producing it.

**Success is dollars per plan turn**, read from the M31 ledger. If that number does not move, the
milestone stops and nothing ships.

## What the feature has to be, whatever it is built from

1. **The plan is no worse.** Quality is judged against today's plans before anything ships.
2. **The user's request wins over any example.** Examples are adapted, never copied out.
3. **Examples first, the model alone as the fallback.** Every plan turn looks for examples and
   builds from them when it finds any. If none fit, or the lookup fails or is too slow, the model
   plans from nothing exactly as it does today, so a turn is never broken by this. Confirmed by
   Mitchell, 2026-10-11: *"we still want to be able to build using the model if we fail to
   retrieve from the rag, but we should lean on using the rag first."*
4. **Nobody's private trip informs somebody else's plan.**
5. **It turns off.** With its flag off, the assistant behaves as it does today.
6. **It is proven cheaply before it is built.** Two offline checks come first: that relevant
   example days can be found for real requests, and that plans built from them cost less at the
   same quality. Failing either ends the milestone with no serving code written.
7. **It is not a classifier change and not a search feature.** It runs only on turns already
   classified `plan`. Searching playbooks by meaning in Discover is a separate feature.

## The brief's sketch (a starting point; any of it can change)

- **Examples are days**, not whole trips and not single stops, found by similarity to the request
  in a vector index. **The index is pgvector in the Postgres the app already has (Neon)**, not a
  separate vector service. Mitchell, 2026-10-12: *"I actually didnt realize we could use our
  existing DB for a vector db using pgvector in neon"*. This replaces the Upstash Vector index he
  created on 2026-10-11 to test with (hybrid: dense `TEXT_EMBEDDING_3_SMALL` hosted by Upstash,
  cosine, BM25 sparse), which this milestone no longer uses.
- **Days are embedded when they are written**, never while a turn is waiting.
- **A plan turn retrieves about 8 candidate days** and puts the best few in front of the model.
- **A later second pass** has a cheap model judge each candidate before it is used. The brief
  calls this a *"Jev evidence filter"* with *"one packed `noul` per candidate"*. Neither term
  exists in this repo, so Sunny needs to say what they mean before that phase is scoped.
- **Three phases:** examples on the same tier as today; then the second pass; then a cheaper tier.
- **Three gates:** recall@5 ≥ 0.7 over 20 to 30 real requests; ≥ 25% fewer output tokens or one
  tier down at equal quality over 10 prompts; then live numbers under a flag.

## What the repo adds to that

Notes for whoever scopes this, from reading the code the brief's author could not.

- **A plan turn writes suggestions, not commands** (M40, ADR-067), so examples go in ahead of
  that path, and *"which examples the turn used"* has to be something a suggestion can answer.
- **Examples cost input tokens, and a plan turn is several model steps**, so they are paid for on
  each step unless cached. Fewer output tokens does not by itself mean a cheaper turn. Measure
  dollars.
- **Nobody has recorded what a plan turn costs today or how many there are.** The ledger has it.
  The whole AI budget is $20 a month, which caps what this can save right now.
- **The seeded corpus is 19 playbook bundle files.** The first check should also count how many
  real requests have any fitting example at all.
- **The brief's second gate changes the examples and the tier together**, so a pass could not say
  which one did it.
- **Example text written by other users is outside text in the prompt.** ADR-043 already says
  how that arrives: as a labelled data block.
- **An example has to be forgettable.** An unpublished or moderated playbook (M12), or a deleted
  trip, must stop being used.
- **Private trip text is sent to a hosted embedding model.** Decided, no notice to users: Mitchell, 2026-10-17: *"the data in the app is ours, we don't need to communicate that with users."*
- **pgvector is an extension, not a new store**, so embeddings are rows: they sit beside the days
  they describe, are removed with them, and each Neon branch (preview, production) has its own.
  Three things come with it that the Upstash index hid:
  - **Local and CI Postgres had to change image**, since stock `postgres:17` does not ship
    pgvector. Both now run `pgvector/pgvector:pg17` (CI since PR 459; `docker-compose.yml` in
    PR 470).
  - **Nothing embeds the text any more.** Upstash hosted the embedding model. With pgvector the
    app calls one itself, on write and once per plan turn for the request, and that call is a
    cost and a failure the fallback in commitment 3 has to cover.
  - **The sparse half of hybrid search is not built in.** Postgres full-text search is the
    nearest thing to the BM25 the Upstash index had, and it is a second query to merge.

## Decisions

Recorded 2026-10-17 from the code that merged. Mitchell said to mark them answered. Each entry
gives the original recommendation, then what was built. Where the build differs from the
recommendation, the entry says so.

About the feature:

1. **Is the baseline worth beating?** *Recommended:* first, run the `ai-usage` skill and record
   here the dollars per plan turn, the input and output split, and plan turns per month. If plan
   turns are a small share of spend, stop here.
   **Open.** No baseline has been recorded in the repo, and the serving code merged without one.
   Stage 1 of the Gate 2 runbook's rollout (`docs/evals/gate2-quality-runbook.md`) leaves the
   flag off "while baseline ledger numbers accumulate". Nobody has read those numbers yet.
2. **Whose itineraries are examples.** *Recommended:* seeded and published playbooks first. A
   user's own private trips come later, if at all. That keeps commitment 4 true by construction
   in the first build.
   **Answered, wider than recommended.** Both playbooks and trips are embedded, and the query
   decides who sees what (ADR-075 decision 6):
   - a public playbook is served to everyone, and a private one only to its owner;
   - a trip day is served only to the trip's owner and members, and not once the trip is deleted;
   - anything owned by `service-ai-library` is served to everyone (Mitchell, 2026-10-16), unless
     moderation takes it down.

   So commitment 4 holds because of the privacy predicate, not by construction. Before PR 470 an
   unpublished, moderated or deleted playbook kept being served until the sweep re-embedded it
   (audit 2026-10-16 §5.1); since then the predicate reads the source's live state (exit gate
   below). Trip text goes to
   the embedding provider whether or not the flag is on, by decision (no user notice; Mitchell,
   2026-10-17).
3. **Who gets examples** (Sunny's question 2). *Recommended:* any signed-in plan turn.
   **Answered as recommended.** Examples go to every turn classified `plan` while
   `RAG_PLAN_RETRIEVAL=1` is set (`server/ai/handleAskRequest.ts:709`). Retrieval runs as the
   asker, so each asker sees only what the privacy rule allows them. The flag is one environment
   variable for the whole deployment, not a per-user setting.
4. **How "no worse" is judged.** *Recommended:* the M33 eval harness plus Mitchell reading the
   plans side by side.
   **Partly answered.**
   - Gate 2 judges quality with an LLM judge on the cheap tier. The judge compares each arm with
     the baseline, with the position of the two plans randomised
     (`server/ai/eval/planRetrieval.gate2.judge.ts`, `planRetrieval.gate2.eval.ts`). It does not
     use the M33 harness.
   - The plans are built from a stand-in prompt, not the full production turn prompt, which the
     runbook records as a known limitation.
   - Mitchell reading the plans side by side is the `[walk]` box below, and it has not happened.
5. **The bar for "examples can be found"** (Sunny's question 1). *Recommended:* recall@5 ≥ 0.7
   as proposed, plus the coverage count above.
   **Answered for recall, open for coverage.** The bar is macro recall@5 ≥ 0.7 over 25
   hand-labelled real requests. The eval that measures it is in PR 461 and has not merged. The
   coverage count, how many real requests have any fitting example at all, was never taken.
6. **The bar for "it costs less".** *Recommended:* ≥ 25% lower cost per plan turn at equal
   quality, in dollars, across three arms: today, today's tier with examples, a cheaper tier with
   examples. This replaces Sunny's question 4.
   **Answered differently from the recommendation.** Gate 2 uses Sunny's original bar: quality
   parity, plus either ≥ 25% fewer *output* tokens on the same tier, or the mid tier with
   examples matching the strong tier without them (the header of `planRetrieval.gate2.eval.ts`,
   and the runbook). It reports input and total tokens alongside, but not dollars. Cost in
   dollars is left to the ledger box of the exit gate.
7. **Whether the cheaper tier is part of this milestone.** *Recommended:* measure it offline here
   and decide on turning it on once there are live numbers.
   **Answered as recommended.** Arm C of Gate 2 measures the mid tier offline. The runbook's
   rollout stage 4 decides on the tier drop after a week of live numbers. Arm C's result is not
   recorded anywhere in the repo.

About how it is built:

8. **How examples are found.** The sketch says a vector index. The first offline check is the
   place to compare it with something plainer, such as filtering playbook days by city and tags,
   which needs no extension and no embedding call.
   **Answered: a vector index.** It is pgvector, searched with a dense HNSW query and full-text
   search, fused by reciprocal rank (ADR-075 decisions 1 and 4). The comparison with plain city
   and tag filtering was never run.
9. **The example unit** (Sunny's question 3). *Recommended:* the day.
   **Answered as recommended: the day** (`server/ai/chunks.ts`, ADR-075 decision 2).
10. **How the index is built and kept current**, if decision 8 keeps one. Where it lives is
    answered (Mitchell, 2026-10-12): pgvector in the app's own Postgres. Still open: which
    embedding model and how it is called, dense only or hybrid with full-text search, when days
    are embedded and removed, and the local and CI Postgres image. It gets an ADR.
    **Answered: ADR-075.**
    - **The model:** `openai/text-embedding-3-small` at 1536 dimensions, called through the AI
      Gateway, with its id in `serverConfig.embeddingModel`.
    - **The search:** hybrid, full-text search fused with the dense query by reciprocal rank.
    - **Embedding:** on write, through `pending_embeddings` and a daily cron sweep, which also
      tombstones the embeddings of a deleted source.
    - **The Postgres image:** `pgvector/pgvector:pg17` in CI and, from PR 470,
      in `docker-compose.yml`.
11. **What the second pass is**, once Sunny defines it. Until then it is out of scope.
    **Open.** Sunny has not yet said what the *"Jev evidence filter"* and *"one packed `noul`
    per candidate"* mean, and nothing for a second pass has been built.

## The Gate 1 eval branch (PR 461)

What it is: draft PR 461, `sunny/rag-part3-gate1`, head `ebb8a19`, opened 2026-10-16 and still
open. Against `main` it adds seven files:
- the 25 labelled queries (`planRetrieval.recall.dataset.ts`);
- a label resolver that looks labels up by name, and its tests (`planRetrieval.recall.resolve.ts`);
- the paid recall eval (`planRetrieval.recall.eval.ts`), which runs in a fixture mode or against
  production;
- a free CI test of the dataset;
- `docs/evals/gate1-recall-runbook.md`;
- an optional `excludeSourceIds` parameter on `retrieveDayChunks`, which only the eval passes.

GitHub reports it mergeable and clean. A trial merge with `git merge-tree` shows no conflict with
`main` or with the branch that carries the privacy fix.

**None of it landed through another PR.** No recall eval, dataset or Gate 1 runbook exists on
`main`. Main's Gate 2 dataset points at the branch by name
(`planRetrieval.gate2.dataset.ts:6-7`).

**Gate 1's result is recorded only as prose**, never as a report. The first run scored 0.607 and
the re-run 0.740 (`docs/guidelines/building-with-judgment.md:27,50`; the runbook for Gate 2,
line 4; the body of PR 465). The per-query JSON report is git-ignored, and the coverage count was
never taken. The 0.84 in the branch's own runbook is sample output, not a result.

**Recommendation, pending Mitchell: merge it, after one review pass.** It is the only runnable
record of the first offline check, which the exit gate asks to have pasted here. `main` already
carries the Gate 2 paid eval on the same terms, so *"eval-only branches stay branches"*
(`building-with-judgment.md:61`) is not what `main` does. Two things to check in that review:
- whether `excludeSourceIds`, a parameter on the serving function used only by the eval, should
  stay;
- that the runbook says the real result rather than leaving 0.84 as the only number.

If Mitchell prefers to close it, record head `ebb8a19` here so the eval stays retrievable from
history, and change the comment in `planRetrieval.gate2.dataset.ts` to point at that commit.

## Scope

- The baseline and the two offline checks, as scripts and recorded results, before serving code.
- Example days in front of plan turns, behind a flag, falling back to today's path.
- Per plan turn in the M31 ledger: how many examples were used, and what the turn cost.

## Out of scope

- Any change to the intent classifier.
- Examples drawn from the trip being edited. Trips are tens of stops, and it would save little.
- Semantic search in Discover.
- Turning on a cheaper tier in production, until decision 7 says otherwise.
- Private trips as examples, until decision 2 says otherwise. *(Built anyway: decision 2 now
  serves a trip's days to that trip's own owner and members. No other reader gets them.)*

## Exit gate

Order note: the serving code (PR 464) merged before Gate 2 had run (PR 465 added the Gate 2 eval).
The two offline checks therefore did not come before serving code, as commitment 6 says they
should. The flag is off.

- [ ] **Decisions 1–11 are answered and recorded here**, with an ADR for the index if decision 8 keeps one.
      *(2026-10-17: ADR-075 exists. Not ticked, because 1 and 11 are open and 4 is partly
      answered.)*
- [ ] **The baseline is pasted here**: dollars per plan turn, input and output split, plan turns
      per month (`ai-usage` skill output).
      *(2026-10-17: nothing has been pasted.)*
- [ ] **The first offline check is run and its numbers are pasted here**: recall and corpus
      coverage over the labelled requests. Below the bar, the milestone closes here with a retro
      and no serving code.
      *(2026-10-17: it was run, and macro recall@5 is reported as 0.607, then 0.740 after the
      fixes, against a bar of 0.7. That number is recorded only in prose
      (`building-with-judgment.md`, the body of PR 465). The coverage count was never taken, and
      the eval is on the unmerged PR 461. Not ticked until the per-query numbers and the coverage
      count are pasted here.)*
- [ ] **The second offline check is run and its three arms are pasted here**, in dollars per
      turn, with the quality verdict. Below the bar, the same.
      *(2026-10-17: Mitchell ran it.*
      - *Quality: examples were judged better on 8 of 10 queries (the body of PR 467).*
      - *Output tokens: −5.1% against the bar of 25%, so the token half failed
        (`building-with-judgment.md:30`).*
      - *Arm C's result has not been recorded, and nothing was reported in dollars.*

      *PR 467 then cut the examples from 5 × 500 characters to 3 × 250, an estimated 60% less
      input. No re-run has been recorded. Under this box's own rule, a failed check means a
      retro and no serving code. Whether the PR 467 re-run decides it is Mitchell's call. Not
      ticked.)*
- [x] **With the flag off, a plan turn looks up no examples and sends the model the same prompt
      as today.** A test is seen red with the flag check removed. (Part 4: `RAG_PLAN_RETRIEVAL`
      in `server/config.ts`, off by default; `getPlanExamples` returns `[]` before any embedding
      call or DB query; `instructionBlocks(..., [])` renders byte-identically to today.)
      *(Evidence: PR 464's body records the red failures with the flag guard removed:
      `expected undefined to deeply equal []`, and `expected 'You are the travel-collab trip
      assist…' not to match /Example days/`.)*
- [x] **A lookup that throws, times out or returns nothing leaves the turn working.** One test
      per case, each seen red. (Part 4: `getPlanExamples` never throws, 2s `Promise.race` budget,
      `embedText` null → `[]`, empty retrieval → `[]` and no prompt blocks.)
      *(Evidence: PR 464's body records the red failures with the timeout arm removed (`Test
      timed out in 5000ms`), the catch removed (`promise rejected "Error: provider exploded"`),
      and an empty retrieval mapped to a non-empty one.)*
- [ ] **A playbook that is unpublished or taken down is not used as an example.** A test
      is seen red.
      *(2026-10-17: the fix is PR 470, with red-first integration tests in
      `retrieval.int.test.ts` for unpublished, moderated and deleted playbooks and for a
      deleted trip. The failure text is not yet recorded anywhere. Tick this once the fix is on `main` and the failure
      text is in its PR.)*
- [x] **No model id is a literal in kernel code** (ADR-019): the lint wall passes. (Part 4 adds
      no model ids; the embedding model id stays in `serverConfig.embeddingModel` from Part 2.)
- [ ] **The ledger shows example count, output tokens and tier per plan turn** (`ai-usage`
      skill output pasted here), and dollars per plan turn with the flag on against the baseline.
      *(2026-10-17: this is not built. The example count reaches only the `rag: plan examples`
      and `rag: plan examples used` log lines (`handleAskRequest.ts:710-716` and `:896-899`). It
      does not reach the M31 ledger tables.)*
- [ ] **[walk]** On the PR preview with the flag on, ask *"plan a 6 day food trip to Tokyo"*,
      and the suggestions it writes are a plan Mitchell would accept.
- [ ] A retro is appended at gate close.
