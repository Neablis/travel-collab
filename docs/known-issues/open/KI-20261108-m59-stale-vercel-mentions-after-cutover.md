### KI-2026-11-08 — stale Vercel mentions left after the M59 cutover

- **Severity:** cleanup.
- **Area:** `.env.example`, `apps/web/src/lib/config.ts`, `apps/web/src/server/public-api/exposure.ts`, `apps/web/src/server/ai/sweep.ts`, `apps/web/src/server/ai/simulatedModel.ts`, `apps/web/src/app/api/health/ai-mode/route.ts`, `apps/web/public/llms.txt`, the api-catalog, `docs/ops/cheap-operations.md`, `.github/workflows/ci.yml`, `scripts/check-migration-journal.mjs`, `scripts/lane-probe.mjs`.
- **Symptom / What happens:** comments and prose still describe Vercel as the host: `.env.example` blocks (check any that say a variable is required "on Vercel"), code comments in the files above, `cheap-operations.md` still describing `vercel.json` and `vercel-preview.yml` as live, `ci.yml` and `check-migration-journal.mjs` comments, `lane-probe.mjs` Node comments ("CI and Vercel run"). All inert; none instructs anyone to do a Vercel step. ADR-062 and ADR-075 mention it as history and stay.
- **Why not fixed here:** scope (PR 707 review). The instructions that would mislead an agent were fixed in that PR.
- **Fix path:** one sweep: `git grep -il vercel -- ':!docs/architecture'` and reword each to Coolify, or delete the mention. `lib/deployment/env.ts` keeps its `VERCEL_*` fallbacks on purpose.
- **Tripwire:** an agent or operator told to do something "on Vercel" by a comment.
- **Cross-reference:** PR 707, M59 part 5.
- **First noted:** 2026-11-08, from the PR 707 review.
