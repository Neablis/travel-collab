# ADR-032 — Sentry carries errors, traces, profiles, AI agent runs and metrics; the AI spans are hand-written

**Status:** Accepted (2026-08-30).

**Depends on:** ADR-015 (AI generation goes through the Vercel AI Gateway),
ADR-019 (one model-selection chokepoint, one kill switch), ADR-022 (the
read-only assistant agent, and its "a tool is earned" rule).

**Relates to:** KI-11 (per-turn AI observability), the `ai-usage` skill.

## Context

`Added sentry` (6a5501e) ran the Sentry wizard and committed what it produced:
three `Sentry.init` calls with the DSN and sample rates copy-pasted into each,
an example page, an example API route, and its own installation-error log. That
is error reporting and tracing, and nothing else. What was asked for is the rest
of it — **profiles, AI agent monitoring, and metrics, with the assistant's token
usage and tool calls wired into the metrics.**

Two facts about this repo shape the answer.

**First, the numbers already exist.** `askAnalytics.ts` builds one
`AskAnalyticsRecord` per `/ask` turn — model, steps, every tool call, offered
vs uncalled tools, the classifier's verdict and its own token usage, the
per-step usage, dropped writes, the failure cause, latency. `handleAiRequest`
builds an `AiCallMeta` per command generation. `handleApplyProposalRequest`
writes a `ProposalApplyRecord` per Approve. None of this needed to be
re-derived; it needed a second shape. A log line answers "what happened in this
turn". It cannot answer "are we spending more output tokens than last week"
without a query nobody runs.

**Second, the obvious integration does not work here.** Sentry ships
`vercelAIIntegration()` for exactly this job. It is unusable on this codebase
for two independent reasons, either of which is sufficient:

1. Its instrumentation declares `SUPPORTED_VERSIONS = [">=3.0.0 <7"]`
   (`@sentry/node@10.72.0`,
   `integrations/tracing/vercelai/instrumentation.js`). This app is on
   `ai@7.0.34`. The patch never applies. It also patches
   `generateText`/`streamText` at the module boundary, and the `/ask` endpoint
   calls neither directly — it drives a `ToolLoopAgent`.
2. `ai@7` moved OpenTelemetry out of the core package entirely (its CHANGELOG:
   *"create new opentelemetry package (@ai-sdk/otel)"*). Adding `@ai-sdk/otel`
   back would not close the gap either: its spans follow the OTel GenAI
   convention — named `invoke_agent {model}`, `chat {model}`,
   `execute_tool {name}` — and Sentry's OTel bridge infers a `sentry.op` from
   HTTP, DB, RPC, messaging and FaaS attributes **and from nothing else**
   (`inferSpanData`, `@sentry/opentelemetry@10.72.0`). Those spans arrive with
   no op, and Sentry's AI Agents product keys off `op: "gen_ai.*"`. They would
   be invisible in the exact product they were emitted for. Closing that needs
   a span processor of our own — and `@ai-sdk/otel` pins `ai` to an EXACT
   version (`@ai-sdk/otel@1.0.34` → `ai@7.0.34`), so every `ai` bump would
   either need a matching bump or silently install a second copy of `ai`.

## Decision

### 1. One shared options module; DSN and every sample rate read from the environment

`apps/web/sentry.shared.ts` holds what all three runtimes share. Each
`sentry.*.config.ts` adds only what is specific to it. The DSN literal the
wizard pasted three times is now a fallback behind `NEXT_PUBLIC_SENTRY_DSN`;
setting it to the empty string disables Sentry, which is what a local session
usually wants rather than filing its noise against the shared project.

`enableLogs` and `enableMetrics` are both on. Neither is a default, and both
fail **silently** when off — the wizard's own example route already called
`Sentry.logger.info` into a no-op, and every `Sentry.metrics.*` call below
would have done the same.

A sample rate that is not a number in `[0, 1]` falls back to the default
instead of becoming `NaN`. This is not defensiveness for its own sake: Sentry
samples with `Math.random() < rate`, and `NaN` loses every comparison — a
typo'd variable would turn a feature OFF while the deployment's config reads as
if someone had turned it up.

### 2. Profiling on both runtimes, with the two things each one actually needs

* **Browser:** `browserProfilingIntegration()` **plus**
  `Document-Policy: js-profiling` on every route in `next.config.ts`. The JS
  Self-Profiling API is gated on that header; without it the integration
  initialises, fails to construct a profiler, and disables itself for the
  session — silently, outside a debug build. "Browser profiling is enabled" is
  a claim about both files, so `next.config.test.ts` asserts the header.
* **Server:** `@sentry/profiling-node`, imported dynamically and guarded, and
  listed in `serverExternalPackages` so the bundler leaves its prebuilt binary
  alone. The guard is the point: that import resolves a `.node` file at
  runtime, and `sentry.server.config.ts` is loaded by `register()` — an
  unguarded throw there would take the whole server SDK down (no errors, no
  traces, no metrics) because one optional feature could not load.
* Both use `profileLifecycle: "trace"`, so the profiler only runs while a
  sampled root span is open. On a serverless function that is the span of a
  request, which is the only window worth paying for.

### 3. The AI agent spans are written against Sentry's own API

`apps/web/src/server/ai/aiTelemetry.ts` emits `gen_ai.invoke_agent`,
`gen_ai.chat` and `gen_ai.execute_tool` spans directly, with the op set
explicitly and the attribute names taken from Sentry's own
`tracing/ai/gen-ai-attributes` table. Given the Context above, this is the
option that works today and the one with no version coupling to `ai`.

Three properties it is built around:

* **The parent is captured once, at turn start.** `/ask` streams, so
  `onStepEnd`, the tool callbacks and `onEnd` all fire after
  `handleAskRequest` has returned its `Response`. A trace reading the ambient
  active span lazily would attach step 1 to the request and orphan everything
  after it into traces of its own.
* **Timing comes from the SDK, never from a clock read in a callback.**
  `onStepStart`/`onStepEnd` bracket a real model round-trip;
  `onToolExecutionEnd` reports a measured `toolExecutionMs`, from which the
  tool span's window is reconstructed. This is also why no tool's `execute` is
  wrapped — `readTools.ts` documents at length that annotating that tool set
  collapses its context typing to `never`.
* **No prompt, no answer, no tool payload reaches a span**, and the TYPES are
  what say so: the parameter types have nowhere to put content, so adding it
  would be a deliberate edit. `askAnalytics.ts` decided, once and explicitly,
  that a user's question may go into *our own* structured log; that decision
  does not transfer to a third-party service by default.

### 4. Metrics are derived from the records that already exist, by one writer

`apps/web/src/server/ai/aiMetrics.ts` turns each record into counters and
distributions. It is wired **inside the existing sinks**, not beside them:
`createAskRecorder`'s single-writer latch already guarantees exactly one call
per turn across all three end paths (`onEnd`, abort, error), which makes it the
one correct place to also close the span and emit the metrics. Repeating that
once-only logic at three call sites is how one of them ends up wrong.

Two rules hold for every attribute:

* **Bounded cardinality.** A metric attribute is a series. `tripId` and
  `userId` are never attributes, even though they are on every log record.
* **No user content.** The question, the classifier's raw verdict, a provider's
  error message and a model's human refs stay on the log record. The error's
  `name` and HTTP status are attributes, because a 429 and a 500 demand
  opposite responses and read identically in prose.

Token counters are **counters incremented by the token count**, so they sum to
real spend, and the same metric names are shared by `/ask` and `/ai` —
separated by an `agent` attribute — because both reach the same gateway on the
same key and a bill that counted one of them would be wrong by whatever the
other spends. `ai.tool.offered` / `gen_ai.tool.calls` / `ai.tool.uncalled` are
the aggregate form of ADR-022's "a tool is earned by a new computation" rule:
a tool nobody calls becomes a number rather than an impression.

## Consequences

* Sentry now carries: errors, traces, browser and server CPU profiles, Session
  Replay, structured logs, agent runs in the AI Agents view, and metrics for
  token spend, tool calls, classification, failures and proposal approvals.
* **The gen_ai spans ride on `tracesSampleRate`.** Turning tracing down turns
  the AI Agents view down with it. Both are at 1.0 and both are one
  environment variable away from being turned down when traffic justifies it.
* **This is code we own and have to maintain.** If Sentry's
  `vercelAIIntegration` ever supports `ai@7` — or if `@ai-sdk/otel` stops
  pinning `ai` exactly AND Sentry starts inferring an op from
  `gen_ai.operation.name` — revisit this and delete `aiTelemetry.ts` in favour
  of it. Both conditions are checkable in a few minutes; neither held on
  2026-08-30 against `@sentry/nextjs@10.72.0` and `ai@7.0.34`.
* `askAnalytics.ts` is unchanged and still has no Sentry dependency, so the
  `ai.ask` log line and the `ai-usage` skill that reads it keep working with no
  Sentry client at all.
* The wizard's `sentry-example-page` and `sentry-example-api` are deliberately
  KEPT: they are how you confirm, from a deployed preview, that events reach
  the project at all. `check-color-wall.mjs` already exempts the page as
  third-party codegen.

## What was verified

* `pnpm --filter web typecheck`, `lint`, and the full unit suite.
* A committed end-to-end test (`aiTelemetry.envelope.test.ts`) boots a real
  Sentry client with a capturing transport and asserts the bytes: one
  `gen_ai.invoke_agent`, one `gen_ai.chat` per round-trip, one
  `gen_ai.execute_tool`, all in one trace and correctly nested; eleven metric
  names including the token counters; and no question text or unbounded
  identifier anywhere in the payload.
* A production build (`next build`) and `next start`: the server boots with no
  "server CPU profiling is unavailable" warning — so the native profiler
  really does load in a built app — and a real response carries
  `Document-Policy: js-profiling` on both the global route and the
  `/s|invite` route, with the CSP and the per-route `Referrer-Policy`
  unchanged.
