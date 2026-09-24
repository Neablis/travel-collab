### KI-2026-09-14-f — `fetchIsAdmin` and `fetchPreferences` both GET `/api/account/preferences`, so every page load reads it twice — RESOLVED

- **Severity:** cost / latency — no correctness impact. Two identical authenticated reads per page load, of a row the app already fetches.
- **Area:** `apps/web/src/lib/apiClient.ts` — `fetchIsAdmin` and `fetchPreferences` issue the same `GET /api/account/preferences`; neither goes through `cachedRead`.
- **What is wrong:** the two helpers read one endpoint for two fields of one response. `is_admin` rides alongside `preferences` deliberately (see `fetchIsAdmin`'s own comment — it is an authorisation fact, not a preference, so widening the preferences DTO would be wrong), but two callers of one endpoint still means two requests.
- **How it came to light:** the second browser walk of PR #175 (2026-09-14) captured the pair on every page load in every trace, e.g. `+14750ms GET /api/account/preferences` / `+14828ms GET /api/account/preferences`, 78ms apart.
- **Why not fixed there:** `fetchIsAdmin` arrived with the M20 Phase 1 entitlements merge (#174) and is not PR #175's code; folding it in would have widened that PR past the change it was reviewed for. Recorded rather than fixed for that reason alone — it is a small fix.
- **Scope:** either route both through `cachedRead` under one key (they are the same request, so in-flight de-duplication alone collapses them when they mount together — `queryKeys.ts` would gain an `account` key), or have the one caller that needs both read the response once and take both fields. The second avoids putting an authorisation read in a cache at all, which is the more conservative shape.
- **Cross-reference:** PR #174 (the merge that added `fetchIsAdmin`), PR #175, ADR-046.
- **First noted:** 2026-09-14, in the second browser walk of PR #175.
- **Fix (2026-09-24):** the second option in Scope: one read, both fields, no
  cache. `fetchIsAdmin` is gone. `fetchPreferences` now answers
  `{ preferences, isAdmin }` from its one `GET`. `PreferencesProvider` keeps
  `isAdmin` beside the preferences and exposes it as `useIsAdmin()` (`false`
  outside a provider, before the read lands, and on failure), and `AccountMenu`
  reads that hook instead of fetching. `cachedRead` was deliberately not used,
  for two reasons. ADR-046 keeps `apiClient.ts` helpers pure fetchers. This
  shape also keeps an authorisation read out of the cache, so
  `updatePreferences` has no invalidation to get wrong: `save` still adopts only
  `preferences` and never writes `isAdmin`. `AppHeader` renders only under
  `(app)/layout.tsx` and `admin/layout.tsx`, and both mount the provider.
- **Proof:** `apps/web/src/components/AccountMenu.shell.test.tsx` renders
  `PreferencesProvider` + `AccountMenu` over the real typed client, with a fetch
  stub that counts `GET /api/account/preferences`. Against the unfixed client,
  both cases failed with `AssertionError: expected 2 to be 1`. After the fix both
  pass, and the operator link still appears for `isAdmin: true`. Tier 2 subset:
  web `tsc --noEmit`, eslint on the eight changed files, and 13 unit files
  (278 tests) covering every test that renders the menu, the provider or the
  header.
