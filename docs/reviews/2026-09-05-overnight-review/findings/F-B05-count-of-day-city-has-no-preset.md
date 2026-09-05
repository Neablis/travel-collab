# F-B05 — `count{of: "day" | "city"}` has no preset, so a person cannot reach it from the picker; only the AI can

- **Stream:** B Notebook · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `packages/pages/src/macros/primitives/single.ts:78-82` (`CountOf = z.enum(["stop","day","city"])`); `presets.ts:73-88` (both `count` rows omit `of`); `filters.ts:123-126` (non-filter params get "no row in the matrix and no control"); `presets.test.ts:49-54` compares widget *names* only. `of` is reachable through `insert_widget` via `primitiveCatalog().params` (`registry.ts:139-151`) and the prompt line at `handleAskRequest.ts:1013`.
- **What is wrong:** "how many days / how many cities" is code a person cannot run — the shape of KI-2026-09-02-d (built, no consumer). `attribute.field` avoids this only because four presets happen to carry it.
- **Suggested fix:** two preset rows (data only, ADR-039 decision 5); generalise `presets.test.ts:49` — every enum value of every `nonFilterParams` entry appears in some preset's `params`.
- **Scope of the fix:** `presets.ts`, `presets.test.ts`. Check subset: `pnpm --filter @tc/pages test`.
- **Cross-reference:** ADR-039 decision 5, KI-2026-09-02-d, proposed widget rule 5 in the README.
