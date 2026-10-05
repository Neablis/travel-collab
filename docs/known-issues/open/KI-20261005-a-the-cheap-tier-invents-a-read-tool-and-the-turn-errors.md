### KI-2026-10-05-a — the cheap tier invents a `read` tool, and the turn ends in an error

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
