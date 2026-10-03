# M31 — The assistant runs on eve, and we can see what it costs

**Status:** **Minted and placed 2026-10-03 — runs after M19.** Not current. ADR-062
(Proposed) is the decision, and its *Phase 0 findings* are the spike's evidence. Phase 0 is
done. **The parity thresholds below are PROPOSED and wait on Mitchell's approval**; a gate
definition changes only by his explicit decision, recorded here. Until he approves them,
ADR-062 stays Proposed and Phases 2–5 do not start.

Phase 1 can start without that approval, because it is useful whether or not the port
continues. Its plan is `docs/plans/2026-10-03-M31-p1-ledger.md`.

**Opened by:** Mitchell, 2026-10-02, choosing the full port of three options and setting two
terms:

- measurement and visibility are a first-class goal, so the ledger ships **before** any eve
  code;
- user memory is designed for but built later. It has its own candidate entry, which depends
  on this milestone.

## Why this exists

The assistant is one request-scoped `ToolLoopAgent` run (ADR-033, ADR-043). Three things it
cannot do are structural (ADR-062 *Context*):

1. survive past one invocation;
2. keep a conversation anywhere but one browser;
3. run work nobody is waiting on.

Separately, nobody can answer *which tool calls work and where tokens are wasted*. There is
one `ai_usage` row per turn, and the per-tool timings a turn already collects in memory
(`TurnMeter`) leave only as a log line.

## Phases

Each phase is one PR, or one short stack. Phases 2–5 are sized at kickoff of Phase 2, not
here: Phase 1's numbers are part of what sizes them.

- **Phase 0 — Spike.** **Done 2026-10-03.** ADR-062 *Phase 0 findings*. Its results:
  - (a) holds, via the pinned `auth.initiator`;
  - eve has no approval expiry, so it is enforced at commit;
  - cached tokens are present;
  - the Workflow store is separate per environment;
  - one turn adds about $0.0002–0.0008 on Workflow, against about $0.0011 of model.

  Two findings add work. An `assistant_sessions` ownership table goes into Phase 2, because
  eve leaves a session's stream readable to any signed-in caller. And a per-session turn
  ceiling goes into Phase 2, because Workflow's replay slows past 2,000 events per run.
- **Phase 1 — The ledger, on the current stack.**
  - Per-step and per-tool rows next to `ai_usage`.
  - Tool-level queries in the `ai-usage` skill.
  - A Gateway project spend budget, set by Mitchell.
  - **A baseline**: the numbers the parity gate compares against, measured before any eve
    code exists.
- **Phase 2 — The adapter.** `eve` pinned exactly and out of Dependabot's groups. Then:
  - `agent/` with the 23 tools wrapped, the `turn.started` resolvers and re-guard hook, and
    `ledger.ts` instrumentation feeding the Phase 1 recorder;
  - `defaultTools: false`;
  - the lint wall extended to forbid `eve` in `server/assistant/**`;
  - our `AuthFn`, with the trip bound through `auth.initiator`;
  - the `assistant_sessions` ownership check on every session route;
  - `sessionTimeoutMs` and a per-session turn ceiling;
  - the simulated model from a `step.started` resolver;
  - `withEve` and `vercel.ts`, AI Gateway through OIDC, and the `/eve/*` firewall rule.
- **Phase 3 — `apply_proposal`.**
  - `approval: always()`, and the executor re-runs the guard, `parseApprovedCommands` and
    `readableSavedDay` as the responder;
  - idempotent on `proposalId` through the ADR-051 table;
  - **24-hour expiry enforced in `execute`**, plus a lazy cancel of turns parked on an
    expired proposal.
- **Phase 4 — The client.**
  - `useEveAgent` with `resume: true`;
  - the `AskStreamMetadata` contract change, with a CHANGELOG entry;
  - `localStorage` (`ask_thread_v1`) removed;
  - the old `/ask` route kept behind a flag.
- **Phase 5 — Evals and the parity gate.**
  - The five replay transcripts move to `defineEval`, and CI runs them on `mockModel()`.
  - The live set runs on a preview against both stacks.
  - The old route is deleted when the gate closes.

## Explicitly not here

- **User memory.** That is its own milestone. `agent/memory.ts` is an empty slot, and the
  scope `byPrincipal` is decided (ADR-062 §6).
- **Schedules, Cron and background agents.**
- **Vercel Sandbox, and any built-in eve tool.**
- **Native `defineTool` rewrites of kernel tools.** ADR-062 *Alternatives rejected*.

## Exit gate

**Written 2026-10-03.** Phase 1's boxes stand on their own: the ledger is worth having if the
port stops at Phase 1. The parity rows are **PROPOSED**. Mitchell approves or changes the
numbers, and the date of that decision is recorded on the line below the table.

Phase 1 — the ledger:

- [ ] **Per-step rows exist.** Every agent step of an `/ask` turn writes one row: resolved
      model id, tier, input, cached-read, cached-write and output tokens, finish reason, and
      whether the step escalated. The rows are keyed so that writing the same step twice
      leaves one row. An integration test writes a turn twice and counts the rows.
- [ ] **Per-tool rows exist.** Every tool call writes one row with tool name, outcome, duration,
      input and output size, and whether its result reached the proposal. Outcome is `ok`,
      `failed`, `repaired` or `refused-by-grant`. Keyed on `(turn, callId)`.
- [ ] **No user text and no money** in either table. The existing `aiUsage.noMoney` guard
      covers the new tables, and is seen to fail when a dollar column is added to one.
- [ ] **Rows are written on all three end paths** (completed, error, abort), from the
      recorder's existing single-writer latch, not a new one.
- [ ] **The `ai-usage` skill answers the tool question from the database.** It covers:
      - failure rate per tool;
      - p50 and p75 duration per tool;
      - tokens per turn at p50 and p75, with cached share;
      - proposal-reached rate;
      - escalation rate.

      Its stale `askAnalytics.ts` path is fixed.
- [ ] **[operator]** An AI Gateway project spend budget with alerts is set in the dashboard.
      This is Mitchell's to do; the box records the amount.
- [ ] **A baseline is recorded** in this file. Phase 1 defines the live set as a committed file
      and runs it on the current stack, on a preview. The record gives the parity numbers and
      n. Phase 5 re-runs the same file on eve.

Phases 2–5 — the port:

- [ ] `eve` imports only under `apps/web/agent/**`. A lint test fails on an `eve` import under
      `server/assistant/**`.
- [ ] A session is bound to one trip, from `auth.initiator`. Three integration or e2e cases,
      each seen to fail:
      - a member claiming another trip still acts on the bound one;
      - a non-member's turn is cancelled before any model step;
      - **a non-member cannot read the session's stream** (`assistant_sessions`).
- [ ] `apply_proposal` commits once per `proposalId` under a replayed step, and refuses a
      proposal older than 24 hours. Both cases are seen to fail.
- [ ] The browser thread survives a reload and a second device, from the server, and
      `ask_thread_v1` is gone. The contract change is in `docs/contracts/CHANGELOG.md`.
- [ ] The five replay transcripts run as `defineEval` in CI on `mockModel()`, spending nothing.
- [ ] **Parity on the live set, eve vs the Phase 1 baseline, all five rows within threshold**
      (table below), measured from the ledger, not from Agent Runs.
- [ ] **[walk]** A preview walk covers: ask, propose, approve, reload mid-turn and resume, and
      a second browser sees the thread. The walk also confirms the Vercel World is in use,
      not the Local World fallback (ADR-062 finding (d)).
- [ ] The old `/ask` route and its flag are deleted after the parity box is ticked.

### Parity thresholds — PROPOSED, awaiting Mitchell

Each row compares the eve stack (E) with the current-stack baseline (B), on the same live set
and the same model configuration.

| Metric | Threshold (E must be…) | Why this number |
|---|---|---|
| Tool failure rate (`failed` + `repaired` over all calls) | ≤ B + 2 percentage points | The tools and their schemas are unchanged. Failures can rise only from the adapter's wrapping, so a large rise means a wrapping bug, not noise. |
| Median tokens per turn | ≤ 1.10 × B | eve keeps history server-side, as we do today by re-sending it. Some overhead is expected from eve's system and harness prompt; more than 10% means the prompt grew. |
| p75 tokens per turn | ≤ 1.15 × B | The tail is where escalations and long threads live. A little more slack is given because a model switch at escalation re-ingests the conversation uncached (ADR-062 §3). |
| p75 turn latency | ≤ 1.25 × B, **and** ≤ B + 3 s | Workflow adds a checkpoint at every step. Both bounds apply, so a fast baseline is not allowed a huge absolute slowdown. |
| Proposal-reached rate (change-intent prompts that end in a proposal) | ≥ B − 5 percentage points | This is the product outcome. Five points is about one prompt in twenty on a set this size; anything worse is a regression a user would feel. |
| *Proposed addition:* cost per turn (model tokens priced by the dated rate record, plus Workflow events and data written) | ≤ 1.75 × B | Phase 0 measured Workflow at about 20–70% of today's model cost per turn. The gate should say out loud how much of that we accept. |

**The live set, proposed.** Fifteen prompts:

- the five replay transcripts' opening turns;
- five change-intent prompts;
- five question-only prompts.

Each is run three times per stack on one preview, which gives about 45 turns per stack. A p75
on 45 turns is coarse. If a row lands within 5% of its bound, the set is re-run once before
the result is read either way.

*Mitchell's decision on these thresholds: — (not yet given)*

## Prerequisites

- **M19's gate closes**, or Mitchell reorders.
- **Phase 1 needs nothing from eve** and can start as soon as M31 is current.
- **Phase 5's live run needs `ai-live` on for the preview** (ADR-019) and a real model call.
  That run is also what M9's gate is waiting for.
- **Vercel CLI 59.16 or newer** for `vercel dev --local` with eve. This box has 54.21.1.
