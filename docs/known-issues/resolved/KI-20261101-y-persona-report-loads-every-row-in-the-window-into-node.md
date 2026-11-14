### KI-2026-11-01-y — the console's Personas report loads every ledger row in the window into Node — RESOLVED

- **Severity:** reliability (grows with usage; the 90-day window is the worst case).
- **Area:** `apps/web/src/server/entitlements/personaReport.ts` (`personaReport`, the five `select` calls at lines 46-60).
- **Symptom / What happens:** `/admin?tab=personas&days=90` selects every `ai_usage`, `ai_usage_steps`, `ai_usage_tool_calls`, `ai_turn_outcomes` and `ai_capability_gaps` row in the window and aggregates in JavaScript. Fine at today's volume; slow and memory-heavy as turns accumulate. Operators only, so it is not a user-facing path.
- **Why not fixed here:** PR 674's review marked it known-not-fixed (finding 5). The fix is to aggregate in SQL (`GROUP BY persona`, `edge_kind`) and fetch only the recent-turns page.
- **Cross-reference:** PR 674, `aiModelsReport` (`server/entitlements/aiModels.ts`) which does the same on a fixed 30 days.
- **First noted:** 2026-11-01, M57 part 6 review.
- **Resolution (2026-11-14):** `personaReport` now counts in the database. Tool calls are grouped by
  step persona and tool (unused tools), switches by `from_persona`/`persona`, self-loops by persona
  and flag, gaps by `persona`/`target`, and navigation calls by persona and tool (filtered to the
  map's hand-off vias). Each group carries only the ids of the turns that took it. No call, outcome
  or gap row reaches Node; whether a turn was acted on is an `EXISTS` on the turn row, and outcome
  kinds are read for the 25-turn recent page only, one aggregated row per turn.
  - **Left as rows, on purpose:** the turn row and its steps, narrowed to the columns pricing and
    the persona path read. Cost stays Financial's rule (`microUsdForRow`, rounded per step against
    the committed `modelRates.ts`), for the reason `aiModels.ts` gives: summing tokens in SQL would
    move cost off Financial's, and pricing in SQL would be a second copy of the formula. This is the
    same step volume `costPerAccount` already reads on every console load.
  - **Proof:** `personaReport.int.test.ts`, *aggregates in the database*. It seeds 30 turns, each
    with four calls, two outcomes and a gap, and spies on the pool. Before the fix it failed with
    `expected 120 to be less than or equal to 30` (every call row shipped). An intermediate version
    that read the recent page's outcomes as rows failed with `expected 50 to be less than or equal
    to 30`. Green now, and the file's five earlier cases are unchanged and green.
