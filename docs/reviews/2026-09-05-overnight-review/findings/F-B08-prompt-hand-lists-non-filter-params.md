# F-B08 — The assistant prompt hand-enumerates the non-filter params that `primitiveCatalog()` already derives

- **Stream:** B Notebook · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts:1013` ("`attribute` needs `field` … `count` takes `of`") beside the derived `primitiveCatalog()` at `:1018`; the `compose_page` precedent — the same hand-list going stale — is recorded at `:1005-1010`.
- **Suggested fix:** build the sentence from `primitiveCatalog().filter(p => Object.keys(p.params).length > 0)`.
- **Scope of the fix:** one file. Check subset: `handleAskRequest` unit tests.
- **Cross-reference:** proposed widget rule 9 in the README ("derive, never restate").
