### KI-2026-10-03-c — the assistant refuses a suggester with "You have view-only access to this trip." — RESOLVED

- **Severity:** cosmetic (copy). The refusal is correct — the assistant stays
  read-only for a suggester (spec §2.2) — but the words are a viewer's, and a
  suggester can edit the board.
- **Area:** `apps/web/src/components/board/TripBoardScreen.tsx` (the ask's
  `readOnly` refusal, and `approvalBlockedReason`); `readOnly` itself is
  `boardMode !== "write"` in `TripProvider.tsx` (spec W8).
- **Symptom / What happens:** a member invited as "Can suggest" asks the
  assistant something on the board and is told "You have view-only access to
  this trip." in the rail. The same sentence would block applying a proposal.
  Nothing else on the board calls them view-only: the header badge reads
  "Suggester" and the board accepts their drags into a draft.
- **Why not fixed here:** found while building the suggester role (spec
  2026-10-03, §6) and left for a follow-up. The wording needs a decision —
  for example "Suggesting doesn't include the assistant yet." — and the two
  sites in `TripBoardScreen.tsx` should then branch on `boardMode` rather than
  `readOnly` alone, so a viewer keeps today's sentence.
- **Cross-reference:** spec `docs/specs/2026-10-03-suggester-role-design.md`
  §2.2, W8, W35; ADR-064; AGENTS.md invariant 7 (the assistant takes only
  paths the user could take — why it stays read-only here).
- **Resolution (2026-11-14):** the wording the entry proposed. `TripBoardScreen.tsx` computes
  one `readOnlyAssistantReason` from `boardMode` (about line 1230): "Suggesting doesn't include the
  assistant yet." in suggest mode, today's "You have view-only access to this trip." otherwise. Both
  the ask's refusal and `approvalBlockedReason` use it, so a viewer's sentence is unchanged. Proven
  by `TripBoardScreen.test.tsx`, *refuses the assistant ask in a suggester's words, not a viewer's*,
  seen red before the fix (`Expected: "Suggesting doesn't include the assistant yet."`, `Received:
  "You have view-only access to this trip."`) and green after; the viewer's test beside it still
  asserts the old sentence and passes. No e2e asserts either sentence.
- **First noted:** 2026-10-03, while building the suggester role; moved here
  from the spec's §6 in that branch's review.
