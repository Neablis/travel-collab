# F-G06 — `<Analytics/>` and `<SpeedInsights/>` mount unconditionally, so every page of a non-Vercel production run logs two 404s and two strict-MIME console errors

- **Stream:** G Broken functionality · **Severity:** LOW · **Confidence:** CONFIRMED (browser walk, 17 of 17 pages)
- **Area:** `apps/web/src/app/layout.tsx:2-3,66-67`. The e2e suite has no `console`/`pageerror` listener (grep `apps/web/e2e`: none).
- **What is wrong:** harmless on Vercel; locally and in CI's `next start` it buries real console errors (34 of the walk's ~70 finding lines were this), and it is exactly what would make adding a "no console errors" assertion to e2e impossible.
- **Suggested fix:** render both only when `process.env.VERCEL` is set (server component; env is available at render). Then consider a `pageerror` listener in `e2e/helpers.ts` that fails a spec on any app-originated console error.
- **Scope of the fix:** one file (+ optional e2e helper). Check subset: `smoke.spec.ts` under `ci-like`.
- **Cross-reference:** F-D09 (stream D noted the unconditional mount without the console consequence).
