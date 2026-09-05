# F-F04 — Two single-caller pass-throughs in the AI write path, one with a dead parameter

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/ai/writeTools.ts:56-58` (`buildWriteTools()` is `return buildPlanningTools()`; `:45` already computes `WRITE_TOOL_NAMES` from `buildPlanningTools()` directly, contradicting the "named door" justification at `:50-55`); `planningTools.ts:108-114` (`flushPlanningBatch(_tripId, calls, actorId)` → `executeTripCommandBatch(calls, actorId)`, `_tripId` unused). Callers: `handleAskRequest.ts:480`, `writeTools.ts:352`.
- **Suggested fix:** `export { buildPlanningTools as buildWriteTools }` or import directly; call `executeTripCommandBatch` from `commitProposal`. Add a one-line note to ADR-033 decision 5 (`ADR-033-one-ai-route.md:86-95` names `flushPlanningBatch` as surviving — the intent was the pipeline, not the wrapper). ~20 → ~2 lines.
- **Scope of the fix:** 2 files + `writeTools.test.ts` + ADR note. Check subset: `server/ai` unit + `ask/apply/route.int.test.ts:147,179,289,351`.
