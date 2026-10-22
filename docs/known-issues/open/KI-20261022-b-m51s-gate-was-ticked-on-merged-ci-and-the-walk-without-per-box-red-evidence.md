### KI-2026-10-22-b — M51's gate was ticked on merged CI and Mitchell's walk, without per-box red evidence

- **Severity:** cleanup. Nothing is known to be broken. The gate's "seen red" claims were not
  re-proved box by box at the close.
- **Area:**
  - `docs/milestones/M51-the-front-door-tells-the-story.md`, *Exit gate*: the boxes ticked on
    2026-10-22.
  - `apps/web/e2e/m42-demo-trips.spec.ts:228`: *every story cell holds what it shows*. Its
    overflow sweep was replaced by a screenshot on 2026-10-22, after PR 518 had marked the 1440
    variant `test.fixme` (commit `9cea674`).
  - The test-pruning PRs that merged after the parts (PRs 520 to 526) removed or merged tests,
    which may include tests the gate cites.
- **Symptom / What happens:** each part PR carried its own red-first record, but the close did
  not re-check that every test a box names still exists after the pruning pass, or still fails
  for its reason. A box can now read "seen red" while the test behind it is gone or changed.
- **Why not fixed here:** Mitchell, 2026-10-22: tick the gate, file this, and close. Testing is
  taking too long, and the walk covered the behaviour.
- **Fix direction:** for each M51 gate box that says "seen red", confirm the test it relies on
  survived the pruning PRs, and that the screenshot replacement still fails when a story cell
  clips. Re-file whatever has no test left as its own entry.
- **Cross-reference:** M51's retro; CLAUDE.md rule 3; `docs/guidelines/testing.md`.
- **First noted:** 2026-10-22, M51's gate close.
