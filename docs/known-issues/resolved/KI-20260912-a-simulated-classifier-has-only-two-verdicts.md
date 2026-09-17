### KI-2026-09-12-a — the simulated classifier has two verdicts where the real one has four, so `edit` and `compose` are unreachable in the integration suite — RESOLVED

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

- **RESOLVED 2026-09-16 (M9), as the side effect this entry predicted it would be.**

  This entry says the fix needs *"deciding what phrasing distinguishes 'change
  this one stop' from 'fill out my days' — a product judgement about the real
  classifier's prompt, not a test fixture detail"*, and that burying that
  decision inside a tool-filter PR was the wrong place for it. M9's design §1
  makes exactly that judgement, so the cost here was a regex and its tests.

  **The judgement, and it is not new** — it is the live classifier's own
  instruction, which has said the same thing since P5: `plan` is *"a whole
  itinerary or several days"*. So `simulatedTaskClass` reads the OBJECT rather
  than the verb. "add a coffee stop to day 2" is an `edit`; "plan me a six day
  trip", "Create a 7 day itinerary for Rochester NY" and "how should I start
  planning this trip?" are a `plan`; everything `asksToWrite` rejects stays a
  `question`.

  **It also closed a second defect this entry did not name, and that one was
  live.** `CHANGE_VERBS` deliberately excludes the word "plan" — soundly, since
  *"What's the plan for day 2"* is a question — so on every Vercel environment,
  where `ai-live` is off and this IS the classifier, **"plan me a six day trip"
  classified as a question and was handed no write tools at all.** That is M9's
  headline flow and KI-12's gate box, dark on the only path anyone can click.
  The fix is narrower than dropping the exclusion: a lookbehind, because `plan`
  after an article or a possessive is a NOUN and the noun is what the question
  uses. Both phrasings are asserted.

  **`compose` was never the gap** and still is not: it comes from the surface,
  structurally, and was always reachable. This entry says so itself.

  **What moved in the suite, which is this entry's own "note for whoever takes
  it".** `route.int.test.ts`'s write-turn assertions were assertions about a
  `plan` turn; "add a coffee stop to day 1" is now an `edit`, so it holds the
  UNNARROWED planning set and the narrowing test needed a turn that genuinely
  classifies `plan`. `PLAN_TURN_TOOL_NAMES` keeps its name and now measures what
  it is named for.
- **Cross-reference:** M9 design §1a; KI-12 (resolved in the same milestone — the gate box this was keeping dark on the deployed path).
