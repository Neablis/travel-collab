### KI-2026-11-01-z — the Personas report's node turns need not sum to the header total, and a self-loop can be credited with an earlier escalation — RESOLVED

- **Severity:** cosmetic (an operator-only debug figure; nothing is billed or decided from it).
- **Area:** `apps/web/src/server/entitlements/personaReport.ts` (the header turn count, and the self-loop count at line 126, which reads each step's `escalated` / `pivoted` flag).
- **Symptom / What happens:** two inexact figures. (1) The header counts turns including rows with no entry persona, so the per-node turns need not add up to the total (PR 674 finding 8). (2) `escalated` is set on every step after `request_change_tools` latches it, so a persona that a turn switched to after the escalation can have its own self-loop credited with the earlier escalation.
- **Why not fixed here:** both were known-not-fixed minors in PR 674's body, and the close is prose only. Fix: count a turn with no entry persona in an "unknown" row, and credit a self-loop only on the step where the flag first turns true.
- **Cross-reference:** PR 674, ADR-085.
- **First noted:** 2026-11-01, M57 part 6 review.
- **Resolution (2026-11-14):** both fixed in `personaReport.ts`, in the same rewrite as
  KI-2026-11-01-y (its SQL is where the self-loop rule now lives).
  1. `PersonaReport.unknown` (`lib/adminPersonas.ts`) holds the turns whose entry persona is null
     **or names no node on the map** (a retired persona would otherwise leak the same way). The
     Personas tab draws it as an "Unknown" row when it has turns, so the column adds up to the header.
  2. A self-loop is credited only at the step whose flag the previous step of the turn did not have
     (`lag(...) over (partition by turn_id order by step_index)`), and only when that step's persona
     is the edge's.
  - **Proof:** `personaReport.int.test.ts`, *credits a self-loop only on the step where its flag
    first turns true* (before: `"count": 2, "turns": 2` for Schedule's `request_change_tools`, the
    second from Discover's latched escalation) and *counts a turn with no entry persona, or one off
    the map, in an unknown row* (before: `expected undefined to deeply equal { turns: 2, …(2) }`).
    Seen red again with the fix removed: dropping `not was_escalated` gives `"count": 3` on the
    existing latched-escalation case; dropping the off-map half gives `"turns": 1`.
    `PersonasTab.test.tsx`, *lists turns with no persona on the map in an Unknown row*, seen red
    with the row's `turns > 0` guard removed.
