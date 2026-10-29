### KI-2026-10-27-f — A local ci-like e2e build needs an 8 GB Node heap in a cloud container — RESOLVED

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
- **Reproduced (2026-10-28):** Node's default heap limit in this container is 2349 MB
  (`v8.getHeapStatistics().heap_size_limit`). `NEXT_PUBLIC_SENTRY_DSN='' pnpm build`, the
  ci-like build step, died after 111 s in `Running TypeScript ...` with
  `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
  and `Failed to type check.` The same build with `NODE_OPTIONS=--max-old-space-size=8192`
  passed in 50 s.
- **Fixed:** `test:e2e:ci-like` (`apps/web/package.json`) runs its build with
  `NODE_OPTIONS="--max-old-space-size=8192 ${NODE_OPTIONS:-}"`, so a caller's own
  `NODE_OPTIONS` still applies and its own heap flag wins. CI is untouched: no workflow runs
  ci-like (the e2e job calls `pnpm --filter web build`). Documented in
  `docs/guidelines/cloud-agent-sessions.md` (E2E section), with the same flag for a hand-run
  build or typecheck.
- **Proof:** the script's build segment, run under `sh` with `pnpm build` swapped for a heap
  probe, reports 8384 MB with `NODE_OPTIONS` unset, 12192 MB with a caller's
  `--max-old-space-size=12000`, and 8384 MB with a caller's `--enable-source-maps`. The e2e
  half was not run (this sweep runs no e2e).
