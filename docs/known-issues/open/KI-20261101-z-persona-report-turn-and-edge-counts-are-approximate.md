### KI-2026-11-01-z — the Personas report's node turns need not sum to the header total, and a self-loop can be credited with an earlier escalation

- **Severity:** cosmetic (an operator-only debug figure; nothing is billed or decided from it).
- **Area:** `apps/web/src/server/entitlements/personaReport.ts` (the header turn count, and the self-loop count at line 126, which reads each step's `escalated` / `pivoted` flag).
- **Symptom / What happens:** two inexact figures. (1) The header counts turns including rows with no entry persona, so the per-node turns need not add up to the total (PR 674 finding 8). (2) `escalated` is set on every step after `request_change_tools` latches it, so a persona that a turn switched to after the escalation can have its own self-loop credited with the earlier escalation.
- **Why not fixed here:** both were known-not-fixed minors in PR 674's body, and the close is prose only. Fix: count a turn with no entry persona in an "unknown" row, and credit a self-loop only on the step where the flag first turns true.
- **Cross-reference:** PR 674, ADR-085.
- **First noted:** 2026-11-01, M57 part 6 review.
