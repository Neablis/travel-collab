# F-A05 — CSRF posture rests on Auth.js's default `SameSite=Lax` cookie alone (L6, still open since 2026-08-28)

- **Stream:** A Security · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** every mutation under `apps/web/src/app/api/**`; `apps/web/src/lib/authConfig.ts` (193 lines, `authConfig` at `:148`, no `cookies` override → Auth.js defaults); `apps/web/src/proxy.ts:132` (matcher excludes `/api`); grep for `sec-fetch-site` / `headers.get("origin")` across `apps/web/src` finds only a jsonb column name.
- **What is wrong:** adequate today (Lax cookie, all mutations are non-navigation POST/PATCH/DELETE), but one cookie-config change or an embedded surface needing `SameSite=None` makes every write CSRF-able, and nothing would say so. Residual today is legacy-browser only.
- **Suggested fix:** a ~10-line check in `proxy.ts` (edge-safe) rejecting mutations whose `Origin` header is present and not same-origin; or file it as a KI so the decision is recorded.
- **Scope of the fix:** `proxy.ts`. Check subset: web typecheck + one `ci-like` e2e run (the proxy is in the request path).
- **Test that should exist:** cross-origin `POST /api/trips` with a valid cookie → 403.
- **Do not:** put it per-route.
