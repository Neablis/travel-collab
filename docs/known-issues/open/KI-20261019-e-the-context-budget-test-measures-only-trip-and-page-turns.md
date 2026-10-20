### KI-2026-10-19-e — The context-budget test measures only trip and page turns, so the account-wide and playbook assistants' prompts can grow unnoticed

- **Severity:** cleanup. No user impact today; a missing guard on prompt size and cost.
- **Area:** `apps/web/src/server/ai/contextBudget.test.ts` (its `SHAPES`, measured by
  `instructionsFor` for a board or a `{ kind: "page" }` context, around lines 107–122) and its
  baseline; `apps/web/src/server/ai/handleAskRequest.ts`, where `VOICE_RULE` (line 2066) is added
  to three prompts (lines 2054, 2086, 2125).
- **Symptom / What happens:** M50 decision 16 put the tone line into every assistant prompt: trip
  turns, the account-wide assistant and the playbook page. PR 494 regenerated the baseline, and
  only the trip and page shapes moved (`trip · viewer: 4150 → 4217 chars`). The account-wide and
  playbook-page instructions are not in any shape, so their growth fails nothing.
- **Why not fixed here:** found during M50's build; part 1 shipped the tone line as decided, and
  the close is prose-only.
- **Fix direction:** add a shape for the account-wide assistant and one for the playbook page to
  `SHAPES`, regenerate the baseline in the same PR, and see each new shape go red by lengthening
  its instruction.
- **Cross-reference:** M50 decisions 10 and 16 (`docs/milestones/M50-strangers-find-a-day.md`);
  PR 494.
- **First noted:** 2026-10-19, M50 part 1 (PR 494).
