# M31 — We can see what the assistant costs, step by step and tool by tool

**Status:** **Built 2026-10-03, beside M19, not current.** Minted 2026-10-03 and placed after
M19. Mitchell decided the same day to build it now and to defer the eve port it was minted
for:

> *"Can we do Phase 1 since its needed, then commit and keep all this work? I want to get
> some users before i increase the cost of my AI usage by moving to eve and workflow"*

M31 is now Phase 1 of ADR-062 and nothing else: the per-step and per-tool ledger, on the
current stack. **The eve port (ADR-062 Phases 2–5) is deferred, not cancelled.** It is
parked as a candidate, together with its triggers and its draft parity thresholds, and it
is kept in ADR-062 § *Deferred: the port* and in `docs/candidates.md`. Its Phase 0 spike
is done, and the findings are in the ADR.

**Gate closed 2026-10-05** (7 of 7); the retro is at the end of this file.

**Opened by:** Mitchell, 2026-10-02, choosing the full eve port with measurement as a
first-class term. The ledger was to ship before any eve code, and it is now the whole of
this milestone. Plan: `docs/plans/2026-10-03-M31-p1-ledger.md`.

## Why this exists

Nobody could answer *which tool calls work and where tokens are wasted*. There was one
`ai_usage` row per turn. The per-tool timings a turn already measured (`TurnMeter`) went to
Sentry and nowhere durable. Cached tokens were dropped before anything saw them, even though
prompt caching is on. And an escalated turn was priced entirely at the model it started on
(KI-2026-09-17-c).

That question has to be answerable before the assistant's costs grow with users. Whether a
later move to eve (or anything else) pays off is answered from the same tables.

## What shipped

All on branch `claude/eve-milestone-planning-desces`.

- **A turn has an id.** It is minted in `handleAskRequest`, it is `ai_usage.id`, and it is on
  the ledger and the recorder.
- **Migration `0035_ai_usage_steps_and_tool_calls`**:
  - `ai_usage_steps`, one row per agent step, keyed `(turn_id, step_index)`. It records the
    model the step ran on (as `prepareStep` chose it), the tier, input, cached-read,
    cached-write and output tokens, the finish reason, and whether the step escalated or
    pivoted.
  - `ai_usage_tool_calls`, one row per tool call, keyed `(turn_id, call_id)`. It records:
    - the outcome, one of `ok | failed | repaired | refused-by-grant | unfinished` (the
      last is a call still running when the turn ended, added after the 2026-10-03
      review: a user leaving is not the tool's failure);
    - the duration;
    - the input and output **sizes**, never their content;
    - which step emitted the call;
    - whether the call reached the proposal.
  - `ai_usage.latency_ms`.
- **How each outcome is detected:**
  - `refused-by-grant` and `repaired` are read in the SDK's repair hook. A call to a tool
    the step did not hold arrives there as `NoSuchToolError`.
  - `reached_proposal` comes from the proposal buffer tagging each intent with its
    call. An `AsyncLocalStorage` call scope (`assistant/callScope.ts`) does the tagging, so
    concurrent calls cannot be confused. The tag is then checked against the same dry run
    the proposal is built from.
- **An idempotent write** (`recordTurnLedger`). Writing a turn twice leaves one turn, its
  steps and its calls, which is the property a replaying runtime will need.
  - The billing row is written first, on its own.
  - The step and tool-call rows go in a second transaction.
  - So a failure in the telemetry never loses a turn's cost (2026-10-03 review).
- **All three end paths, durably.** The route hands the turn's writes to Next's `after()`.
  This closes KI-2026-09-14-b.
- **Priced per step, at the model that ran** (`microUsdForSteps`), with cached reads at the
  cached rate. This is a new dated `modelRates.ts` entry, read from the live Gateway
  catalogue. `costPerAccount`, and through it the margin and revenue views, uses it. This
  closes KI-2026-09-17-c.
- **The `ai-usage` skill answers from the database.** `.claude/skills/ai-usage/ledger.sql`
  holds seven read-only queries, validated against a migrated database, empty and seeded.
  `SKILL.md`'s stale path and its "no table" claim are fixed.
- **The live set**, as a file and a runner: `apps/web/src/server/ai/eval/live-set.json` and
  `pnpm --filter web live-set`.

## Explicitly not here

- **Any eve code**, and Phases 2–5 of ADR-062. They are deferred; see the status above.
- **`ask.apply` usage rows.** That route makes no model call.
- **Agent Runs and the OpenTelemetry pipeline.**
- **Re-pricing the compiled default model** (`anthropic/claude-haiku-4-5`). The catalogue now
  lists it under a different id and at a different US rate. Production does not run it.

## Exit gate

**Written 2026-10-03.** These are ADR-062's Phase 1 boxes, which now make up the whole
milestone.

- [x] **Per-step rows exist.** Every agent step of an `/ask` turn writes one row: resolved
      model id, tier, input, cached-read, cached-write and output tokens, finish reason, and
      whether the step escalated. The rows are keyed so that writing the same step twice
      leaves one row.
      *(Ticked 2026-10-03. `usage.int.test.ts` writes a turn twice and counts one turn, two
      steps and two calls. Seen red with the step upsert removed: `expected false to be
      true`. `askAnalytics.test.ts` covers cached reads and the escalated step's model, both
      seen red. `route.int.test.ts` drives the endpoint and finds a step row per step under
      the turn's id.)*
- [x] **Per-tool rows exist.** Every tool call writes one row with tool name, outcome,
      duration, input and output size, and whether its result reached the proposal. Outcome
      is `ok`, `failed`, `repaired` or `refused-by-grant`. Keyed on `(turn, callId)`.
      *(Ticked 2026-10-03. Each test below was seen red with its source edit:
      - `ledger.test.ts`: the four outcomes;
      - `registry.test.ts`: the SDK id and byte sizes;
      - `callScope.test.ts`: two interleaved calls each tag their own intents;
      - `askAnalytics.test.ts`: the step join, and reach only on a completed turn;
      - `route.int.test.ts`: non-empty tool-call rows from a real turn.)*
- [x] **No user text and no money** in either table. `usage.noMoney.test.ts` covers the new
      tables and migration `0035`, and is seen to fail when a dollar column is added to one.
      *(Ticked 2026-10-03. Adding `cost_micro_usd` to the schema, and then to the
      migration, each turned the guard red. `usage.int.test.ts` pins both tables' exact
      column lists against content-shaped names.)*
- [x] **Rows are written on all three end paths** (completed, error, abort), from the
      recorder's existing single-writer latch, not a new one.
      *(Ticked 2026-10-03. `route.int.test.ts`'s abort test now asserts synchronously after
      the `after()` task runs. Seen red with the registration removed: `expected 46 to be
      47`. KI-2026-09-14-b resolved.)*
- [x] **The `ai-usage` skill answers the tool question from the database.** It covers
      failure rate per tool, p50 and p75 duration per tool, tokens per turn at p50 and p75
      with cached share, proposal-reached rate, and escalation rate. Its stale
      `askAnalytics.ts` path is fixed.
      *(Ticked 2026-10-03. `ledger.sql` ran clean against an empty migrated database, so
      every division handles zero. It also ran against seeded rows, checked by hand: p50
      tokens 4,125, cached share 0.500, and simulated turns excluded.)*
- [x] **[operator]** An AI Gateway project spend budget with alerts is set in the dashboard.
      This is Mitchell's to do; the box records the amount.
      *(Ticked 2026-10-05: **$20 per month**, set by Mitchell on 2026-10-04 ("i turned on
      budget"). Alert thresholds were not stated.)*
- [x] **A baseline is recorded** in this file. Run the live set on a preview with `ai-live` on,
      then run `ledger.sql` over the printed window and record the numbers and n here. It
      needs `VERCEL_AUTOMATION_BYPASS_SECRET` if an agent runs it (STATUS.md, *Blocking*).
      It is also the real model call M9's gate is waiting for.
      *(Ticked 2026-10-05 **on a substitute Mitchell accepted**: n=2 hand-typed production
      turns, not the live set on a preview. `ledger.sql` over 2026-10-04 23:00 UTC onward:*

      | Turn | Model | Steps | Tokens in / out | Cached | Tool calls | Latency | Proposal |
      |---|---|---|---|---|---|---|---|
      | question | `zai/glm-4.7-flashx` | 3 | 8,386 / 825 | 1.5% | 10 | 162.3 s | — |
      | edit | `zai/glm-5.3-flash` | 5 | 39,143 / 525 | 56.9% | 5 | 13.8 s | reached |

      *Tool failures 0 of 15 (`find_free_time` ×11, `read_trip` ×2, `search_places` ×1,
      `AddActivity` ×1). Tokens per turn p50 ≈ 24,440, p75 ≈ 32,050; cached share 0.471.
      Proposal reached on 1 of 1 change turns. Escalation 0 of 2. The baseline's one consumer
      is the eve port's parity check, which is deferred; that port will need a full live-set
      run on whatever stack is current anyway. M9's gate is not satisfied by this: it stays
      paused.)*

## Prerequisites

- **Migration `0035` must be dispatched to production after merge**
  (`gh workflow run migrate-production.yml -f confirm=migrate`). Until then, the step and
  tool rows fail to write in production.
  - `recordTurnLedger` never throws. A failure there logs `ai_usage row was not written`.
  - **Order matters.** The `ai_usage` insert now writes `latency_ms`, which only `0035`
    adds. Until the migration is applied, the `ai_usage` row itself fails to write in
    production, as well as the child rows.
  - So dispatch the migration **before** the code deploys to production, or immediately
    after.

## Retro — gate closed 2026-10-05 (7 of 7, one box on an accepted substitute)

**What shipped.** Per-step (`ai_usage_steps`) and per-tool-call (`ai_usage_tool_calls`) rows for
every `/ask` turn, written on all three end paths from the recorder's existing latch; cached
tokens and escalated steps priced at the model each step ran on; the `ai-usage` skill's
`ledger.sql`. Migration `0035`, dispatched. Built 2026-10-03 beside M19.

**What held.**
- **The ledger found the first real problem within one evening of production use.** Mitchell's
  second turn on it took 162 seconds while its tools took 15 ms, which is what the ledger was
  built to make visible. It opened `KI-2026-10-04-c`, M32 (one call for "which day is free",
  per-step durations) and M33 (evals), and ended in switching the cheap tier's model.
- **No user text and no money in the tables**, held by a test that goes red on a dollar column.

**What it cost.**
- **The ledger could say *that* a turn was slow, not *which step*.** Steps carried no duration,
  so the 162-second turn needed M32's `duration_ms` (migration `0037`) and an eval to localise.
  A per-step timing belonged in the first schema.
- **The baseline box assumed a preview run that nobody scheduled.** It closed on two production
  turns instead, accepted by Mitchell as recorded above; the honest label is in the box.

**Left open, not gating.**
- **The eve port** (ADR-062 Phases 2–5), deferred with its triggers in `docs/candidates.md`.
- **`KI-2026-10-04-c`**: open until production's step durations show the cheap-tier switch held.
- **M9** stays paused; this baseline is not its live model call.
