### KI-7 — `ai` / `@ai-sdk/gateway` provider-type version skew (V1 vs V2) — RESOLVED
- **Severity:** was assumed type-level only; turned out to be a genuine
  runtime incompatibility (see Correction below).
- **Area:** `apps/web/src/server/ai/handleAiRequest.ts` (`aiModel()` call
  site) — corrects the original entry's `route.ts` reference; the handler
  moved to its own module in a later fix (Next.js route-export rule).
- **Symptom:** the installed `@ai-sdk/gateway` resolved to `1.0.41`, built
  against `@ai-sdk/provider`'s `LanguageModelV2`, while the repo pinned
  `"ai": "^4.0.0"`, whose `LanguageModel`/`generateText` types are `V1`.
  `aiModel()`'s return type didn't structurally satisfy `LanguageModel` per
  TypeScript, bridged at the time with a documented cast.
- **Correction (2026-07-21, after a live call was made):** this was NOT
  type-level only. `ai@4`'s `generateText` checks a model's
  `specificationVersion` at runtime and throws `"Unsupported model version.
  AI SDK 4 only supports models that implement specification version 'v1'.
  Please upgrade to AI SDK 5 to use this model."` — the cast satisfied the
  compiler but not the actual runtime check, so every real (non-mocked) call
  through this path would have failed with a 422. Confirmed against npm:
  every published `@ai-sdk/gateway` version since its first 1.0.0 stable
  release targets the V2+ spec — there was no V1-compatible gateway version
  to pin to instead.
- **Fix:** upgraded straight to latest (`ai@^7.0.34`,
  `@ai-sdk/gateway@^4.0.26`) rather than stopping at v5, since three real
  breaking-change generations (v5/v6/v7) existed and stopping partway would
  have deferred two more migrations. The cast is gone; `aiModel()`'s return
  type now satisfies `LanguageModel` directly (both packages build against
  the same `@ai-sdk/provider@4.0.3`).
- **First noted:** 2026-07-21 (M7 Task 5.5 / gate-close). **Resolved:**
  2026-07-21 (AI SDK v4→v7 upgrade, post-merge PR fix).
