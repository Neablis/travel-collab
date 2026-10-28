### KI-2026-10-27-f — A local ci-like e2e build needs an 8 GB Node heap in a cloud container

- **Severity:** tooling, low. CI is unaffected.
- **Area:** `pnpm --filter web test:e2e:ci-like <spec>` (the production `next build` it runs first),
  in a Claude Code cloud container.
- **Symptom / What happens:** the build runs out of heap at the default limit. M55 part 2's builder
  needed `NODE_OPTIONS=--max-old-space-size=8192` to finish it; `tsc` alone needs 4096, as CI sets.
- **Why not fixed here:** not caused by M55's diff, and CI's e2e passed on the same head.
- **Fix path / Tripwire:** set the heap in the ci-like script, or document it in
  `docs/guidelines/cloud-agent-sessions.md`. If a ci-like run dies with "JavaScript heap out of
  memory", set `NODE_OPTIONS=--max-old-space-size=8192` and re-run before suspecting the change.
- **Cross-reference:** KI-27 (ci-like is the only local e2e verdict); M55 part 2, PR 615.
- **First noted:** 2026-10-27, M55 part 2 build.
