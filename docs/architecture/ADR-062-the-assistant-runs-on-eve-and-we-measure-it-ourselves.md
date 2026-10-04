# ADR-062: The assistant runs on eve, the kernel stays ours, and we measure it ourselves

**Status:** **Proposed — 2026-10-02.** Mitchell chose the full port (option 2 of three) and
set two terms in the same conversation: measurement and visibility are kept as a first-class
goal, and user memory is designed for but built later. Nothing here is built. Acceptance is
the planning session that turns this into a milestone. **2026-10-03:** that session minted
M31 and ran Phase 0 (*Phase 0 findings*, below; (a) holds). **The same day Mitchell built
Phase 1 and deferred the port**: *"I want to get some users before i increase the cost of my
AI usage by moving to eve and workflow"*. Decision 5's ledger is built (M31). Decisions 1–4,
6, 7 and 8 stay Proposed, parked under *Deferred: the port* below with the triggers that
reopen them.
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

Milestone: **M31** (`docs/milestones/M31-assistant-ledger.md`) is Phase 1, the ledger, built
2026-10-03. The port has no milestone; it is a candidate (`docs/candidates.md`).

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

> **Answered in Phase 0 (2026-10-03), see *Phase 0 findings (a)*:** the binding is eve's
> pinned `auth.initiator`, and a stream-read gap adds an `assistant_sessions` table.
> Original question, kept for the reasoning: eve's docs do not say how app data is attached to a session at
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

Phase 1 is **M31** (`docs/milestones/M31-assistant-ledger.md`), built 2026-10-03; its plan is
`docs/plans/2026-10-03-M31-p1-ledger.md`. Phases 2–5 are deferred: see *Deferred: the port*.

## Phase 0 findings (2026-10-03)

Run as a throwaway spike in a scratch directory, never in `apps/web`: `eve@0.70.1` (the
`latest` tag on 2026-10-02), `node_modules/eve/docs` read in full where relevant, and a fixture
agent run under `eve dev --no-ui` against eve's local Workflow world. The fixture had a
deterministic `mockModel`, a custom `AuthFn`, a `turn.started` re-guard hook, one tool that
reports the binding, one `approval: always()` tool, and a `defineInstrumentation` file that
logged every ledger-relevant event. Nothing from it is kept. Vercel's own pages
(`vercel.com/docs/workflows/pricing`, `vercel.com/pricing`) and the Workflow SDK's
(`workflow-sdk.dev`) were read on 2026-10-03.

**Verdict: (a) holds, so the plan continues.** (b) changes how Decision 4 is built. It does not
change what Decision 4 requires. One new finding, the *session stream* below, adds a table to
Phase 2 that the ADR did not foresee.

### (a) Write-once trip binding: yes, by `auth.initiator`, proven

Neither candidate the ADR named is the best mechanism.

- `defineState` has an `update()` that any runtime code can call. It is write-once only by
  convention.
- The default eve channel's `onMessage` returns `{ auth, context, title }` and can carry no
  state.
- A custom channel's `state` *is* seeded only when `send()` creates the session. But a custom
  channel's routes are not the ones `useEveAgent` talks to, so the browser client would have to
  be our own.

The mechanism that works is eve's own pinned initiator:

- Our `AuthFn` reads the trip from the request and runs the guard **before any session
  exists**. It throws `ForbiddenError` for a non-member. It returns
  `{ principalId: userId, principalType: "user", attributes: { tripId } }`.
- `ctx.session.auth.initiator` is fixed at creation. eve's auth docs: *"A follow-up message
  updates `auth.current` but leaves `auth.initiator` alone."*
- The binding is `initiator.attributes.tripId`, and nothing else is ever read as the trip.

Evidence from the fixture. alice is a member of tripA; mallory is a member of tripB only.

| Request | Result |
|---|---|
| alice creates a session with `tripA` | the tool reads `boundTrip: "tripA"` |
| alice follows up claiming `tripB` while not a member | **403** from the `AuthFn`; no delivery |
| alice is made a member of both trips, then follows up claiming `tripB` | 202. `current.attributes.tripId` is `tripB`, and **the tool still reads `boundTrip: "tripA"`** |
| mallory follows up on alice's session with her own valid `tripB` | 202 at route auth. The `turn.started` hook's `guard(initiator.tripId, current.principalId)` fails, `ctx.cancel()` runs, and the stream shows `turn.cancelled` **with no model step** |

**New finding: eve does not check who owns a session, and the stream is readable.** In the same
run, mallory's `GET /eve/v1/session/:id/stream` returned alice's whole conversation. eve's docs
say so plainly: *"Route auth does not enforce session ownership … you must implement the
per-user, per-tenant, or per-session authorization your application requires."* The
`turn.started` re-guard stops a non-member from *acting*. Only route auth can stop them
*reading*.

Phase 2 therefore adds **an `assistant_sessions` table**: `session_id`, `trip_id` and
`created_by`, written when the session is created. The `AuthFn` checks it on every
`/eve/v1/session/:id*` request, the stream included, by running the trip guard for the
caller. Because the table lives in each environment's own Postgres, it also refuses a
production session id presented to a preview, which is (d)'s residual risk.

**Simulated model, for Decision 3:** session- and turn-scoped model resolvers may return only
model id *strings*; a live `LanguageModel` object is allowed only from `step.started`. The
simulated model (ADR-019) is a `LanguageModel`, so the `ai-live`-off branch lives in a
`step.started` resolver.

### (b) Approval expiry: eve has none, so it is ours, at commit time

- **eve has no TTL.** Nothing in the docs or the `ApprovalRequest` type carries a deadline or a
  timestamp. The HITL docs: the run *"waits durably, for as long as it takes — seconds or
  days"*.
- **`sessionTimeoutMs` does not expire a parked approval.** With `sessionTimeoutMs: 40_000`, an
  approval parked at 23:45:48 was approved at 23:47:11, 43 seconds past the deadline.
  **`apply_proposal` executed and committed.** Only then did `session.completed` fire. *"At
  the deadline, eve lets an active turn settle"*, and a turn waiting on a person has not
  settled.
- **Cancelling withdraws it.** `POST …/cancel` on a parked turn followed by the approve
  committed nothing. eve turned the late answer into a plain message: *"This does not
  authorize an earlier action; request approval again if that action is still needed."*

What Phase 3 builds:

1. **The guarantee is in `apply_proposal`'s `execute`.** It refuses a proposal whose server
   record is older than 24 hours, as `expired`, before `commitProposal`. The record is keyed by
   `proposalId` and is the same ADR-051 row that makes the commit idempotent. This holds
   whatever eve does, because it is the commit itself that checks.
2. **Clean-up of the parked turn is lazy and needs no Cron.** When the client re-attaches to a
   session, the server cancels any turn parked on an expired proposal.
3. **The old-code window stays.** The parked turn resumes on the deployment that created it,
   so the expiry check runs on old code too. Twenty-four hours bounds the window but does not
   close it. Phase 3 decides whether `commitProposal` also refuses when the database's
   migration head is newer than the build's.

### (c) Cached tokens: yes, and the key is replay-stable

`model.call.completed.usage` is eve's `InstrumentationUsage`:

```ts
{ inputTokens?, outputTokens?, costUsd?,
  inputTokenDetails?: { cacheReadTokens?, cacheWriteTokens? } }
```

It is from `dist/src/instrumentation/lifecycle.d.ts`. A field is absent when the provider omits
it. Every `model.call.completed` in the fixture carried
`inputTokenDetails: { cacheReadTokens, cacheWriteTokens }`. Those were zeros, because the model
was a mock: the *shape* is proven, and the values ride on the provider.

Three details for the ledger:

- **The `idempotencyKey` is replay-stable.** It is
  `model:<session>:<turn>:<step>:<attempt>:<n>:<call>` and is reconstructed on replay. The
  ADR's "re-fire with new event ids" is true of stream event ids, not of these keys. A
  per-step row keyed `(turnId, stepIndex)` remains correct, and retries of one step are
  `attemptIndex`es inside it.
- **`tool.call.completed` carries no tool name and no `callId`.** It must be joined to its
  `tool.call.started` on the shared `idempotencyKey`, or carried in the file's `ctx.state`.
- **`step.attempt.metadata` carries AI Gateway's provider metadata**, including its cost data,
  when the call went through the Gateway.

Correction to Decision 5's "dollars come from our rate table": **no dollar is stored at all.**
`ledger.ts` rule 2 and `usage.noMoney.test.ts` forbid it. Price is a join, performed
downstream against the dated rate record, and the new ledger tables obey the same rule.

### (d) Workflow store across preview and production: separate, with one trap

- **Isolated per environment.** The Vercel World *"isolates data per environment (production,
  preview, development)"* (workflow-sdk.dev, *Vercel World*).
- **Runs cannot cross environments.** Since Workflow 5.0, *"`start()` stamps the environment it
  was called from onto the queue message, and a deployment refuses a delivery whose run was
  created in a different environment."*
- **Each run is pinned to its deployment.** eve's vendored client keys runs by `projectId` and
  `runId`, and guards deployment affinity.
- **Trap: the Local World fallback.** If the project's *"Enable access to System Environment
  Variables"* setting is off, *"a Vercel deployment is indistinguishable from a non-Vercel
  environment"*. The runtime then selects the **Local World, which stores workflow state on the
  filesystem**, silently. Phase 2's preview walk asserts the Vercel World is in use.

### (e) What a turn costs on Workflow

Vercel's rates, 2026-10-03, from `vercel.com/docs/workflows/pricing`:

| Resource | Hobby | Pro |
|---|---|---|
| Workflow events | 50K a month included | $0.02 per 1K |
| Data written | 1 GB included | $0.50 per GB |
| Data retained | not available | $0.50 per GB-month, kept 7 days after a run completes |
| Queues | 1M operations included | from $0.60 per 1M |

Compute stays at Fluid rates. **Pro has no included Workflow events**: it is billed from the
first one.

Measured from the local world's event log, in Workflow events, not stream events:

| What | Events | Data written |
|---|---|---|
| A session's creation plus its first one-tool turn | 22 | ≈ 46 KB |
| A one-tool turn (2 model steps) | 11 | ≈ 33 KB |
| A three-tool turn (4 model steps) | 35 | ≈ 115 KB |
| An approval round trip (park, then approve and commit) | 12 | ≈ 42 KB |

**One representative turn, three tools, costs about $0.0008 on Workflow.** That is $0.0007 in
events, under $0.0001 in data, and negligible Queues and retention. A one-tool turn is about
$0.0002.

Against today's measured model cost of about **$0.0011 per request** (`ledger.ts`), Workflow
adds **roughly 20 to 70 percent** to a turn's spend. That is not negligible. The fixture's
payloads were tiny, so data written will be larger with real tool results, but events
dominate the price.

This is why the port's proposed parity thresholds (*Deferred: the port*) have a cost row, not just a token row.

**Limit that shapes Phase 2:** one eve session is one Workflow run. Vercel caps a run at
**25,000 events** and warns that replay slows past **2,000**. At 11 to 35 events a turn, that
is about 60 to 180 turns before replay slows. So a session has to be bounded:

- a `sessionTimeoutMs` far below the 30-day default, which Decision 6 already intends;
- **and** a turn ceiling after which the client starts a fresh session.

Phase 2 sets both, and records them in the session contract.

## Deferred: the port (2026-10-03)

**Phases 2–5 are parked, with everything learned kept.** Mitchell, 2026-10-03, after Phase 0
priced Workflow at roughly 20–70% of a turn's model cost: get users first, then decide.

Three facts made deferring cheap:

- **Nothing to protect yet.** `ai-live` is still Simulated in production, so no real user
  traffic exists for durability to protect.
- **The ledger works on either stack.** Phase 1 does not depend on eve. The eve
  instrumentation would feed the same tables later (Phase 0 finding (c)).
- **The design keeps the port an adapter.** Decision 1 keeps the kernel framework-free. A
  later port is still an adapter around unchanged tools, admission and commit, not a rewrite.

### What reopens it

Any one of these, read from the ledger where it is a number:

1. **Turns are being lost.** `ledger.sql` query 7 shows real (non-simulated) turns ending
   `abort` with the server's deadline as the cause, at a rate worth fixing. Durable turns are
   the port's first benefit.
2. **A feature needs work nobody is waiting on.** For example a pre-trip check, a scheduled
   agent, or an approval that has to wait for days. The current shape cannot do these at all
   (*Context*, limit 3).
3. **eve reaches 1.0**, or stops breaking its API between minors.
4. **Paying users make the cost legible.** Paid traffic exists and the ledger shows what a
   turn costs, so the Workflow overhead from finding (e) is a decision about a known amount.

Cross-device threads, by themselves, are **not** a trigger. They need a conversations table,
not eve.

### What reopening starts with

1. Re-run the Phase 0 checks against the eve version current at that time. Findings (a) and
   (b) were proven on `eve@0.70.1` and are worth one afternoon to re-prove.
2. Mint the port's milestone from Phases 2–5 above, including the two findings that added
   work: the `assistant_sessions` ownership check and a per-session turn ceiling.
3. Approve the parity thresholds below. They were proposed on 2026-10-03 and never approved.
4. Run the live set on the eve stack against the baseline M31 records.

### Parity thresholds, as proposed (not approved)

Each row compares the eve stack (E) with the current-stack baseline (B). Both are measured
from the ledger, on the live set (`apps/web/src/server/ai/eval/live-set.json`: 15 prompts ×
3 runs), with the same model configuration.

| Metric | Threshold (E must be…) | Why this number |
|---|---|---|
| Tool failure rate (`failed` + `repaired` over all calls) | ≤ B + 2 percentage points | The tools and their schemas are unchanged. Failures can rise only from the adapter's wrapping, so a large rise means a wrapping bug, not noise. |
| Median tokens per turn | ≤ 1.10 × B | eve's own harness prompt adds some overhead. More than 10% means the prompt grew. |
| p75 tokens per turn | ≤ 1.15 × B | The tail is where escalations and long threads live. A little more slack is given because a model switch at escalation re-ingests the conversation uncached. |
| p75 turn latency | ≤ 1.25 × B **and** ≤ B + 3 s | Workflow adds a checkpoint at every step. Both bounds apply, so a fast baseline is not allowed a large absolute slowdown. |
| Proposal-reached rate (change prompts) | ≥ B − 5 percentage points | This is the product outcome. Five points is about one prompt in twenty on a set this size. |
| Cost per turn (model tokens priced per step, plus Workflow events and data written) | ≤ 1.75 × B | Phase 0 measured Workflow at about 20–70% of a turn's model cost. This row says out loud how much of that is acceptable. |

A p75 on 45 turns is coarse. If a row lands within 5% of its bound, the set is re-run once
before the result is read either way.

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
