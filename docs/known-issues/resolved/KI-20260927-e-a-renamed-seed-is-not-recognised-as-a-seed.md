### KI-2026-09-27-e — a renamed seeded notebook is not recognised, so "Add missing" seeds a second copy beside it — RESOLVED
- **Severity:** correctness (small). Nothing is lost, but the trip ends up with
  two notebooks doing one job, and the renamed one offers no *Reset to default*.
- **Area:** `packages/pages/src/defaultNotebooks.ts` (`seedTemplateOf`,
  `missingDefaultTemplates`), `apps/web/src/server/pageCommands.ts`
  (`addMissingDefaultPages`), `apps/web/src/components/pages/NotebookScreen.tsx`,
  `apps/web/src/components/pages/ResetToDefault.tsx`,
  `packages/contracts/src/pages.ts` (`PageListEntry`).
- **Symptom / What happens:** rename the seeded "Money" to "Budget". The index
  now offers *Add missing default notebooks*, and it adds a new "Money" beside
  "Budget". "Budget" has no *Reset to default*. Renaming "Budget" back to
  "Money" is then refused with a 409, *A notebook called "Money" already
  exists in this trip.* (`pages_system_seed_unique`; it used to be an uncaught
  500, fixed with this entry.)
- **Why not fixed here:** a seed is identified by its CURRENT title (plus
  `system` ownership, or `kind: "overview"`), because that is all a list entry
  carries, and the index and the server must ask the same question or the
  button promises what the server refuses. The server alone could recognise a
  renamed seed by its genesis title (the first `PageCreated` in the log, or the
  row's title when there is none, since a rename always backfills the genesis
  first), but the index would still offer the button. The fix is to carry the
  template key (or the genesis title) on the page, or on `PageListEntry`, and
  have `seedTemplateOf` read it. That is a contract change to `PageContext` or
  `PageListEntry` with a CHANGELOG entry, and the reset PR did not need it for
  the ask.
- **Cross-reference:** ADR-036's 2026-09-27 amendment (states this cost);
  the header comment of `packages/pages/src/defaultNotebooks.ts`.
- **First noted:** 2026-09-27, code review of the reset / add-missing PR.
- **Resolved 2026-09-27**, on Mitchell's decision the same day (*"You should be allowed to
  rename a default notebook, or delete one."*; the Overview stays undeletable). A seed now
  carries its template's key for good: `PageCreated.seedKey` in the log, `Page.seedKey` on the
  contract, `pages.seed_key` in the projection, and `seedTemplateOf` reads nothing else.
  Migration `0032_notebook_seed_key` backfilled existing seeds (from each page's latest
  `PageCreated`, else its row) and replaced `pages_system_seed_unique` (trip, title) with
  `pages_seed_key_unique` (trip, seed_key), so titles are free and `page-title-taken` is gone.
  ADR-036's second 2026-09-27 amendment records it.
- **Proof:** `defaultNotebooks.int.test.ts` "a renamed default notebook" — rename Money to
  Budget, "Add missing" appends nothing (`seq: null`), Reset puts back "Money". Seen red
  (`pnpm redfirst`, projection's rename also clearing `seed_key`): *"expected 7 to be null"*
  — "Add missing" seeded a second Money, this entry's symptom. The same mutation turns
  `e2e/notebook-reset.spec.ts` "a renamed default notebook…" red under
  `test:e2e:ci-like` (*"waiting for getByRole('button', { name: 'Reset to default' })"*).
- **Check subset:** full `pnpm check` on the branch head: typecheck, lint, every unit suite
  green; `test:int` 1108/1109 green, the one red being the weather route's "with only the
  forecast down" case, which reads the day as past in Oslo between 22:00 and 24:00 UTC and
  touches nothing here. `pnpm --filter web test:e2e:ci-like e2e/notebook-reset.spec.ts`
  4 passed, twice; `pnpm --filter web db:check` clean.
