# An assistant turn has a token budget, and reaching it ends the turn with a summary

**Status:** Design approved by Mitchell, 2026-10-06, in conversation. No plan yet. Not on a
milestone: Mitchell asked for it directly while M34 is current.

Mitchell's ask: confirm there is no token cap, add a reasonable one, and make reaching it fail
gracefully. He offered two shapes: hand off to another agent, or give the turn one more step to
summarise what it did and ask the user to continue. This spec takes the second.

Facts below were checked against `main` at `bc11ebc2`.

---

## 1. Where things stand

- **Confirmed: a turn has no token cap.** The agent loop stops on two conditions only
  (`server/ai/handleAskRequest.ts:707`): `MAX_ASK_STEPS` (8), and the wrap-up step having run.
  The turn model is called with no `maxOutputTokens`. The classifier is the only call that sets
  one (`askIntent.ts:526`).
- **What bounds input today is size, not tokens:** a prompt is at most 4,000 characters, a
  thread 40 messages, a request body 128 KiB (`server/assistant/limits.ts`). The thread is
  re-sent on every step, so a padded body is about 32k tokens times up to 8 steps.
- **Quotas count requests and steps, not tokens** (`server/quota.ts`, KI-67's reasoning). That
  stays as it is.
- **The graceful ending already exists, for time.** Past `ASK_STEP_DEADLINE_MS` (150s),
  `prepareStep` sets `wrapUpStep` and returns `{ activeTools: [], toolChoice: "none" }`: one
  last step with no tools, then `stopWhen` ends the run (KI-2026-09-26-s). The step keeps the
  admitted instruction; nothing tells the model why it is wrapping up.
- **Per-step usage is already observed.** `onStepEnd` hands each step to
  `recorder.observeStep`, and the ledger records tokens per step (`ai_usage_steps`).
- **A normal turn is far below any sensible cap.** Step 1 with every tool offered is about
  4,900 input tokens; M20 link 5 puts a full 8-step turn near 30,000 input and 2,400 output.

## 2. Decisions (approved)

1. **Add a per-turn token budget.** Cumulative input plus output across the turn's steps.
2. **Reaching it is not an error.** The turn gets one more step, with no tools, to say what it
   has done so far and ask the user to continue.
3. **The next request starts from there.** The summary is an ordinary assistant message in the
   thread, so the follow-up turn reads it like any other history. No new state.
4. **No hand-off to another agent.** It needs carried state that does not exist, and the
   summary step gives the user the same thing.

## 3. Working decisions (made while designing; Mitchell has not seen these)

1. **Budget: 60,000 tokens a turn.** About twice a full ordinary turn. A thread padded to the
   body limit crosses it after its second step.
2. **Per-step output cap: 4,000 tokens**, via `maxOutputTokens` on the turn model. The wrap-up
   step gets a smaller one, 800.
3. **Both numbers are provisional until the eval has run with them** (`pnpm --filter web eval`,
   M33). A `compose` turn writing a long page is the shape most likely to need more output. If
   it does, the output cap becomes per task class rather than one number.
4. **The budget is an abuse bound, not a sold term.** It lives as constants in
   `server/assistant/limits.ts` beside the other request ceilings, not on a plan version.
5. **The check runs in `prepareStep`, on the running total**, so it is one step late by
   construction: the step that crosses the line has already been paid for. The real ceiling is
   the budget, plus one step, plus the wrap-up step.
6. **The wrap-up step gets its own instruction when the cause is tokens:** summarise what was
   done and what remains, and ask the user to say *continue*. The deadline wrap-up keeps today's
   behaviour.
7. **A step whose provider reports no usage is estimated** from character count, with the
   `CHARS_PER_TOKEN` figure `contextBudget.test.ts` already measures, so a provider that omits
   usage cannot switch the budget off.
8. **The `ai.ask` record says why a turn wrapped up:** a `wrapUp` field of `"deadline"` or
   `"tokens"`. Without it the ai-usage skill cannot tell how often the budget fires.
9. **Tool-call steps are never cut mid-call.** The budget only decides whether another tool
   step starts. Proposals already buffered in the turn are delivered as usual.

## 4. Shape

- **`server/assistant/limits.ts`:** `MAX_TURN_TOKENS`, `MAX_STEP_OUTPUT_TOKENS`,
  `MAX_WRAP_UP_OUTPUT_TOKENS`.
- **`server/ai/handleAskRequest.ts`:**
  - `onStepEnd` adds the step's usage (or its estimate) to a running total.
  - `prepareStep` sets `wrapUpStep` when the total is at or past the budget, alongside the
    existing deadline condition, and records which cause fired. For the token cause it also
    returns the wrap-up instruction and the smaller output cap.
  - The model call sets `maxOutputTokens`.
  - `stopWhen` is unchanged; it already ends the run after `wrapUpStep`.
- **Recorder and ledger:** the `wrapUp` cause on the `ai.ask` record. Whether it also needs a
  column on `ai_usage` is a plan-time call; the log record may be enough.
- **Simulated model** (`simulatedModel.ts`): a way to report large usage, so the path is
  testable without a live model.
- **Client:** no change expected. The wrap-up is model text in the thread. To be confirmed in
  the build by walking it, since `useAskThread.ts` has special handling for a deadline stop that
  produced nothing.

## 5. What a person clicks to see it

1. Open a trip, ask the assistant something ordinary. Nothing is different.
2. With the budget lowered for the walk, ask for a multi-step change. Partway through, the
   assistant stops calling tools, says what it did and what is left, and asks to continue.
3. Reply *continue*. The next turn picks up the remaining work.
4. The `ai.ask` record for step 2's turn carries `wrapUp: "tokens"`.

## 6. Out of scope

- **Capping the trial's model tier.** The trial is `plus` with `maxTier: null`, so a plan-class
  turn reaches the strong model at roughly ten times the flash rate. That is the larger part of
  what an abusive trial can cost, and it is a plan-version decision (`plus@v2`), not this one.
- Token-denominated daily quotas. Steps stay the unit (KI-67).
- A token limit checked at admission, before step 1. The body-size ceiling already bounds it.
- Handing a turn to a second agent.
