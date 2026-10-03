# ADR-062: The assistant runs on eve, the kernel stays ours, and we measure it ourselves

**Status:** **Proposed — 2026-10-02.** Mitchell chose the full port (option 2 of three) and
set two terms in the same conversation: measurement and visibility are kept as a first-class
goal, and user memory is designed for but built later. Nothing here is built. Acceptance is
the planning session that turns this into a milestone.
**Deciders:** Mitchell (product/eng); Claude — drafted
Supersedes:
- **ADR-033 Decision 1** — the one AI route is no longer `/api/trips/[tripId]/ask`.
- **ADR-022's 2026-08-29 Amendment** — its conclusion only. Its reasoning is honoured; see
  Decision 4.

Amends:
- **ADR-019** — where the model is chosen.
- **ADR-032** — who emits the AI spans.
- **ADR-043** — where admission runs.

Carried forward unchanged:
- ADR-033 Decisions 2–3: tools come from server-resolved facts, and width is a separate axis.
- ADR-022 §3: identity comes from context, never from the model.
- ADR-013: one approved plan is one batch, one history entry and one undo.
- ADR-051: idempotency keys.
- AGENTS.md Invariants 1, 5 and 7.

Related:
- KI-11 (per-turn AI observability).
- KI-2026-09-14-b (`ai_usage` is best-effort on abort).
- KI-2026-09-17-c (escalated turns bill the wrong model).
- The `ai-usage` skill.

Milestone: none yet. The milestone is placed **after M19** and minted by the planning session.

## Context

Today the assistant is a request-scoped agent:

- **One call per turn.** One `ToolLoopAgent` run inside one 300-second function invocation
  (`handleAskRequest.ts`), with a soft deadline at 150s and a hard abort at 240s.
- **The thread lives in the browser.** It is stored in `localStorage` (`ask_thread_v1`) and
  re-sent each turn, up to 40 messages.
- **Proposals live in the stream.** A proposal leaves in the `finish` metadata and comes back
  from the client to `/ask/apply`. That route has no idempotency key.
- **Measurement is one row per turn.** We record one `ai_usage` row per turn, an `ai.ask` log
  line, and Sentry's AI spans.

The pieces that matter are already framework-free (ADR-043):

- **Tools** are modules that declare `effect`, `spend`, `needs` and `minimumRole`.
- **Admission** is one nine-stage pipeline.
- **Grants** are `min(role, plan, classifier)`.
- **Data access** arrives through injected ports, behind a lint wall that keeps `next/*` and
  `@/server/*` out.

Three things the current shape cannot do:

1. **Survive past one invocation.** A turn that outlives the deadline is lost, and there is no
   resume.
2. **Keep a conversation anywhere but one browser.** There is no cross-device thread and no
   server-side record, which also means no path to remembering a user.
3. **Run work nobody is waiting on.** There are no schedules and no background agents, so a
   pre-trip check or a long research pass is impossible.

[eve](https://eve.dev/docs) is Vercel's filesystem-first framework for durable agents. Its
relevant properties, read from its docs on 2026-10-02 at `eve@0.70.1`:

- **Durable sessions** on Vercel Workflow. A checkpoint lands at every step, and an
  interrupted turn resumes from the last completed step.
- **Durable approvals.** `approval: always()` parks a turn and holds no compute while it waits.
- **Capabilities resolved at runtime.** `defineDynamic` resolves tools, model and instructions
  at `session.started`, `turn.started` or `step.started`. Tools re-read before every model call.
- **Hooks** that are observe-only, can `ctx.cancel()` a turn or step before the model runs,
  and are delivered at least once.
- **Lifecycle instrumentation**: `model.call.completed` carries usage, and
  `tool.call.started|completed|failed` carry timing and outcome. On top of that, OpenTelemetry
  goes to **Agent Runs**, Vercel's built-in trace view.
- **Memory providers**, keyed by a scope the model cannot change. They recall at turn start
  and capture at turn end.
- **Evals** with `defineEval`, hard gates, LLM-judge soft assertions, `mockModel()` and
  `eve eval --strict`.
- **Integration**: `withEve` mounts it in a Next.js app, and the browser client is
  `useEveAgent`.

It is also **pre-1.0 and moving fast**:

- 0.69 removed the subagent events and background tasks.
- 0.45 abandoned pending work on upgrade.
- It vendors Workflow SDK `5.0.0-beta`.

That instability shapes Decision 1 more than anything else here.

## Decision

### 1. eve is an adapter. The kernel stays framework-free, and the wall says so

`apps/web/src/server/assistant/**` stays exactly as ADR-043 drew it: no `next/*`, no
`@/server/*` beyond the three allowed imports, and **no `eve`**. The lint wall gains `eve` and
`eve/*` as forbidden imports there.

eve lives in one `agent/` directory, the adapter. In it:

- Each file in `agent/tools/` wraps an existing kernel tool's `run`.
- `agent/agent.ts` and the dynamic resolvers call the existing admission, grant and
  model-selection code.
- Hooks and instrumentation call the existing recorder.

The point: if eve breaks an API, changes direction or is abandoned, we lose an adapter and
keep the assistant. The 23 tools, the batch resolver, the proposal builder and the commit
path are not rewritten. They are re-hosted.

`eve` is pinned to an exact version and excluded from the Dependabot groups. Every upgrade is
a deliberate PR that re-runs the eval set (Decision 7).

### 2. One trip per session, bound on the server and re-checked every turn

ADR-033's door moves:

| | Path |
|---|---|
| Today | `/api/trips/:tripId/ask` |
| With eve | eve's session routes: `/eve/v1/session`, or `/eve/assistant/v1/*` for a named agent |

The trip is no longer in the URL. ADR-033 Decision 2, that capability comes from
server-resolved facts and never a client field, is the rule that makes that safe. It applies
as follows:

- **Binding.** A session is bound to exactly one `tripId` when it is created. The binding is
  derived on the server from a guarded request and written once to durable session state.
  Nothing the client sends on a later turn can change it.
- **Re-checking.** Every turn, the `turn.started` resolver re-runs
  `guard(tripId, minimumRole)` for `auth.current`, the caller of *this* turn, not the session's
  initiator. Roles change mid-session; a collaborator removed on Tuesday must not keep a
  Monday session.
- **Failing closed.** If the guard fails, the turn is cancelled before any model call.
- **Route auth.** Our own `AuthFn` replaces `placeholderAuth()`. It verifies the session
  cookie and returns `{ principalId: userId, principalType: "user" }`. eve fails closed by
  default; we keep it that way.
- **Tools.** Tools still never take a `tripId` (ADR-022 §3). They read it from session state.
- **The demo trip.** It is refused before session creation (KI-079), exactly as today.

> **To verify in Phase 0:** eve's docs do not say how app data is attached to a session at
> creation, or whether it is immutable. The candidates are a `defineState` slot written on the
> first turn, or our own channel's `onMessage`. If neither can be made write-once, this
> decision needs a different mechanism before any other phase starts.

### 3. Admission becomes resolvers and a cancelling hook, and its ledger survives

ADR-043's nine stages map onto eve without changing what they decide:

| Stage(s) | eve home |
|---|---|
| `refuseDemoTrip`, `identifyActor`, `capRawBody`, `parseRequest` | `AuthFn`, plus session creation |
| `resolveSurface`, `selectModel`, `classifyTask`, `grantTools` | `turn.started` dynamic resolver (model, tools, instructions) |
| `admitQuota` | `turn.started` hook. It reserves, or calls `ctx.cancel()` |
| escalation (`request_change_tools`) and the soft-deadline wrap-up | `step.started` tool resolver |

- **Per-turn model choice** keeps tier routing. eve's docs warn that a mid-session model
  change re-ingests history uncached. We already pay that today, because the thread is
  re-sent; the ledger (Decision 5) will show whether it matters.
- **The simulated model** (ADR-019) is returned by the model resolver when `ai-live` is off,
  so the kill switch still covers every model call.
- **The gateway chokepoint** moves with it: only the resolver module may import the gateway.

**Built-in tools are off.** eve ships `bash`, `read_file`, `write_file`, `web_fetch`,
`web_search` and `agent` enabled by default. Every one of them breaks Invariant 7, so
`agent.ts` sets `defaultTools: false`. There is no sandbox and no sandbox tool. If one is ever
earned under ADR-022's rule, it gets its own ADR and a network policy tighter than allow-all.

### 4. One approval, on one tool, whose `execute` is the commit

ADR-022's amendment rejected AI SDK `toolApproval` for three reasons. All three were true of
that shape, and none is true of this one:

1. *"It guards `execute`, and `execute` is not what commits."* Here the write tools stay
   collect-only, exactly as now. The model then calls one tool, **`apply_proposal`**, with
   `approval: always()`. Its `execute` runs `commitProposal`, so the guarded step is the
   commit.
2. *"It puts the commit after a second model turn, inside a stream."* Here the turn parks
   durably at the approval, the commit runs inside a checkpointed step, and the model speaks
   *after* it with the committed result in hand. The receipt is derived from what committed,
   which is `planSummary.ts`'s guarantee, now kept by construction. Nothing writes after the
   response is flushed.
3. *"Approval per tool call is not the decision being made."* One call is one proposal, one
   batch, one history entry and one undo. ADR-013 holds.

**Approval is a gate, not authorization.** `apply_proposal`'s executor re-runs everything
`/ask/apply` runs today:

- the guard at `APPLY_MINIMUM_ROLE`,
- `parseApprovedCommands`,
- `readableSavedDay`.

It runs them as the responding principal, and refuses if that principal is not an editor of
the bound trip. eve's multi-tenant approvals pattern says the same thing in its own words.

**It is idempotent.** An interrupted step re-executes its tool calls, so the commit is keyed
on `proposalId` through the ADR-051 table. That closes a gap that exists today, since
`/ask/apply` has no idempotency key.

**Approvals expire.** A parked approval resumes on the deployment that created it, and eve
does not move live work between deployments. An approval left for days could therefore commit
through old code against a newer schema. Pending approvals expire after 24 hours. The exact
eve mechanism is a Phase 0 question; the requirement is not.

### 5. Measurement is ours: a per-step and per-tool ledger, built before the port

Mitchell's standing goal is to know which tool calls work and where tokens are wasted. That is
an aggregate, long-horizon question. Vercel's built-in surfaces were checked on 2026-10-02:

| Surface | What it gives | Why it is not the record |
|---|---|---|
| **Agent Runs** (beta) | Per-run drill-down: step timings, tool arguments and results, reasoning, input/cached/output tokens. Runs and tokens over time. | No documented cross-run totals per tool. No link to our user, plan, classifier verdict or tier. Retention is short and stated inconsistently (30 days in beta on the docs page; 12h on Hobby and 1d on Pro elsewhere). |
| **AI Gateway observability** | Requests and spend by model, project and API key; time to first token; exportable request logs; spend budgets. | Knows models, not tools or turns. |
| **Sentry** (ADR-032) | AI spans and our metrics. | Carries our metrics today; stays a sink, not the record. |

The decision:

- **System of record: our Postgres ledger.** Next to `ai_usage` (one row per turn) go:
  - **one row per step**: model id, tier, input, cached and output tokens, finish reason, and
    whether this step escalated;
  - **one row per tool call**: tool name, outcome (`ok`, `failed`, `repaired`,
    `refused-by-grant`), duration, input and output size, and whether its result reached a
    proposal.
- **No user text in these rows.** This is the same stance `ai_usage` takes today.
- **Built first, on the current stack.** The rows are written by the existing recorder. That
  gives a baseline before any eve code exists, so the port is judged on numbers (Decision 7).
- **Under eve, the rows are written by `agent/instrumentation/ledger.ts`**, a
  `defineInstrumentation` file subscribed to `model.call.completed` and the `tool.call.*`
  events, feeding the same recorder.
- **At-least-once delivery.** Instrumentation and hooks re-fire with *new* event ids when a
  step re-runs. Ledger rows are therefore keyed on `(turnId, stepIndex)` and
  `(turnId, callId)`, never on event id. A re-run step upserts its row; it does not add one.
- **Dollars come from our rate table** (`modelRates.ts`), because eve's `usage.costUsd` exists
  only when the provider reports a price.
- **The `ai-usage` skill gains tool-level queries over these tables.** It already has drift:
  it names the wrong directory for `askAnalytics.ts`.

**Agent Runs is the debugger.** It is enabled, but with an `agentRuns({ exportPolicy })` that
redacts inputs and outputs: the span tree, timings and tokens stay, and users' trip text does
not leave. Before anything unredacted is enabled, the privacy policy has to disclose it.

**AI Gateway carries the hard dollar ceiling.** A project spend budget with alerts is set in
the dashboard. That is independent of this port and should happen now.

### 6. Sessions replace the browser thread; memory gets a slot, not a feature

- **The thread.** eve's durable session is the thread, so `localStorage` (`ask_thread_v1`) and
  the 40-message re-send go. The browser moves to `useEveAgent` with `resume: true`. eve's
  message parts follow AI SDK `UIMessage` conventions, but the types are not interchangeable,
  so `AskStreamMetadata` in `@tc/contracts` changes and gets a CHANGELOG entry.
- **Session timeout.** `sessionTimeoutMs` is set far below eve's 30-day default.
- **Spend ceiling.** `maxTokenCostUsdPerSession` is set as a ceiling beneath our own quotas.
- **Memory.** No memory provider is built in this milestone. What *is* built is everything a
  later one needs:
  - every session carries a stable user principal;
  - the memory scope is decided now as `byPrincipal`, per user, never per trip;
  - `agent/memory.ts` is left as an empty slot.

The memory work, a per-user profile derived from the command and event log and recalled at
turn start, is **its own later milestone**. Mitchell agreed RAG can wait. That milestone
starts with two decisions this ADR deliberately does not take:

1. whether conversation text is stored in our Postgres at all, with what retention and what
   account-deletion path;
2. how memory behaves on a shared trip. One traveller's remembered preferences must never
   surface in a co-traveller's session, and recalled memory enters the prompt as untrusted
   user-role text that `untrusted()` fencing has to cover.

### 7. The port is gated on parity, measured

The milestone's exit gate compares eve with the current stack on the same fixed eval set, and
on the ledger:

- **Evals.**
  - The five replay transcripts in `server/ai/eval/transcripts/` are ported to `defineEval`.
  - CI runs them with `mockModel()` and spends nothing.
  - A small live set runs against a preview deployment, by hand, with `--url`. That live set
    is also the real model call M9's gate is waiting for.
- **Parity, from the ledger.** For the live set, on eve versus the current stack:
  - tool failure rate,
  - median and p75 tokens per turn,
  - p75 turn latency,
  - proposal-reached rate.
- **Thresholds.** The planning session sets them. Without them, "it works" is not a gate.
- **Rollback.** The old `/ask` route survives behind a flag until the gate closes, then is
  deleted, as ADR-033 did to `/ai`.

### 8. How Vercel runs it

- **Same project.** `withEve` from `eve/next` mounts the agent in the existing `apps/web`
  project. `vercel.json` becomes `vercel.ts`, which `withEve` expects.
- **Fluid Compute on Node 24**, which the repo already pins.
- **AI Gateway through Vercel OIDC** instead of a long-lived `AI_GATEWAY_API_KEY`.
- **Vercel Workflow** holds session state. **No Vercel Sandbox.** **No Cron** in this
  milestone; schedules are a later, separate decision.
- **Firewall.** A rate-limit rule covers `/eve/*` in front of our Postgres quotas, so abuse is
  shed before it costs a function invocation.
- **Previews have their own database.** They stopped sharing production's on 2026-09-24
  (KI-2026-09-06-h, resolved). A preview agent's commits therefore stay out of production. Workflow
  session state is *expected* to be per environment too; Phase 0 confirms that Workflow does
  not share a store across environments.
- **Vercel CLI 59.16 or newer.** `vercel dev --local` with eve needs it; the CLI here is at
  54.21.1.

## Phases (for the planning session to size, not a plan)

0. **Spike, throwaway.** Install `eve`, read `node_modules/eve/docs`, and answer the three
   Phase 0 questions:
   - write-once trip binding (Decision 2),
   - approval expiry (Decision 4),
   - whether instrumentation usage carries cached tokens (Decision 5).

   Also price one representative turn on Workflow.
1. **Ledger on the current stack.** Per-step and per-tool rows, the `ai-usage` skill queries,
   and a Gateway spend budget. **This phase ships value whether or not the port continues.**
2. **Adapter.** `agent/` with wrapped tools, resolvers, the hook and instrumentation; built-in
   tools off; the lint wall extended.
3. **`apply_proposal`** with approval, idempotency and expiry.
4. **Client.** `useEveAgent`, resume, the contract change, and `localStorage` removed.
5. **Evals and the parity gate**, then the old route is deleted.

## Alternatives rejected

- **Stay as we are.** The kernel is sound, but the three limits in Context are structural.
  Mitchell chose the port knowing it is the most expensive option.
- **Spike first and decide later** (option 1 of the three offered). Its useful part survives as
  Phase 0. The difference is that this ADR commits to the direction and makes the spike answer
  *how*, not *whether*.
- **Vercel-only changes, then revisit at eve 1.0** (option 3). Its useful parts (OIDC,
  `vercel.ts`, apply idempotency, the spend budget) are all folded in above.
- **Agent Runs as the system of record for measurement.** Rejected in Decision 5: no
  cross-run totals per tool, no link to our domain, short retention.
- **Let eve own the kernel.** That would mean writing tools natively as `defineTool` and
  admission as eve config. It is fewer files, and it couples 23 tools and every invariant to a
  0.x API that broke twice in its last ten releases.
- **A RAG over user lifecycle events in this milestone.** Deferred by agreement (Decision 6).
  When it comes, a derived profile is expected to beat embeddings at our size; that is a
  hypothesis for that milestone, not a decision here.

## Consequences

- **Durability.** A turn survives a function restart, and approvals wait without holding
  compute.
- **The thread** follows the user across devices. It also becomes server-held data with a
  retention period we must state.
- **Apply becomes idempotent.** The gap in today's `/ask/apply` closes as a side effect.
- **Measurement gets better before the port starts.** KI-11 moves, and KI-2026-09-14-b and
  KI-2026-09-17-c are the natural first users of the ledger.
- **ADR-032 changes.** Sentry's VercelAI integration probably stops seeing AI spans, because
  eve emits its own OpenTelemetry. Whether to send eve's spans to Sentry through
  `otelIntegration` or let Agent Runs carry them is a planning-session choice. Our metrics
  are unaffected, because they come from the recorder.
- **ADR-019 changes.** The `selectAiModel` decision point is unchanged, but it is called from
  a resolver instead of a route.
- **New costs**: Workflow events and storage (stream writes are persisted), Always-on Tracing
  for Agent Runs, and an adapter layer to maintain against a fast-moving 0.x dependency.
- **Contract change**: `AskStreamMetadata` and the proposal transport, with a
  `docs/contracts/CHANGELOG.md` entry.
- **Supersession notes.** ADR-022's amendment and ADR-033 Decision 1 each get a one-line note
  pointing here once this ADR is accepted, not before.
