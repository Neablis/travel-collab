### KI-2026-09-12-a — the simulated classifier has two verdicts where the real one has four, so `edit` and `compose` are unreachable in the integration suite

- **Severity:** cleanup (no production impact — `simulatedModel` is never the classifier when `ai-live` is on), but it bounds what the integration suite can prove
- **Area:** `apps/web/src/server/ai/simulatedModel.ts` — `classifyStep()`:
  `askIntentVerdictText(asksToWrite(latestUserText(options)) ? "plan" : "question")`
- **Symptom / What happens:** `TaskClass` has four members — `question`, `edit`, `plan`, `compose` — and the simulated classifier can only ever emit **`plan` or `question`**. Every write-shaped turn in `route.int.test.ts` is therefore a `plan` turn. Two consequences:
  - **`edit` is never exercised end to end.** `tierFor("edit")` routes to the `mid` slot and, since 2026-09-12, `edit` is the class that is offered the *full* planning tool set while `plan` is narrowed. Neither branch has integration coverage; both are covered at unit level in `grants.test.ts` and `taskClass.test.ts` only.
  - **`compose` comes from the surface, not the classifier** (`taskClassFor` returns it structurally for a page turn), so that one is genuinely reachable — it is `edit` that has no path.
- **How it was found:** adding the task-class tool filter. Four integration tests failed against the narrowed `plan` set, and the reason all four were `plan` rather than a mix was this, not the change.
- **Why it was not fixed with the change that found it:** giving the simulated model an `edit` verdict means deciding what phrasing distinguishes "change this one stop" from "fill out my days", which is a product judgement about the real classifier's prompt, not a test fixture detail. Doing it inside a tool-filter PR would bury that decision. `asksToWrite()` also deliberately excludes "plan" as a word (its own comment: *"What's the plan for day 2"* is a question), so the split is subtler than a keyword.
- **Note for whoever takes it:** the honest interim reading is that any integration assertion about "a write turn" is an assertion about a **`plan`** turn. `route.int.test.ts`'s `PLAN_TURN_TOOL_NAMES` is named for that reason rather than being called "the write tools".
- **Cross-reference:** ADR-043 decision 4 (task classes); `apps/web/src/server/assistant/taskClass.ts`; `tools/planning.ts`'s `TASK_CLASSES_FOR`; KI-88 (the classifier's fail-open path, which since 2026-09-12 also disables narrowing).
- **First noted:** 2026-09-12, adding the task-class tool filter.
