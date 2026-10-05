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
