### KI-2026-11-01-y — the console's Personas report loads every ledger row in the window into Node

- **Severity:** reliability (grows with usage; the 90-day window is the worst case).
- **Area:** `apps/web/src/server/entitlements/personaReport.ts` (`personaReport`, the five `select` calls at lines 46-60).
- **Symptom / What happens:** `/admin?tab=personas&days=90` selects every `ai_usage`, `ai_usage_steps`, `ai_usage_tool_calls`, `ai_turn_outcomes` and `ai_capability_gaps` row in the window and aggregates in JavaScript. Fine at today's volume; slow and memory-heavy as turns accumulate. Operators only, so it is not a user-facing path.
- **Why not fixed here:** PR 674's review marked it known-not-fixed (finding 5). The fix is to aggregate in SQL (`GROUP BY persona`, `edge_kind`) and fetch only the recent-turns page.
- **Cross-reference:** PR 674, `aiModelsReport` (`server/entitlements/aiModels.ts`) which does the same on a fixed 30 days.
- **First noted:** 2026-11-01, M57 part 6 review.
