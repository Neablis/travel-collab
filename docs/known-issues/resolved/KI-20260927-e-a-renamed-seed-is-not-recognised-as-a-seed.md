### KI-2026-09-27-e — a renamed seeded notebook is not recognised, so "Add missing" seeds a second copy beside it
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
