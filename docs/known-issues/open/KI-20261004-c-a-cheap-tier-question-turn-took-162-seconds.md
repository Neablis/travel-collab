### KI-2026-10-04-c — a cheap-tier question turn took 162 seconds, and the ledger cannot yet say which step

- **Severity:** major (a person waits nearly three minutes for a one-sentence answer).
- **Milestone:** M32, which adds the measurement; the fix is not in M32's scope.
- **Area:** the cheap tier's model (`zai/glm-4.7-flashx` on 2026-10-04), `prepareStep` in
  `apps/web/src/server/ai/handleAskRequest.ts`, and the turn deadline `ASK_HARD_DEADLINE_MS`.
- **Symptom / What happens:** production turn `24691afd-6224-470e-a97a-b6c8b517ef14`, trip
  scope, *"Which day has the most free time?"*: `latency_ms` 162,307, outcome `completed`, three
  steps, 8,386 tokens in and 825 out. Its ten tool calls took about 15 ms in total
  (`find_free_time` 1 ms each), and the classifier 660 ms. So roughly 161 seconds went to the
  model's three round-trips, of which nothing records the split: every `ai_usage_steps` row
  carried the turn's write time and no duration. The next turn, five minutes later, on
  `zai/glm-5.3-flash` (mid tier), took 13.8 seconds for five steps and 39,143 tokens in.
- **Not the cause, checked:** tools (the ledger's `duration_ms`), the classifier
  (`classification.latencyMs` 660), and turn size (the mid-tier turn read 4.7x the tokens in
  under a tenth of the time). Ten tool calls in one step do inflate step 2's input, which M32's
  one-call ranking removes for this question, but 2,516 tokens in does not explain minutes.
- **Next step:** after migration `0037` is dispatched, run query 8 of
  `.claude/skills/ai-usage/ledger.sql` over a few days of turns. A cheap-tier p95 in the tens of
  seconds says the model or its provider route is the problem, and the decision is then which
  model the cheap tier admits. One step in the minutes, with the rest fast, says a provider
  stall, and the question becomes a per-step timeout and a retry.
- **First noted:** 2026-10-04, by Mitchell, reading his own turn.
- **Measured per step, 2026-10-05 (M33 eval, step durations from M32's recorder):** the cheap
  model stalls inside single round-trips. *"How long is this trip?"*, same prompt, same seeded
  trip, three runs: steps `1.5s + 134.5s` (one `read_trip`, 107 output tokens), `1.7s + 2.4s`,
  and `11.7s + 37.9s + 15.8s + 2.2s`. The mid tier (`zai/glm-5.3-flash`) on `q-most-free`, three
  runs: every step 0.6-1.9s. Tool time is milliseconds throughout, so it is the model call: the
  same prompt is 2.4s one time and 134.5s the next. This is the provider route or the model, not
  turn size and not our code.
- **A candidate, measured 2026-10-05:** the same four cheap-tier questions ×3 with the cheap tier
  on `zai/glm-5.3-flash` (`EVAL_MODEL_CHEAP`): 12 of 12 passed, every turn 1.9-4.1s, every step
  under 2.2s. That is the fix this entry was waiting to name: switch `AI_MODEL_CHEAP`.
- **The strong tier too, one run:** `t-reads-and-says-nothing` on `zai/glm-5.3` (plan a six-day
  trip): steps 2.0s + 104.7s, then the 240s deadline stopped step 3 with no proposal. A plan
  writes far more than a question, so one run does not separate slow output from a stall; it
  needs repeats before it is a finding of its own.
- **Neither `zai/glm-4.7-flashx` nor `zai/glm-5.3` had an entry in `modelRates.ts`**, so every
  cheap-tier and strong-tier turn was counted as unpriced. Fixed on #327 (2026-10-05) from the live
  Gateway catalogue, dated from each model's first production turn, with `modelRates.test.ts`
  holding every model in `models.json` to a rate.
- **Switched, 2026-10-05:** Mitchell set `AI_MODEL_CHEAP=zai/glm-5.3-flash` in production, and
  `models.json` follows. The eval's cap test the same day ran `q-most-free` on it in 3.0s
  (steps 0.7s + 1.5s). **Still open** until production shows it: after `0037` is dispatched,
  query 8 over a few days of cheap-tier turns with no step in the tens of seconds resolves the
  cheap half. The strong tier's one slow run above stays a question until it is repeated.
