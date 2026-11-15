# ADR-091: Production migrates before it deploys, on every push to `main`

**Status:** **Accepted — 2026-11-15.** Mitchell, after KI-2026-11-15-b.
**Deciders:** Mitchell (product/eng); Claude — drafted
Amends: ADR-004 (*Migrations*), and reverses the 2026-08-27 rule that a human dispatches
every production migration (`docs/guidelines/ci-cost-and-capacity.md`, *The last gate*).

## Context

From 2026-08-27 production had two independent triggers. Coolify (before it, Vercel) deployed
`main` on every push through its own GitHub webhook. Migrations were applied only when someone
dispatched `.github/workflows/migrate-production.yml`. That split was chosen to stop a full CI
re-run of `main` gating an automatic migration (~456 billed minutes a month, before the repo
went public). `migration-pending.yml` (KI-2026-09-05-k) was added later to say when the two
had come apart; it reports and blocks nothing.

On 2026-11-14 PR 752 merged with migration `0078`. Production deployed the code at the merge
and the migration was applied about 20 hours later. In between, every OAuth Allow answered
500 (KI-2026-11-15-b). `migration-pending` was red the whole time.

Mitchell: **"I forget to run migrations."** He chose migrating automatically before every
deploy over a gate that holds the deploy until someone dispatches.

## Decision

1. **`.github/workflows/deploy-production.yml` is the only path from `main` to production.**
   On every push to `main` (and by hand): check the journal's shape, apply pending migrations
   with `pnpm --filter web db:migrate` against `PRODUCTION_DATABASE_URL`, confirm with
   `db:state` that production has every migration in the tree, then deploy `caesura-web`
   through Coolify's API (`scripts/coolify-deploy.mjs`) and wait for that deployment to finish.
   **A failed migration or check deploys nothing**, and the run is red.
2. **Coolify's Auto Deploy is off on `caesura-web`.** This is a required setting: with it on,
   Coolify deploys on the push before the workflow has migrated, which is the bug.
3. **One at a time, in order, never cancelled.** `deploy-production` and `migrate-production`
   share the `production` concurrency group with `cancel-in-progress: false`. A run whose
   commit is no longer the head of `main` migrates and then leaves the deploy to the newer run
   queued behind it, because Coolify builds the branch head, and deploying now would serve
   newer code before its migration.
4. **`migrate-production.yml` stays as a manual break-glass.** `migration-pending.yml` keeps
   only its manual dispatch: `deploy-production` runs the same check before every deploy, and a
   push trigger would race the migration it is checking.

What still holds from ADR-004: migrations run through drizzle-kit as an explicit CI/deploy
step, never at cold start and never from a build. Execution stays in automation, and the
connection string stays a repo secret. What changes is that no human is in the trigger.

## The invariant this creates

**Every migration must work with the code that is already running.** It is applied a few
minutes before the code that needs it serves, and the old code runs against the new schema
for the length of a build. If a deploy fails after its migration, the old code keeps running
against the new schema indefinitely. So migrations are **expand/contract**:

- **Expand** (add a nullable column, a column with a default, a table, an index): one PR. The
  old code ignores what it does not know about.
- **Contract** (drop or rename a column or table, add `NOT NULL` to a column the old code does
  not write, narrow a type): two PRs. The first stops the code from using the thing and
  deploys. The second, merged after that deploy is live, removes it. A rename is add, backfill,
  switch reads and writes, then drop.

The rule is in `docs/guidelines/environments-and-deploys.md` (*Migrations run before the code
that needs them*) and in `AGENTS.md`'s Definition of Done.

## Consequences

- A merged migration reaches production minutes after merge, with no step for anyone to
  remember. The KI-2026-11-15-b window cannot recur unless Auto Deploy is switched back on.
- Every push to `main` costs a few minutes of Actions: install, migrate, and the wait for
  Coolify's build. The repo is public, so these minutes are free; the cost is a few minutes of
  runner time per merge, accounted in `docs/guidelines/ci-cost-and-capacity.md`.
- A migration that is not backward-compatible now breaks production for the length of a build
  (or longer, if the build fails). Before, the same migration broke it for however long the
  dispatch was late. The two-step rule above is the control. No wall enforces it yet: whether
  a `DROP` is safe depends on what the running code reads.
- Coolify's queue refuses a second deployment of a branch's `HEAD` while one is in flight, so
  the workflow waits for each deployment to finish. That holds the `production` group for the
  length of a build. A burst of merges queues; GitHub keeps one pending run per group, and the
  newest replaces the older pending ones, which is correct because the newest migrates and
  deploys everything they would have.
- A manual `migrate-production` dispatched while a deploy is pending replaces that deploy (one
  pending run per group). Re-run `deploy-production` by hand afterwards.
- Rollback is unchanged: Coolify → `caesura-web` → Deployments → redeploy the previous one.
  Migrations are forward-only, so rolling code back is safe only because of the invariant
  above.

## Rejected

- **Gate the deploy on a red `migration-pending` until someone dispatches.** It fixes the 500
  but keeps the human step Mitchell said he forgets. The deploy would wait instead of being
  broken, which is better, but it is still late.
- **Migrate at container start.** ADR-004 rejected that, and it still applies: every restart
  would migrate, and a failed migration would leave the app down instead of the old version
  running.
- **Migrate in the production image build.** The build has the database URL, but a build that
  fails after migrating leaves the same state as a failed deploy, and builds of previews and
  production share `build-migrate.mjs`, which deliberately refuses production (KI-2026-09-06-h).
