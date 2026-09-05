# F-B07 — The resolver property test's params generator speaks the retired v1 vocabulary, so the `unbound` path it claims to exercise is never reached

- **Stream:** B Notebook · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `packages/pages/src/registry.property.test.ts:83-88` (comment: "including ones the trip cannot satisfy … which is the `unbound` path"), `:89-104` (`paramsArb` emits only `dayRef`/`dayId`/`dayNumber`/`null`/`undefined`); every primitive's schema is `filterParams(...).strip()` (`filters.ts:142`), so every accepted case parses to `{}`. Totality still holds; the comment has been false since 2026-09-04.
- **Suggested fix:** generate from `FILTER_VALUE_SCHEMAS` — `day` with in-range and out-of-range `index`/`dayId`, `dates` ranges, `city`, `kind`, `tag`, `person` — and assert at least one `unbound` outcome is observed per run (the `witness` floor cannot see this because the assertion count is unchanged).
- **Scope of the fix:** one test file. Check subset: `pnpm --filter @tc/pages test`.
- **Cross-reference:** CLAUDE.md rule 3 (a test is not done until seen failing) — break by making `narrow` never return `unbound` and confirm the new assertion goes red.
