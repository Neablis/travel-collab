### KI-2026-10-05-a — the cheap tier invents a `read` tool, and the turn ends in an error — RESOLVED

- **Severity:** major (a plain question fails most of the time on the tier that answers questions).
- **Milestone:** found by M33's eval on its first full run; the fix is not in M33's scope.
- **Area:** `repairToolCall` in `apps/web/src/server/ai/handleAskRequest.ts` (a `NoSuchToolError`
  returns null, which ends the turn, by design: *"a call the model meant that the tool does not
  offer should end the turn rather than be made to look valid"*); the cheap tier's model,
  `zai/glm-4.7-flashx` (production, `models.json`).
- **Symptom / What happens:** *"how long is this trip?"* on the seeded Japan trip, trip scope.
  The model calls `read` (no such tool), sometimes twice, then `read_trip`, and the turn ends
  `outcome: error`, `AI_NoSuchToolError: Model tried to call unavailable tool 'read'`, with no
  step recorded and no token count. In one run the answer text streamed before the error, so
  the reader may see an answer and then a failure. Step 1 of a question turn offers `read_trip`,
  `read_day`, `find_free_time`, `search_playbooks`, `search_places`, `request_change_tools`.
- **Measured, 2026-10-05:** 4 of 5 runs failed (`EVAL_ONLY=q-length EVAL_REPEAT=5 pnpm --filter
  web eval`). The same prompt on the mid tier did not. It was not seen on the other cheap-tier
  questions in the same runs (`q-first-stop`, `q-free-evening`, `q-most-free`), so it is a
  property of this model on some prompts, not of every cheap turn.
- **Reproduce:** `EVAL_ONLY=q-length EVAL_REPEAT=5 pnpm --filter web eval` (needs
  `TRAVEL_COLLAB_EVAL_KEY`).
- **Options, not decided** (a behaviour change, Mitchell's call):
  1. Return an invented tool name to the model as a tool error naming the real tools, and let
     the step continue, instead of ending the turn. This reverses the comment's rule for names
     that are not tools at all, and keeps it for a real tool the grant refused.
  2. Change the cheap tier's model. `EVAL_MODEL_CHEAP=<candidate> pnpm --filter web eval`
     measures a candidate on the whole live set before anything is switched.
  3. Both.
- **First noted:** 2026-10-05, M33's first full eval run.
- **Resolved 2026-10-05, and the diagnosis above was wrong about what failed.** The invented call
  was never fatal: AI SDK 7 turns it into a tool error the model reads, and the model answered
  correctly every time (the client shows only stream `error` frames, so the reader saw the
  answer). What failed the turn was our `onError`, which the UI stream calls to WORD every tool
  error: it latched the record as `error` (dropping its steps) and cleared the hard deadline.
  The failure is now recorded only on the stream's `error` part (`messageMetadata` in
  `handleAskRequest.ts`); `onError` only words errors. Option 1 above was therefore unnecessary.
- **Proof:** `transcripts/invented-tool-name.json` (the eval's `read, read_trip` turn) completes
  with both steps counted; with the old `onError` it fails (`expected 'error' to be
  'completed'`). `provider-error-mid-turn.json` keeps a genuine failure recorded. On the real
  cheap model, `EVAL_ONLY=q-length EVAL_REPEAT=3` after the fix: 3 of 3 completed with a correct
  answer, including a run that invented `read` twice. Two of the three were over the 60s
  budget; that is `KI-2026-10-04-c`, now measured per step (one step took 134.5s). Same root
  cause as `KI-2026-09-16-a`, resolved by the same change.
