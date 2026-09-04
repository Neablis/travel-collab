---
name: ai-usage
description: Inspect the travel-collab assistant's live AI cost and quality from `ai.ask` / `ai.proposal.apply` records in Vercel runtime logs — cost per turn, tool efficiency, classifier health, failure rate. Reporting only; it does not change code. Use when asked "what is the assistant costing", "is usage getting better or worse", or before/after a change to tools, the system instruction, or the intent classifier.
---

# AI usage

`/ask` and `/ask/apply` write one structured line per turn to the runtime
log — no table, no migration, because a migration needs a dispatched
production run (`docs/guidelines/environments-and-deploys.md`) and Vercel
already captures a `console.info` line as a queryable record. This skill
reads those lines. It never changes code, a tool, or the classifier — it
tells you whether one is worth changing.

Read `apps/web/src/server/ai/askAnalytics.ts` and `askIntent.ts` before
trusting any field name below — they are the source of truth and this file
can drift from them.

## The records

`console.info("ai.ask", JSON.stringify(record))` — one per `/ask` turn:

```
event, tripId, userId, scope {kind, dayIndex?}, question (<=1000 chars),
turn: "opening" | "follow-up", simulated, model, steps,
toolCalls: [{name, input}], toolCallCount,
offeredTools[], uncalledTools[],
classification: {intent, source, context, model, verdict, failedOpen, latencyMs, usage} | null,
answered, outcome: "completed" | "error" | "abort",
cause: {name, message, statusCode} | null,   // null unless outcome is "error"
finishReason,
usage {inputTokens, outputTokens, totalTokens},
usageByStep: [{inputTokens, outputTokens, totalTokens}],
droppedCalls: [{type, code, refs, message}],  // no-op drops already filtered out
latencyMs
```

`console.error("ai.ask.failed", …)` is a smaller, duplicate line for the same
failed turn (`tripId`, `userId`, `model`, `steps`, `cause`) — written at error
level only so the standard "search error/warning/fatal" habit finds it; the
full diagnosis lives on the `ai.ask` line, not this one.

`console.info("ai.proposal.apply", record)` — one per approval, the other half
of propose → review → approve:

```
event, tripId, userId, proposalId | null, commandCount,
outcome: "applied" | "refused", code: string | null, latencyMs
```

`classification` is null for a viewer's turn (no write half to withhold) and
for a turn where `handleAskRequest` didn't call the classifier at all.
`classification.source` is `"affirmation"` when a bare "yes go ahead" matched
the agreement-word rule without a model call, `"model"` otherwise.
`classification.model` names which model produced the verdict — null for
`"affirmation"` — and matters because `AI_CLASSIFIER_MODEL` can point the
classifier at a different, cheaper model than `AskAnalyticsRecord.model`
answers with. `classification.verdict` is the raw structured-output JSON
string the model returned (e.g. `{"result":"question"}`), not a bare word —
the classifier moved off free-text parsing in PR #88 (KI-88) — so grepping
for a bare `question` or `write` will not match it.

## Fetching

**Primary: the Vercel MCP `get_runtime_logs` tool**, in an interactive
session — project `prj_UoxcnmAsWMtHXx8jLXyespRqSULM`, team
`neablis-projects`, `environment: "preview"` or `"production"`,
`query: "ai.ask"`, a relative `since` like `"2h"`. **Set `limit`.** A record
carries a full tool-call trace, per-step usage, and up to 1000 chars of
question text — a wide window with no cap will fill context with one
afternoon's turns. Start around 20-50 records and widen only if the question
needs more.

**Fallback: the `vercel` CLI**, verified working from a plain shell with no
`.vercel` project link needed if you pass `--project` explicitly:

```
vercel logs --project prj_UoxcnmAsWMtHXx8jLXyespRqSULM \
  --environment preview --since 2h -n 50 -q "ai.ask" -j
```

`-j`/`--json` gives JSON Lines with the log line's `message` field holding
`"ai.ask " + JSON.stringify(record)` — split on the first space and
`JSON.parse` the rest. `-n`/`--limit` is the same context-budget knob as
the MCP tool's `limit`; it defaults to 100 if you omit it. Swap
`--environment production` for the live site.

## Cost per turn

Look at `usageByStep[0]`, not `usage.totalTokens` — it is the fixed cost paid
before the model has read anything: system instruction plus every offered
tool's schema. That's the number that grows every time a tool is added and
the one worth watching for regression. `usage.totalTokens` mixes that fixed
floor with tool-result growth (each step re-sends the whole envelope plus
what earlier tool calls returned), so a rising total doesn't tell you which
half moved.

**Baselines, measured 2026-08-29 against the real `/ask` endpoint**
(`askIntent.ts`'s own header comment) — a snapshot, not a contract; re-measure
rather than trusting these blind:

- system instruction: ~570 tokens
- a full (read + write, all 15 tools offered) step-1: ~4,900 input tokens
- of that, tool schemas: ~4,200 tokens (~85%)
- the write half alone (12 of the 15 tools): ~3,400 tokens

**Measured again 2026-08-30 on the preview deployment**, once the classifier
(above) was actually working — kept alongside the 2026-08-29 numbers rather
than replacing them, because the point is seeing the movement, not a single
snapshot. Two comparable opening turns, both 2 steps, both a single
`read_trip` call:

- before the classifier worked (`failedOpen: true`, full tool set handed
  over): 15 tools offered, `usageByStep[0]` = 4,911, total input 10,521
- after (classifier narrowed to read-only): 3 tools offered, `usageByStep[0]`
  = **1,332**, total input **3,363**
- so: step-1 floor −73%, total input −68%
- the classifier call itself: 198 input / 49 output / 247 total tokens,
  1,561 ms

If a classified question turn's `usageByStep[0]` is still near the full-set
number, **check `classification.failedOpen` first** — a throw, timeout, or
unrecognized verdict falls back to the full tool set by design, and that is
the failure actually observed live (KI-88). Only after ruling that out does
it become `classification` being null (classifier didn't run) or
`classification.intent` coming back `"write"` on a question.

## Tool efficiency

`uncalledTools` is measured, not inferred (`askAnalytics.ts`'s own header
comment): the offered set is what was handed to the agent, the called set is
what `onStepEnd` observed, and the difference is arithmetic. A tool absent
from every `toolCalls[]` across a real window is the evidence ADR-022 §1 asks
for — "a new tool is earned by a new computation or a new capability
boundary" — for reconsidering whether it earns its keep.

**The counter-argument the data can't rule out on its own:** a tool may be
uncalled because nobody's questions needed it yet, not because it's badly
designed. Judge across a window of turns and varied question shapes, not one
record — one unlucky sample of "how's the trip looking?" turns will make
every write tool look dead.

## Classifier health

For each turn with `classification` non-null, tally:

- how often `classification.intent` is `"question"` (the narrowing that
  saves ~3,400 tokens) vs `"write"`
- how often `classification.failedOpen` is true (a throw, timeout, or
  unrecognized verdict — falls back to the full tool set by design, but a
  rising rate means the classifier call itself is unhealthy)
- whether `classification.source` is `"affirmation"` (free — no model call)
  or `"model"`

Because the record carries both `question` and `classification.context`
(the classifier's exact input), you can also spot-check: does any turn
classified `"question"` read, on the actual `question` text, like it should
have been `"write"`? That's a real misclassification, not a design question —
rule 1 in `askIntent.ts` is "bias to write on any uncertainty" specifically
because a wrongly-denied write breaks the turn outright, so a genuine
question-that-should-write miss is worth flagging immediately rather than
waiting for a trend.

## Failure rate

Count from `outcome`, never from `finishReason`. `finishReason` carries the
model's own vocabulary ("stop", "tool-calls", "length") on a completed turn
and this codebase's own word on an abandoned one — conflating the two means
guessing which values are whose. `outcome: "abort"` is a user navigating
away mid-turn, not a defect; only `outcome: "error"` is a failure, and its
`cause: {name, message, statusCode}` tells a 429 (rate limit) from a 5xx
(provider outage) without parsing prose.

## Dropped calls

`droppedCalls` non-empty means the model emitted a write the resolver
couldn't match to a real ref — a `RemoveActivity` naming an activity that
doesn't exist, for instance. (A command the domain correctly no-ops is
filtered out before this array; what's left is a real drop.) Empty across a
window is healthy; a `type`/`code` that repeats is a naming or prompting
problem worth a closer look, not this skill's job to fix.

## The one mistake that will wreck every average

**Exclude `simulated: true` records from any cost figure.** A simulated turn
costs zero tokens by construction (`simulatedModel`, no provider contacted),
and flag-off is the default in every Vercel environment — preview included.
Averaging cost across a mixed batch silently drags every number toward zero
and makes a real regression invisible. Filter on `simulated === false` before
computing anything about tokens or latency; `simulated: true` records are
still useful for tool-call-shape questions, just not for cost.

## Known noise, not a product defect

**KI-83 (resolved 2026-09-04)** — repeated local `test:e2e:ci-like` runs
against the same seeded user used to exhaust the per-user AI quota
(`aiQuotas()` in `quota.ts`) and produce a run of `outcome: "error"`,
`cause.statusCode: 429` records. The e2e lane now gets a private database per
run, so `rate_limit_counters` starts empty and the counters no longer carry
across runs. The reading advice outlives the cause: a 429 cluster that lines
up with a local test loop rather than with real traffic is still the quota
working as designed against one shared test account, not a live failure rate.

## Always sample a window

One record proves nothing about a trend — it's one question shape, one
model, one moment. Every section above assumes a batch of turns from a
comparable time range (before/after a change, or a rolling recent window),
not a single line pulled to answer "is it broken right now".
