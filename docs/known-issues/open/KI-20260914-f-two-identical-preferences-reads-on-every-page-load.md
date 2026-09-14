### KI-2026-09-14-f — `fetchIsAdmin` and `fetchPreferences` both GET `/api/account/preferences`, so every page load reads it twice

- **Severity:** cost / latency — no correctness impact. Two identical authenticated reads per page load, of a row the app already fetches.
- **Area:** `apps/web/src/lib/apiClient.ts` — `fetchIsAdmin` and `fetchPreferences` issue the same `GET /api/account/preferences`; neither goes through `cachedRead`.
- **What is wrong:** the two helpers read one endpoint for two fields of one response. `is_admin` rides alongside `preferences` deliberately (see `fetchIsAdmin`'s own comment — it is an authorisation fact, not a preference, so widening the preferences DTO would be wrong), but two callers of one endpoint still means two requests.
- **How it came to light:** the second browser walk of PR #175 (2026-09-14) captured the pair on every page load in every trace, e.g. `+14750ms GET /api/account/preferences` / `+14828ms GET /api/account/preferences`, 78ms apart.
- **Why not fixed there:** `fetchIsAdmin` arrived with the M20 Phase 1 entitlements merge (#174) and is not PR #175's code; folding it in would have widened that PR past the change it was reviewed for. Recorded rather than fixed for that reason alone — it is a small fix.
- **Scope:** either route both through `cachedRead` under one key (they are the same request, so in-flight de-duplication alone collapses them when they mount together — `queryKeys.ts` would gain an `account` key), or have the one caller that needs both read the response once and take both fields. The second avoids putting an authorisation read in a cache at all, which is the more conservative shape.
- **Cross-reference:** PR #174 (the merge that added `fetchIsAdmin`), PR #175, ADR-046.
- **First noted:** 2026-09-14, in the second browser walk of PR #175.
