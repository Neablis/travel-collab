### KI-2026-09-24-p — a throw while building the proposal breaks `/ask`'s stream instead of reaching `onError`

- **Severity:** correctness, narrow. No known trigger today. It needs a bug in
  `buildProposal`, and there isn't one known.
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts` (`messageMetadata` on
  `toUIMessageStreamResponse`, which calls `buildProposal` from
  `apps/web/src/server/ai/writeTools.ts` on the stream's `finish` part).
- **Symptom / what happens:** measured 2026-09-24 in `route.int.test.ts`, with
  `buildProposal` mocked to throw a `TypeError`. The throw propagates out of the
  AI SDK's `toUIMessageStream` transform (`to-ui-message-stream.ts`) and errors
  the response body: `res.text()` rejects with the `TypeError`. The stream's
  `onError` never runs. So the client gets neither `ASK_FAILED_MESSAGE` nor
  `ASK_INTERNAL_ERROR_MESSAGE`, only a broken stream, and `recorder.abandon`
  isn't called on that path. `onEnd` runs before the `finish` part, as the
  comment on `proposalBuffer` in the same file says, so the turn's `ai.ask`
  record is probably already written as finished. That part is inferred from
  the ordering. It wasn't asserted.
- **Why not fixed here:** it was found while splitting `/ask`'s failure
  sentence into provider versus our own (2026-09-24). The fix needs a product
  decision that the split didn't need. The answer text has already streamed by
  the time the proposal fails, so should the turn end with an error chunk, or
  with the answer and a "the change could not be prepared" note? It may also
  need a new `AskStreamMetadata` field.
- **What to do:** catch around `buildProposal` in `messageMetadata`, record the
  error (the recorder has already finished, so this needs a way to amend or
  re-emit the record), and send the person `ASK_INTERNAL_ERROR_MESSAGE` by
  whatever channel the product decision picks. Then add a test that arms a
  `buildProposal` throw and asserts what the client and the record see.
- **Cross-reference:** `docs/contracts/CHANGELOG.md`, 2026-09-24,
  `ASK_FAILED_MESSAGE`.
- **First noted:** 2026-09-24, PR #224 review.
