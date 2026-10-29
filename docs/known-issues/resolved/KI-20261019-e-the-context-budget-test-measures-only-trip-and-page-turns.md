### KI-2026-10-19-e — The context-budget test measures only trip and page turns, so the account-wide and playbook assistants' prompts can grow unnoticed — RESOLVED

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
- **Resolved, 2026-10-28 (KI sweep, unit-test hygiene):** `contextBudget.test.ts` measures three
  more shapes, with the caps admission's `grantTools` resolves at the account door: `account ·
  question` (`accountInstructionBlocks`), `playbook day · question` and `playbook list · question`
  (`playbookInstructionBlocks` on `playbook-day` and `city`, which take the two branches of its
  read/write rules). `Shape.board` became `prompt: "board" | "page" | "account" | "playbook"`. The
  baseline was regenerated with `UPDATE_CONTEXT_BUDGET=1`; only the three shapes were added (5182,
  3706 and 2028 chars), no existing number moved. **Proof:** appending `, ever` to each shape's own
  instruction line in `handleAskRequest.ts` turned the test red with exactly that shape —
  `shape "account · question": 5182 → 5188 chars`, `shape "playbook day · question": 3706 → 3712
  chars`, `shape "playbook list · question": 2028 → 2034 chars` — and green again once restored.
