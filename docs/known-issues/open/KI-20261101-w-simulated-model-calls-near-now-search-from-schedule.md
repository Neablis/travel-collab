### KI-2026-11-01-w — the switched-off model calls `find_places_near_now` from Schedule without switching persona first

- **Severity:** cleanup. The switched-off deployment still answers; its canned tool calls just do not follow the path a real model takes.
- **Area:** `apps/web/src/server/ai/simulatedModel.ts` (`askQuestions`, the `FIND_PLACES_NEAR_NOW_TOOL_NAME` branch near line 296).
- **Symptom / What happens:** since M57 part 4 a trip turn enters Schedule, and the near-now place search belongs to Discover. `askQuestions` already switches first for a playbook-day ask (`asksForAPlaybookDay`, line 282) but calls `find_places_near_now` for a "near here" question without a `switch_persona` call, so the simulated turn takes a path no real model can. It passes today because the call is only made when the tool is offered. Noted by the eval builder in part 4.
- **Why not fixed here:** M57's close is prose only (nothing under `apps/` or `packages/`). The fix is to emit `switch_persona` to `discover` in the same step, as the playbook-day branch does, then search in the next.
- **Cross-reference:** ADR-085, `docs/milestones/M57-assistant-personas.md`, KI-20260908-c (the same file's other simulated-model gap).
- **First noted:** 2026-11-01, M57 part 4 (eval builder's note), recorded at the close.
