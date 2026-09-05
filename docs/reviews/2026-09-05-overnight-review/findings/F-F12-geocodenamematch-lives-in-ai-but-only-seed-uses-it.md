# F-F12 — `geocodeNameMatch.ts` lives in the AI pipeline directory but only the seed script imports it

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified). See also F-G? (stream G was asked whether live enrichment *should* be using it — a correctness question, tracked separately)
- **Area:** `apps/web/src/server/ai/geocodeNameMatch.ts` (220 lines) + `geocodeNameMatch.test.ts` (266); sole non-test importer `apps/web/scripts/geocode-japan-seed.mts:135`; `geocodeEnrichment.ts:27-35` imports only from `geocodeRegion`.
- **What is wrong:** anyone auditing `server/ai/**` reads 486 lines that no request touches.
- **Suggested fix:** move beside its consumer (`apps/web/scripts/lib/`) or into `server/geocoding/` — unless the stream-G question resolves to "live enrichment should apply it", in which case it stays and gains a caller.
- **Scope of the fix:** 2 files moved + import path. Check subset: its own unit test.
- **Cross-reference:** KI-039, KI-058, KI-077 (resolved seed history), KI-015 (open).
