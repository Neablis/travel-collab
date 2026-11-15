### KI-2026-11-15-b — production ran PR 752's code for about 20 hours without migration 0078, and OAuth Allow answered 500

- **Severity:** correctness. Anyone connecting an app or agent to production in that window got a
  500.
- **Area:** `.github/workflows/migration-pending.yml` (the detector),
  `.github/workflows/migrate-production.yml` (the manual apply),
  `apps/web/drizzle/0078_poppy_one_sign_in_per_resource.sql`, the production deploy on merge.
- **Symptom / What happens:** PR 752 merged around 2026-11-14 20:05 UTC with migration `0078`
  (`oauth_grants.covers_all_resources`, `oauth_tokens.resource`, nullable `oauth_codes.resource`).
  Production deployed the code on merge; `0078` was applied only by `migrate-production` run
  43737004995 at 2026-11-15 16:42 UTC. In that window every OAuth Allow at `/oauth/authorize`
  failed with 500 (seen 2026-11-15 when Mitchell allowed the kit validator's test agent). Token
  minting and refresh, which write the new columns, likely failed too; that was not observed
  directly. `migration-pending` went red at the merge, as designed, but it only reports: nothing
  stopped the deploy, and the red check was not acted on until the 500 was hit.
- **Why not fixed here:** found while recording the validator run in a prose-only PR. Whether to
  block a deploy is a process decision, not a docs change.
- **Fix path:** decide whether a red `migration-pending` should block the production deploy (or
  hold it until `migrate-production` is dispatched), or whether migrating on merge is acceptable
  for additive migrations. Record the decision in an ADR amendment and enforce it by mechanism.
- **Fix (PR 760, pending verification):** decided 2026-11-15, ADR-091. Production migrates
  before every deploy: `.github/workflows/deploy-production.yml` runs on every push to `main`,
  applies migrations, checks with `db:state`, and only then deploys through Coolify's API.
  Coolify's Auto Deploy is off on `caesura-web`. **Stays open until proven:** the first
  `deploy-production` run on `main` after PR 760 merges, with Auto Deploy off, shows the
  migrate, `db:state` and deploy steps green, `/api/health` reports the merge commit, and
  Coolify started no deployment of its own for that push. That run's URL is the proof line,
  and the entry then moves to `resolved/`.
- **Cross-reference:** KI-2026-09-05-k (resolved; built the `migration-pending` detector), PR 752,
  KI-2026-11-14-a (the validator run that found it).
- **First noted:** 2026-11-15, the test agent's Allow on production returned 500.
