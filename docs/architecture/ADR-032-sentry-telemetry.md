# ADR-032 — Sentry carries errors, traces, profiles, AI agent runs and metrics; the AI spans are Sentry's, the metrics are ours

**Status:** Accepted (2026-08-30).

**Depends on:** ADR-015 (AI generation goes through the Vercel AI Gateway),
ADR-019 (one model-selection chokepoint, one kill switch), ADR-022 (the
read-only assistant agent, and its "a tool is earned" rule).

**Relates to:** KI-11 (per-turn AI observability), the `ai-usage` skill.

## Context

`Added sentry` (6a5501e) ran the Sentry wizard and committed what it produced:
three `Sentry.init` calls with the DSN and sample rates copy-pasted into each,
an example page, an example API route, and its own installation-error log. That
is error reporting and tracing, and nothing else. What was asked for is the
rest — **profiles, AI agent monitoring, and metrics, with the assistant's token
usage and tool calls wired into the metrics.**

Two facts about this repo shape the answer.

**First, the per-turn numbers already exist.** `askAnalytics.ts` builds one
`AskAnalyticsRecord` per `/ask` turn — model, steps, every tool call, offered
vs uncalled tools, the classifier's verdict and its own token usage, dropped
writes, the failure cause, latency. `handleAiRequest` builds an `AiCallMeta`
per command generation; `handleApplyProposalRequest` writes a
`ProposalApplyRecord` per Approve. None of this needed re-deriving; it needed a
second shape. A log line answers "what happened in this turn". It cannot answer
"are we spending more output tokens than last week" without a query nobody runs.

**Second — and this is the correction that produced this ADR's final shape —
Sentry already instruments the AI SDK here, and it was not obvious.**
`@sentry/node`'s OpenTelemetry-based Vercel AI instrumentation declares
`SUPPORTED_VERSIONS = [">=3.0.0 <7"]`, and this app is on `ai@7`. Reading only
that, the first version of this change concluded Sentry could not see this
app's agent at all and hand-wrote a `gen_ai.*` span emitter. **That conclusion
was wrong.** The version gate governs one of two mechanisms. `ai@7` publishes
its own telemetry to a Node `diagnostics_channel` named `ai:telemetry`, and
`@sentry/server-utils`' `vercelAiIntegration` — the base that
`vercelAIIntegration()` extends, and a **default** integration in
`@sentry/node` — subscribes to it and emits, in its own words, "fully-formed
`gen_ai.*` spans directly — no OpenTelemetry span post-processing involved."

That was settled by running it rather than by reading more. A real turn through
the real `ToolLoopAgent`, against a real Sentry client with a capturing
transport, produced:

```
gen_ai.invoke_agent      invoke_agent                        origin=auto.vercelai.channel
gen_ai.generate_content  generate_content simulated/no-op    origin=auto.vercelai.channel
gen_ai.execute_tool      execute_tool read_trip              origin=auto.vercelai.channel
gen_ai.execute_tool      execute_tool find_free_time         origin=auto.vercelai.channel
```

carrying `gen_ai.usage.{input,output,total}_tokens`,
`gen_ai.response.finish_reasons`, `gen_ai.response.id`, `gen_ai.response.model`
and the provider — beside a second, duplicate set of spans with
`origin=manual.ai.travel_collab`, which were ours. **Two sets of gen_ai spans
for one turn double-counts tokens in the AI Agents dashboard**, so the
hand-written emitter was not merely redundant, it was wrong.

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
instead of becoming `NaN`. Sentry samples with `Math.random() < rate`, and
`NaN` loses every comparison — a typo'd variable would turn a feature OFF while
the deployment's config reads as if someone had turned it up.

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

### 3. The AI agent spans are Sentry's. We contribute one option per call site.

No hand-written `gen_ai.*` spans. The only thing this app adds is
`telemetry: { functionId }` on each AI SDK call — `ask` on the agent,
`classify_intent` on the pre-turn classifier, `plan_<surface>` and
`compose_page` on the command endpoint. That is the one thing the integration
cannot infer: without it every run in the app is a span named the bare
`invoke_agent`, and the turn, the classifier call it is supposed to be saving
money against, and `/ai`'s planning run are indistinguishable in the AI Agents
view.

Three things this depends on that are all default-on and all fail silently, and
are therefore asserted by `telemetry.int.test.ts` against a real client:

* **`ai` >= 7.** The channel is v7-only. On v6 and below Sentry falls back to
  patching the `ai` module's `generateText`/`streamText` exports — and this
  app's agent calls `ToolLoopAgent`, not those exports, so a downgrade would
  produce nothing.
* **Sentry's OpenTelemetry setup.** The subscriber needs its async-context
  binding; `skipOpenTelemetrySetup` would remove it.
* **`VercelAI` being in the default integration set.**
  `sentry.server.config.ts` passes an `integrations` array, which *merges* with
  the defaults. A future `defaultIntegrations: false` there would delete every
  gen_ai span in the app with nothing going red.

What we give up by not hand-rolling: our own business dimensions (`scope`,
`turn`, `simulated`) on the AI spans. `Sentry.setAttributes` on the scope was
tried and does not reach these spans. Those dimensions live on the `ai.ask` log
record and on the metrics below, which is where this repo already puts them —
and they are not what the AI Agents view is for.

### 4. Metrics are ours, derived from the records that already exist, by one writer

Sentry's integration emits **no metrics at all**, so this half is not
duplicative. `apps/web/src/server/ai/aiMetrics.ts` turns each record into
counters and distributions, wired **inside the existing sinks** rather than
beside them: `createAskRecorder`'s single-writer latch already guarantees
exactly one call per turn across all three end paths (`onEnd`, abort, error),
which makes it the one correct place to also emit the metrics.

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

### 5. `dataCollection.genAI` is set explicitly in all three runtimes

`{ inputs: false, outputs: false }`. This is the one setting standing between
Sentry and every prompt this app sends, and it is not ours by default in both
directions: the **AI SDK** defaults `recordInputs`/`recordOutputs` to on, and
it is **Sentry's reader** that currently defaults them off. Relying on a
third party's default for that would be relying on a decision we did not make
about a value `askAnalytics.ts` weighed at length. Named explicitly so a flip
upstream cannot make it for us; `telemetry.int.test.ts` checks the bytes.

## Consequences

* Sentry now carries: errors, traces, browser and server CPU profiles, Session
  Replay, structured logs, agent runs in the AI Agents view, and metrics for
  token spend, tool calls, classification, failures and proposal approvals.
* **The gen_ai spans ride on `tracesSampleRate`.** Turning tracing down turns
  the AI Agents view down with it. Both are at 1.0 and both are one
  environment variable away from being turned down when traffic justifies it.
* **Almost none of the AI tracing is code we maintain.** The surface is four
  `functionId` strings. An `ai` major bump is the thing to re-check, since the
  channel is version-gated; `telemetry.int.test.ts` fails if it stops working.
* `askAnalytics.ts` is unchanged and still has no Sentry dependency, so the
  `ai.ask` log line and the `ai-usage` skill that reads it keep working with no
  Sentry client at all.
* The wizard's `sentry-example-page` and `sentry-example-api` are deliberately
  KEPT: they are how you confirm, from a deployed preview, that events reach
  the project at all. `check-color-wall.mjs` already exempts the page as
  third-party codegen.

## The process note, recorded because it is the more useful lesson

The wrong conclusion was reached by **reading one constant and stopping**.
`SUPPORTED_VERSIONS = [">=3.0.0 <7"]` is a real line in the installed SDK and
it says exactly what it appears to say; it just does not say what was inferred
from it, because it governs one of two code paths. The second path was findable
in the same `node_modules` tree — `grep -rn "ai:telemetry"` across
`@sentry/*` finds it in seconds — and it is named in Sentry's own docs.

What would have caught it earlier is the same thing that eventually did: **run
it and look at the spans before writing an emitter for spans.** A ten-line
probe against a real client with a capturing transport was the whole
investigation, and it was run only after the alternative had already been
built, tested and documented. When the question is "does this integration do X
here", the cheap answer is almost always empirical.

## What was verified

* `pnpm --filter web typecheck`, `lint`, and the full unit + integration suites.
* `telemetry.int.test.ts` drives the real handler, through the real
  `ToolLoopAgent`, against a real Sentry client with a capturing transport, and
  asserts the bytes: Sentry's own `gen_ai.invoke_agent` /
  `gen_ai.generate_content` / `gen_ai.execute_tool` spans with token usage, the
  runs named by `functionId`, **no hand-rolled gen_ai span from this app**, the
  metrics, and no question text or user id anywhere in the payload.
  Mutation-checked: removing `telemetry: { functionId: "ask" }` fails it.
* A production build (`next build`) and `next start`: the server boots with no
  "server CPU profiling is unavailable" warning — so the native profiler
  really does load in a built app — and a real response carries
  `Document-Policy: js-profiling` on both the global route and the
  `/s|invite` route, with the CSP and the per-route `Referrer-Policy`
  unchanged.

## Amendment — 2026-08-30: identity is now attached, deliberately, one field at a time

`Sentry.setUser({ id, email })` is called from the `session` callback in
`apps/web/src/lib/authConfig.ts` — the one seam every `auth()` call passes
through in both the edge and Node runtimes, so it fires wherever a session
resolves without a call at every route.

This was prompted by a concrete gap: with no password gate and open Google
sign-up, there was no way to see which accounts had actually signed up short
of querying Postgres directly, and every Error, Transaction and Session
Replay in Sentry was anonymous by construction. Mitchell asked for it
explicitly (2026-08-30), aware this reverses the "no identity in Sentry"
default `sendDefaultPii: false` establishes above.

**This does not contradict §5's cardinality rule** ("`tripId` and `userId`
are never attributes"): that rule is about metric *attributes*, which are
series and blow up in cardinality. `Sentry.setUser` attaches to the
Error/Transaction/Replay's top-level `user` field, not to a span or metric
attribute — `telemetry.int.test.ts`'s "no unbounded identifier anywhere in
the payload" assertion still passes, because that test mocks `@/server/auth`
directly and never runs the real `session` callback.

`sendDefaultPii` itself stays `false`. The distinction this ADR draws — an
auto-attached default nobody decided to send, versus a field chosen on
purpose — is unchanged; user identity has simply joined the second category.
