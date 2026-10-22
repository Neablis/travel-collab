### KI-2026-10-19-i — The landing's 900px responsive assertion was never seen red — RESOLVED

- **Severity:** cleanup (test quality). The assertion may hold vacuously; CLAUDE.md rule 3.
- **Area:** `apps/web/e2e/responsive.spec.ts`, the landing layout test PR 500 rewrote (the
  stacked feature card's width assertion at a 900px viewport).
- **Symptom / What happens:** PR 500's red-first table has no entry for it, and its body says the
  rewritten layout test "was not run red against main". The reviewer reasoned that without
  `max-w-120` a stacked card is about 844px wide, so the assertion can fail; that was reasoned,
  not run.
- **Why not fixed here:** accepted as minor by PR 500's re-review of `d29c620`. Running it red
  needs the e2e lane; the close is prose-only.
- **Fix direction:** remove `max-w-120` from the stacked card, run
  `pnpm --filter web test:e2e:ci-like e2e/responsive.spec.ts`, record the failure text, restore.
  If it stays green, the assertion protects nothing and needs a tighter bound.
- **Cross-reference:** M50 part 5 (PR 500).
- **First noted:** 2026-10-19, PR 500's re-review.
- **Resolved, 2026-10-20 (M51 part 2, PR 510):** the 900px stacked-card assertion is gone with
  the stacked cards. Its replacement, `responsive.spec.ts` *"the sea runs edge to edge at
  1440px / 3440px"*, was seen red: with the sea's root held to `mx-auto max-w-285` it failed
  `expect(received).toBeLessThanOrEqual(expected) Expected: <= 16 Received: 162` at 1440 and
  `1162` at 3440, and passed without it, in `pnpm --filter web test:e2e:ci-like
  e2e/responsive.spec.ts` (PR 510's red-first table).
