### KI-2026-10-12-h — the assistant's planning text appears, then is removed

- **Severity:** cosmetic. Nothing wrong is kept or stored. A person can see a sentence of the
  model's working notes for as long as it takes the model to start its tool call, and then
  watch it disappear.
- **Area:** `apps/web/src/server/ai/finalStepText.ts` (`retractTextBesideTools`, piped on both
  ask routes in `apps/web/src/server/ai/handleAskRequest.ts`), the client's handling of the
  `data-retract` chunk in `apps/web/src/lib/apiClient.ts` (`askAssistant`, `withoutRetracted`)
  and `apps/web/src/components/assistant/useAskThread.ts`, and the eval's count in
  `apps/web/src/server/ai/eval/grade.ts` (`retractedText`), printed by `live.eval.ts`.
- **Symptom:** the fix for KI-2026-10-12-e (PR 425). Every step's text streams as the model
  writes it. When a step that wrote text goes on to a tool call, the server sends a transient
  `data-retract` chunk naming that text's part ids, and the client removes the text. So a note
  such as "Gap 5:30–7 pm. Look up a cafe." appears in the reply and then goes. The final step
  calls no tool, so the answer itself is never removed. The thread the client stores, and posts
  back as history, never holds retracted text, except in one window: a reload between a note
  arriving and its retraction stores the note.
- **Why it is left like this (Mitchell, 2026-10-12):** chosen over holding each step's text
  until the step ends. Holding hid the note, but the final answer then arrived all at once at
  the end of its step instead of streaming. The flicker is accepted deliberately: it keeps the
  problem visible, so it gets fixed properly later rather than hidden.
- **Measure:** the live eval prints, per turn and in total, how much text was retracted
  (`retracted <parts>/<chars>ch` on each row, and a `retracted:` summary line). It is reported,
  not failed. A holistic fix should drive it to zero.
- **Fix direction (holistic, not yet chosen):**
  1. **A tools-off final step.** End every turn with one extra model call offered no tools, and
     stream only that step's text. The note is then never shown. The cost is one extra call
     per turn.
  2. **A prompt rule** ("write no text in a step where you call a tool"). Previously rejected
     as unreliable: a model can always slip, and the retraction would still be needed behind it.
- **First noted:** 2026-10-12, M45, PR 425's redesign.
