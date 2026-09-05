# Stream F — Simplifiable code

Question: **Where is code more complicated than its job, so that it is harder
to develop than it needs to be?** Mitchell: *"Anywhere code is overly
complicated, or could be simplified to make it easier to develop."*

You are looking for: abstractions with one caller; state machines with
unreachable states; hand-rolled things a dependency already does; three ways
of doing one thing; defensive code for cases the types already exclude;
indirection added for a future that ADRs say is not coming; config for
options no one sets.

Read first (largest and most-churned server/domain code):
- `apps/web/src/server/ai/**` — `handleAskRequest.ts` (1048 lines), `simulatedModel.ts` (641), `askAnalytics.ts` (540), `readTools.ts`, `writeTools.ts`, `askIntent.ts`, `batchResolver.ts`, `geocode*.ts`, `aiMetrics.ts`, `modelSelection.ts`, `context.ts`, `planningTools.ts`, `pageTools.ts` — ADR-015, 019, 022, 033 and `docs/specs/2026-08-29-one-ai-route-design.md`. Draw the request flow as a list of steps with the file for each; then ask which steps exist for a case that cannot happen.
- `apps/web/src/server/{quota,admission}.ts` (428 + 253) — KI-094/097 say admission is "tracking only"; is 680 lines of code doing nothing enforceable?
- `apps/web/src/server/{savedDays,playbooks,savedDayAdds}.ts` — three files, one feature?
- `apps/web/src/server/{commands,projections,eventStore,history}.ts` — the command pipeline; compare against the invariant's four steps.
- `packages/domain/src/**` — is anything here I/O-flavoured or duplicated with contracts?
- `apps/web/src/components/trip/{TripHeader,SettingsSheet,DayChips,Sparkline}.tsx`, `components/AccountMenu.tsx`, `components/front/*` — 300–450-line components: which are three components in one file?
- `apps/web/src/lib/playbooks.ts` (328) vs `server/playbooks.ts` (522) — what is duplicated across the wall?
- `apps/web/src/components/pages/editor/useSlashMenu.ts`, `DaysFilter.tsx`, `widgetBind.tsx` — the spec says "one control per dimension"; does the code special-case?
- `scripts/*.mjs` — eight custom wall scripts; could any be an ESLint rule instead (`no-restricted-imports`, `no-restricted-syntax`)?

For each finding give: LOC now → LOC after (estimate), what gets deleted, what
behaviour is preserved and which test proves it, and the risk. Rank by
(lines removed × frequency the area is edited — use `git log --format=%h --since=2026-08-01 -- <path> | wc -l`).

Also list **### Deliberately not findings**: complexity that is earning its
keep (say why), so nobody "simplifies" it later.
