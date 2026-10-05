### KI-2026-09-16-a — a tool call whose arguments were cut off ends the whole turn, losing the reads it had already paid for — RESOLVED

- **Severity:** reliability (a recoverable model failure is turned into a dead turn; the user gets an error where they could have got most of an answer)
- **Milestone:** **M9, carried (assigned 2026-09-24, KI pass)** — owned by M9, not a gate box. Parked under Mitchell's 2026-09-01 rule that every open AI known issue belongs to M9; filed after that audit, so it had no owner until now. Listed in `docs/milestones/M9-ai-planning-partner.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/server/assistant/repairToolInput.ts`, `apps/web/src/server/ai/handleAskRequest.ts` (the agent's `repairToolCall`)
- **Symptom:** a provider step that ends on `length` mid-object emits a tool call whose `input` is not valid JSON — `{"title": "Coffee", "dayRef": "day 1",`. `repairToolCall` tries `JSON.parse`, fails, and returns `null`; the SDK raises `AI_InvalidToolInputError` and `ToolLoopAgent` aborts the run. The turn ends with `outcome: "error"`, `answered: false`, and **no proposal at all** — including for the steps that had already completed. The two live turns of 2026-09-12 died this way and are what `repairToolInput` was written for; it repairs a well-formed object with the WRONG FIELDS, and truncated bytes are not an object.
- **Found by:** M9's replay harness, on its first run — `src/server/ai/eval/transcripts/mangled-tool-input.json`. This is precisely the class KI-11 says a mock cannot reach: *"`MockLanguageModelV4` … by construction emits well-formed tool calls"*, so no amount of mocked tests produces this input. The transcript now records the real behaviour, so a fix will show up here as a changed expectation rather than as a silent improvement.
- **Why the current behaviour is defensible, and why it is still wrong:** `handleAskRequest`'s own comment argues that *"a call the model meant that the tool does not offer should end the turn rather than be made to look valid"*, and for an unoffered tool that is right — inventing a call would be worse than failing. Truncation is a different case: the model meant a call the tool DOES offer, and the bytes were cut. Ending the run throws away every read the turn already did, and those reads were charged to the actor's quota.
- **Fix path, if taken:** drop the malformed CALL rather than the run. The SDK has no "skip this tool call" answer from `repairToolCall` — `null` is the abort — so the shape is probably to return a repaired call that resolves to a tool result saying the arguments were unreadable, letting the model try again inside its remaining step budget. That is a behaviour change on a path with no live coverage, which is why it is filed rather than done inside the harness's own change.
- **Not the same as KI-88**, which is the CLASSIFIER failing open on an unparseable verdict. That one has a safe default (the full tool set); this one has no default at all.
- **Cross-reference:** KI-11 (resolved 2026-09-16 — the harness that found this), `repairToolInput.ts`'s own header, M9's exit gate.
- **First noted:** 2026-09-16, building M9's replay harness.
- **Re-verified 2026-09-25 (overnight sweep):** STILL TRUE. `repairToolCall` (`handleAskRequest.ts:483-492`) still returns `null` when `JSON.parse(toolCall.input)` throws (:486-489), which aborts the run; the replay transcript `server/ai/eval/transcripts/mangled-tool-input.json` still records `"outcome": "error"`, `"answered": false`.
- **Resolved 2026-10-05, and the diagnosis above was wrong about where the turn died.** AI SDK 7
  does not abort on an unrepairable call: `parseToolCall` marks it `invalid`, the stream emits a
  `tool-error` the model reads, and the run continues. What ended the turn was our own `onError`
  in `handleAskRequest.ts`: the UI stream calls it to WORD every tool error (`tool-input-error`,
  `tool-output-error`), and it treated every call as the turn failing (record latched `error`,
  steps dropped, hard deadline cleared). The fix records a failure only on the stream's `error`
  part, in `messageMetadata`; `onError` now only words errors. `repairToolCall` is unchanged:
  returning null is the right answer, and the model gets the error.
- **Proof:** `mangled-tool-input.json` now expects `outcome: completed`, 3 steps, answered, no
  proposal (the one write never ran). With the old `onError` restored it fails (`expected
  'error' to be 'completed'`, `expected false to be true`); with the fix it passes. A new
  transcript, `provider-error-mid-turn.json`, keeps a genuine failure in the set and fails if the
  `error`-part bookkeeping is removed (`expected 'completed' to be 'error'`). Same root cause as
  `KI-2026-10-05-a`. Check subset: `replay.int.test.ts` 57/57, the ask route and `src/server/ai`
  integration 193/193, `src/server/ai` and `src/server/assistant` unit 732/732.
