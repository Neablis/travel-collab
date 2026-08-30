# Observability and telemetry

What this app reports, where to look at it, and how to turn any of it down.
The decisions and their reasoning are in
[ADR-032](../architecture/ADR-032-sentry-telemetry.md); this file is the
operating manual.

## The three places a number lives

| Question | Where | Why there |
|---|---|---|
| "What happened in *this* turn?" | Vercel runtime logs — the `ai.ask` / `ai.proposal.apply` JSON lines | One self-contained record: the question, the tool trace, the classifier's verdict, the failure cause. Read a week of them with the `ai-usage` skill. |
| "Where did the four seconds go?" | Sentry → **AI Agents** (and Traces) | The `gen_ai.*` spans: the run, each model round-trip, each tool execution, with per-step token usage. |
| "Is it getting more expensive / worse?" | Sentry → **Metrics** | Counters and distributions that aggregate over thousands of turns. |

They come from **one writer each**, not from three separate instrumentations —
the metrics and the span are emitted from the same sink that writes the log
line. A number cannot disagree with itself here; if two of them disagree, that
is a bug, not a sampling artefact.

## What Sentry collects

- **Errors**, client and server, plus `global-error.tsx` and
  `onRequestError`.
- **Traces** at `tracesSampleRate` (default 1).
- **CPU profiles**, browser (JS Self-Profiling) and server
  (`@sentry/profiling-node`), only while a sampled root span is open.
- **Session Replay**: 10% of sessions, 100% of sessions that hit an error.
- **Logs** — `Sentry.logger.*`. Note the app's own analytics lines are
  `console.info` and go to Vercel, not here.
- **AI agent runs** — see the metric and span reference below.
- **Metrics** — same.

**What it deliberately does not collect:** prompts, model answers, tool inputs
and outputs, `tripId`, `userId`, or any user text. `sendDefaultPii` is off and
`dataCollection.genAI` is `{ inputs: false, outputs: false }` in all three
runtimes — set explicitly because the AI SDK defaults input/output recording
*on* and it is Sentry's reader that currently defaults it off, which is a
decision we would rather not inherit. `telemetry.int.test.ts` checks the actual
payload for the question text and the user id.

## The spans — Sentry's, not ours

**This app writes no `gen_ai.*` spans.** Sentry's `VercelAI` integration (a
default integration, on already) subscribes to the AI SDK's own `ai:telemetry`
diagnostics channel and emits them, with `origin=auto.vercelai.channel`:

| Op | When | Carries |
|---|---|---|
| `gen_ai.invoke_agent` | One top-level AI SDK call — the `/ask` turn, the classifier call, an `/ai` generation | model, provider, whole-run token usage, response id, streaming flag |
| `gen_ai.generate_content` | One provider round-trip inside that run | that call's tokens, finish reasons, response model |
| `gen_ai.execute_tool` | One tool execution | tool name, tool call id |

The single thing this app contributes is `telemetry: { functionId }` on each
call, which names the run: `ask`, `classify_intent`, `plan_<surface>`,
`compose_page`. Without it every run in the app is a span called `invoke_agent`
and none of them can be told apart — which matters most for the classifier,
since `AI_CLASSIFIER_MODEL` can put it on a cheaper model and "did it save more
than it cost" is the comparison that whole feature exists to enable.

**If you are tempted to hand-write a gen_ai span, don't** — you will get two
sets per turn and double the tokens in the AI Agents view. That happened once;
ADR-032 records it.

## The metrics

| Name | Type | Notable attributes |
|---|---|---|
| `gen_ai.usage.input_tokens` / `.output_tokens` / `.total_tokens` | counter (by token count) | `agent` (`ask`/`command`), `call` (`turn`/`classifier`), `model`, `provider`, `simulated` |
| `gen_ai.tool.calls` | counter | `tool` |
| `ai.tool.offered` / `ai.tool.uncalled` | counter | `tool` |
| `ai.ask.turns` | counter | `outcome`, `answered`, `finish_reason`, `scope`, `turn` |
| `ai.ask.tokens` / `.duration` / `.steps` / `.tool_calls` | distribution | as above |
| `ai.ask.failures` | counter | `error` (the error's name), `status` (HTTP status, `0` if not an API call) |
| `ai.ask.dropped_calls` | counter | `type` (command), `code` (domain rejection) |
| `ai.classify.turns` / `.duration` | counter / distribution | `intent`, `source`, `failed_open` |
| `ai.command.turns` / `.duration` / `.steps` / `.tool_calls` | counter / distribution | `surface`, `truncated` |
| `ai.proposal.apply` / `.commands` / `.duration` | counter / distribution | `outcome`, `code` |

Three things worth knowing before you chart any of them:

1. **Token metrics are counters incremented by the token count**, so they sum
   to real spend. The distributions (`ai.ask.tokens`) answer the different
   question of what a typical turn looks like.
2. **`/ask` and `/ai` share the token metric names**, separated by `agent`.
   They reach the same gateway on the same key; a total that filtered to one
   of them would be wrong by whatever the other spends.
3. **Filter `simulated:false` for anything cost-shaped.** Every Vercel
   environment runs with the `ai-live` flag off by default (ADR-019), and
   those turns contact no provider and cost nothing.

## Turning things down

Every knob is an environment variable, documented in `.env.example`. Nothing
here needs a code change:

- `NEXT_PUBLIC_SENTRY_DSN=""` — Sentry off entirely. Usually what you want
  locally, so a dev session does not file its own noise against the shared
  project.
- `SENTRY_TRACES_SAMPLE_RATE` — **this also turns the AI Agents view down**,
  because the `gen_ai` spans ride on the same sampling decision.
- `SENTRY_PROFILE_SESSION_SAMPLE_RATE` — CPU profiles, browser and server.
- `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`,
  `NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` — Session Replay.

A value that is not a number in `[0, 1]` is ignored in favour of the default,
on purpose: `Math.random() < NaN` is always false, so a typo would otherwise
turn a feature off while looking like it had been turned up.

`SENTRY_AUTH_TOKEN` is the one secret here — build-time source-map upload only,
read by `withSentryConfig`, never by app code.

## Three traps, all already paid for

**Browser profiling is two files that have to agree.**
`instrumentation-client.ts` adds `browserProfilingIntegration()`, and
`next.config.ts` serves `Document-Policy: js-profiling`. Without the header the
integration initialises, fails to construct a profiler, and turns itself off
for the session with nothing in the console outside a debug build. Deleting
either half leaves a config that looks complete and collects nothing.
`next.config.test.ts` is the tripwire.

**The AI tracing rests on three default-on switches, and all three fail
silently.** The `ai:telemetry` channel is `ai` >= 7 only (on v6 and below
Sentry patches `generateText`/`streamText` instead — which this app's agent
does not call, so a downgrade produces nothing); the subscriber needs Sentry's
OpenTelemetry setup, so `skipOpenTelemetrySetup` would kill it; and `VercelAI`
is a *default* integration, so `defaultIntegrations: false` in
`sentry.server.config.ts` would delete it. Each leaves the app running, the
tests green and the dashboard empty. `telemetry.int.test.ts` runs a real turn
against a real Sentry client and reads the spans that actually left, which is
the only check that sees any of this.

**Sentry v10 streams child spans.** They leave as standalone `span` envelope
items, *not* embedded in a transaction's `spans` array. If you go looking at
raw envelopes and find `spans: []` under a transaction, that is normal — the
children are already gone in their own envelope, correctly parented.
`telemetry.int.test.ts` reads both item types, and says so.

## Verifying it end to end

- `pnpm --filter web test` covers the metric names, the sample-rate parsing and
  the `Document-Policy` header. `pnpm --filter web test:int` runs
  `telemetry.int.test.ts`, which boots a real Sentry client behind a capturing
  transport, drives a real turn through the real agent, and asserts the spans
  and metrics that actually left the SDK — the only check that would notice the
  whole thing being wired to nothing.
- From a **deployed preview**, `/sentry-example-page` is the wizard's own
  round-trip check that events actually reach the project. It is kept for that
  reason; `check-color-wall.mjs` exempts it as third-party codegen.
- A turn only produces AI spans and non-zero token metrics when the `ai-live`
  flag is on for that session — see
  [environments-and-deploys.md](environments-and-deploys.md) for flipping it
  on a preview through the Flags Explorer.
