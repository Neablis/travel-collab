# F-F09 — Small duplicates inside `server/ai/`: `usageOf` twice, `modelIdOf` twice

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified; the "three truncators" clause was DROPPED — they differ in behaviour)
- **Area:** `usageOf` at `apps/web/src/server/ai/askAnalytics.ts:534-540` and `askIntent.ts:419-425` (byte-identical; `askIntent` already imports from `askAnalytics` at `:63`); `modelIdOf` at `handleAskRequest.ts:1042` and `askIntent.ts:380` (`askIntent.ts:378-379` explains the import-direction problem — the fix is a leaf module, not an import).
- **Suggested fix:** export `usageOf` from `askAnalytics.ts`; a tiny `server/ai/modelId.ts` both import. ~12 lines.
- **Scope of the fix:** 3 files. Check subset: `askIntent.test.ts`, `askAnalytics.test.ts`.
- **Do not:** merge `truncateForLog` (`askAnalytics.ts:233`, slice only), `sanitizeForLog` (`:255`, strips control chars + trims) and `askIntent.ts:258`'s `truncate` (trim only) — they are three behaviours, not one.
