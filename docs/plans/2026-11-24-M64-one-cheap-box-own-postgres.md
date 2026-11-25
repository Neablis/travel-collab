# M64 plan — Caesura runs on one cheap box, with its own Postgres

Milestone: `docs/milestones/M64-one-cheap-box-own-postgres.md` (decisions D1–D14, answered
2026-11-24). ADR: `docs/architecture/ADR-093-postgres-on-the-box-reached-through-a-tunnel.md`.
Part 0 is the prose-only tracking PR on `claude/caesura-neon-migration-b5c8f3`; it merges last.
This plan replaces `docs/plans/2026-11-09-move-vps-to-ovhcloud.md`, which part 0 deletes.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `apps/`, `scripts/`, `.github/`,
`.claude/` or `docs/`. Line numbers are from `main` at `cc569c71`, so treat them as a starting
point, not as fact. **New** marks a file that does not exist yet. Values (passwords, keys, IPs)
never go in the repo, a PR, a log or the chat. They move from tool to tool, as in M59.

## Why two stacks, not one

A milestone is normally one stack that lands through its top PR. This one is a migration, so
some code has to be on production **before** the cutover and some **only at** it:

- **Stack A (parts 1–2) merges before cutover.** The maintenance page has to be on the old box
  before the old box can show it. Umami's script is env-gated, so it is safe on either box. The
  compare script is needed from the rehearsal onward.
- **Stack B (parts 3–5) merges at cutover**, in the window between the final restore and the DNS
  flip (O8). Its tunnel and image-deploy workflows point at the new box and cannot work against
  the old one.

Each stack's top PR gets the one full CI run (`close-a-milestone` step 1, run once per stack).
Stack B's top PR is retargeted to `main` and marked ready during the rehearsal (O6), so its CI is
green **before** the cutover evening. On the evening it is only merged.

## Order

| Part | Branch | Stack | Depends on | Merges |
|---|---|---|---|---|
| 1 Cutover tools: maintenance mode and the compare script | `claude/m64-part1-maintenance-and-compare` | A | — | before O6 |
| 2 Umami replaces Plausible | `claude/m64-part2-umami` | A | 1 | with part 1, through part 2's PR |
| 3 Production's database through an SSH tunnel | `claude/m64-part3-db-tunnel` | B | `main` after stack A | at O8 |
| 4 Images built in Actions, and the preview app | `claude/m64-part4-images-in-actions` | B | 3 | at O8 |
| 5 Neon out of code, scripts and docs | `claude/m64-part5-neon-out` | B | 4 | at O8, through part 5's PR |

Files two parts touch: `.env.example` (1, 2, 3, 4) and `Dockerfile` (2, 4). Each part edits only
its own variables; the later part rebases. `docs/ops/coolify-vps.md` is rewritten by part 5,
and parts 3–4 add only their own sections.

Facts the parts share (the survey, 2026-11-24):
- **No schema change, so no migration number.** The latest is `0079_mfa`. pgvector comes from
  `drizzle/0054_rag_day_embeddings.sql:6` (`CREATE EXTENSION IF NOT EXISTS vector`) with an HNSW
  index at `:38`.
- **The app's only pool** is `server/db/client.ts:7`, `new Pool({ connectionString:
  withExplicitSslMode(DATABASE_URL) })`, with no `max` and no timeouts. `server/db/sslMode.ts:20`
  exists because Neon's string carries `sslmode=require`. On the box the string is
  `sslmode=disable` on Coolify's private network.
- **CI never used Neon.** `ci.yml:244,300` runs `pgvector/pgvector:pg17` services, and
  `scripts/with-test-db.mjs:145` (`assertLocalHost`) refuses non-loopback hosts.
- **Workflows that reach production's database**, all through `secrets.PRODUCTION_DATABASE_URL`:
  `deploy-production.yml:70-82`, `migrate-production.yml:81-85`, `migration-pending.yml:61-66`,
  `backfill-countries-production.yml:62`, `import-content-production.yml:111`.
- **The image:** `Dockerfile:1-129` builds with BuildKit secrets (`:89-99` export loop) and runs
  `build:container` (`apps/web/package.json:12`): public-origin check, `build-migrate`, maplibre
  worker, `next build`. Nothing pushes to a registry today; the only registry login is Docker
  Hub, for CI's service containers.
- **Previews:** `coolify-preview.yml` (one at a time, `:123-139`) and
  `scripts/coolify-preview.mjs` (`openPreview` :42, `removePreview` :57) drive Coolify's git
  previews. `preview-link-check.yml:46,65-76` waits on `/api/health`'s `version`.
- **Plausible** appears in `app/layout.tsx:111-112,167-172` (test `app/layout.test.ts:56-71`),
  `next.config.ts:12-24,41,57-58,90-91` (test `next.config.test.ts:89-102`), `Dockerfile:57-58,89-90`,
  and `.env.example:448-449`.
- **The proxy matcher is narrow** (`proxy.ts:309-321`). Maintenance has to cover every path, so
  part 1 widens it with a maintenance-only fast path. A request the proxy did not match before
  must take a path that costs nothing more when maintenance is off.
- **The barred-words tests** are `components/front/AiScreen.test.tsx:197-210`,
  `components/front/SecurityScreen.test.tsx:148-160`, and
  `server/public-api/discovery.test.ts:244-250`.

## Part 1 — Cutover tools: maintenance mode and the compare script (~9 files)

**Theme.** D9 and the comparison behind gate boxes 3, 5 and 6. It changes nothing while
`MAINTENANCE_MODE` is unset.

| File | Entry point | Change | Test |
|---|---|---|---|
| `lib/maintenance.ts` **New** | `isMaintenance()`, `maintenanceResponse(req)` | Reads `MAINTENANCE_MODE === "true"` per request. HTML notice (D9's words, no links, no DB) for pages; `503 {"error":"maintenance"}` JSON for `/api/*`, `/.well-known/*`, `/oauth/*`; `Retry-After: 600` and `X-Robots-Tag: noindex` on both | `lib/maintenance.test.ts` **New** |
| `proxy.ts` | `proxy` (top), `config.matcher` :309 | First branch: in maintenance, every path except `/api/health` and `/_next/static` gets `maintenanceResponse`. The matcher widens to cover them, and the rest of the proxy is unchanged when maintenance is off | `proxy.test.ts` |
| `app/api/health/route.ts` | `GET` | Adds `maintenance: true` while on; still 200 | `app/api/health/route.test.ts` |
| `scripts/compare-databases.mjs` **New** | `compare(a, b)`, `main` | Takes two connection strings and prints per-table row counts, `drizzle.__drizzle_migrations` hashes, `pg_extension` `vector`, and the HNSW index on `day_embeddings`. Exits 1 on any difference. Read-only (`SET TRANSACTION READ ONLY`) | `scripts/__tests__/compare-databases.test.mjs` **New** (pure diff logic) |
| `.env.example` | — | `MAINTENANCE_MODE` documented, unset | — |
| `docs/ops/coolify-vps.md` | new *Maintenance* section | How to switch it on and off | — |

The test seen red: break `isMaintenance` to always return false, and the proxy test that expects a
503 on `/trips/x` fails.

**Preview walk:** set `MAINTENANCE_MODE=true` on the preview, and open `/`, `/trips/anything` and
`/api/v1/trips`: the notice appears, and the API answers 503 JSON. `/api/health` shows
`"maintenance":true`. Unset it, and the app is back.

## Part 2 — Umami replaces Plausible (~8 files)

**Theme.** D4 and D10. Umami is hosted on the new box (O4), at `umami.caesura.today`. Until O4
sets the variables, the script is absent, so this part is safe to merge before the box exists.

| File | Entry point | Change | Test |
|---|---|---|---|
| `app/layout.tsx` | :111-112, :167-172 | Reads `NEXT_PUBLIC_UMAMI_SRC` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID` and renders `<Script defer src data-website-id>` only when both are set. Plausible is removed | `app/layout.test.ts` |
| `apps/web/next.config.ts` | `plausibleOrigin` :12-24, CSP :57-58, :90-91 | Becomes `umamiOrigin`, and script-src/connect-src name Umami only | `apps/web/next.config.test.ts` |
| `Dockerfile` | :57-58, :89-90 | Build ARGs and secret mounts renamed | — |
| `.env.example` | :448-449 | Umami variables replace Plausible's | — |
| `components/front/AiScreen.test.tsx` | :197-210 | `OVHcloud`, `Umami` and `Plausible` added to the barred words | itself |
| `components/front/SecurityScreen.test.tsx` | :148-160 | Same | itself |
| `server/public-api/discovery.test.ts` | :244-250 | Same | itself |

The test seen red: put the Plausible origin back in `next.config.ts`'s CSP, and the CSP test fails.

**Preview walk:** with the Umami variables set on the preview, open a page. A request to
`umami.caesura.today/api/send` returns 2xx, and the pageview appears in Umami's dashboard.

## Part 3 — Production's database through an SSH tunnel (~10 files)

**Theme.** D7 and ADR-093 §2–3. Every production-DB workflow opens the tunnel first, with ADR-091's
order unchanged.

| File | Entry point | Change | Test |
|---|---|---|---|
| `.github/actions/db-tunnel/action.yml` **New** | composite action | Writes the deploy key and the pinned host key from secrets (`BOX_SSH_KEY`, `BOX_SSH_KNOWN_HOSTS`, `BOX_SSH_HOST`). Runs `ssh -N -L 15432:127.0.0.1:5432 tunnel@host` in the background, waits for the port, and kills it in a post step | exercised by the workflows; a `pg_isready` step proves it |
| `.github/workflows/deploy-production.yml` | :65-82 | Tunnel before *Apply pending migrations*; the PgBouncer note :73 goes | — |
| `.github/workflows/migrate-production.yml` | :81-85 | Tunnel; notes :46, :83-85 updated | — |
| `.github/workflows/migration-pending.yml` | :59-66 | Tunnel | — |
| `.github/workflows/backfill-countries-production.yml` | :62 | Tunnel | — |
| `.github/workflows/import-content-production.yml` | :111 | Tunnel | — |
| `apps/web/scripts/import-content-production.ts` | :474 | The comment about "a pooler" goes; the lock stays | `server/importContentProduction.int.test.ts` |
| `scripts/check-workflow-tunnel.mjs` **New** | `main` | Fails if any workflow that names `PRODUCTION_DATABASE_URL` lacks a `db-tunnel` step before it. Runs in CI's `scripts` lane | `scripts/__tests__/check-workflow-tunnel.test.mjs` **New** |
| `docs/ops/coolify-vps.md` | new *Tunnel* section | The tunnel user, the `authorized_keys` restriction, and the secrets by name | — |

The test seen red: remove the tunnel step from `migration-pending.yml`, and the check fails, naming
that file.

**Preview walk:** nothing on screen. Verify during the rehearsal (O6): run `migration-pending`
from the branch with the secrets pointing at the new box, and it reports `db:state` through the
tunnel.

## Part 4 — Images built in Actions, and the preview app (~12 files)

**Theme.** D6 and D8, and ADR-093 §4. `caesura-web` and `caesura-preview` deploy images by tag.

| File | Entry point | Change | Test |
|---|---|---|---|
| `.github/workflows/deploy-production.yml` | after the head check :88-100 | Builds with `docker/build-push-action` (BuildKit secrets from Actions, `SOURCE_COMMIT` as a build arg), pushes `ghcr.io/<repo>/web:<sha>`, then deploys that tag | — |
| `scripts/coolify-deploy.mjs` | `queueDeploy` :37 | Sets the application's image tag (`PATCH /api/v1/applications/{uuid}`) before `POST /deploy` | `scripts/__tests__/coolify-deploy.test.mjs` |
| `.github/workflows/coolify-preview.yml` | :84-143 | On label or push: tunnel (part 3), migrate and seed `caesura_preview`, build `web:pr-<n>`, then deploy it to `caesura-preview`. On unlabel or close: the preview app is stopped. One at a time stays | — |
| `scripts/coolify-preview.mjs` | `openPreview` :42, `removePreview` :57 | Deploy and stop `caesura-preview` by tag, instead of git previews | `scripts/__tests__/coolify-preview.test.mjs` |
| `apps/web/scripts/lib/build-steps.mjs` | `buildSteps` :9 | The image build never migrates; the preview migrate moves into the workflow | `apps/web/scripts/build-migrate.test.ts` |
| `Dockerfile` | `ARG SOURCE_COMMIT`, runtime `ENV` | The commit is baked in, so `/api/health`'s `version` works without a git source | — |
| `.github/workflows/preview-link-check.yml` | :46 | `PREVIEW_URL=https://preview.caesura.today` | `scripts/__tests__/check-preview-links.test.mjs` |
| `.claude/agents/phase-verifier.md` | :60-69 | The walk URL | — |
| `.claude/skills/review-a-part/SKILL.md` | :38-41 | Same | — |
| `.claude/skills/close-a-milestone/SKILL.md` | :32-35 | Same | — |
| `docs/guidelines/environments-and-deploys.md` | :181-243 | Previews rewritten | — |

The test seen red: drop the tag PATCH from `coolify-deploy.mjs`, and its test that expects the
PATCH before the POST fails.

**Preview walk:** label the part's own PR. Within the workflow run, `preview.caesura.today/api/health`
reports the PR head as `version`, and a signed-in page reads `caesura_preview` data (the seed's
demo trip).

## Part 5 — Neon out of code, scripts and docs (~25 files, mostly prose)

**Theme.** Gate box 12's "no code names Neon", and the runbook rewrite. No behavior change, except
the pool getting explicit limits.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/sslMode.ts` | `withExplicitSslMode` :20 | Kept generic, without the Neon wording | `server/db/sslMode.test.ts` (fixture becomes a generic host) |
| `server/db/client.ts` | :7 | `max: 10`, `idleTimeoutMillis`, `connectionTimeoutMillis` set explicitly | — |
| `apps/web/scripts/lib/preview-migrate.mjs` | `renumberedMessage` :41 | "the preview database" | `apps/web/scripts/build-migrate.test.ts:99` |
| `apps/web/scripts/with-test-db.mjs` | :139-151 | Wording | `apps/web/scripts/with-test-db.test.ts:42-66` |
| comments only | `server/warmPublicPages.ts:3,9-20`, `server/publicLibrary.ts:103`, `server/librarySnapshot.ts:20`, `server/og/limit.ts:11`, `server/og/playbooks.ts:31`, `server/db/schema.ts:2230`, `server/ai/eval/planRetrieval.*`, `scripts/check-migration-journal.mjs:22`, `apps/web/scripts/build-migrate.mjs:10`, `apps/web/scripts/preview-migrate.mjs:12` | "keeps Neon awake" becomes "saves a database read". The behavior stays: fewer reads are still cheaper | — |
| `.claude/skills/ai-usage/SKILL.md`, `ledger.sql` | :54, :5 | Production reads through the tunnel, not the Neon MCP | — |
| `docs/ops/coolify-vps.md` | whole | Rewritten for the OVHcloud box: Postgres, backups, tunnel, Umami, previews, costs | — |
| `docs/guidelines/environments-and-deploys.md`, `stack-and-constraints.md`, `stacked-prs.md`, `billing-without-spending-money.md` | survey lines | Neon references updated | — |
| `docs/ops/cheap-operations.md` | top | A dated note: its Neon and Vercel prices are history | — |
| `docs/architecture/SYSTEM-DESIGN.md`, `README.md` :14 | — | The database is Postgres on the box (ADR-093) | — |

The test seen red: `sslMode.test.ts`, after its fixture changes, with `withExplicitSslMode`
broken to drop the mode.

**Preview walk:** nothing on screen. Verify with `git grep -n -i neon -- apps scripts .github .claude`,
which prints only historical references and the ADRs.

## Ops track (O1–O9)

**Who** says whether Mitchell or the agent does a step. "On Mitchell's go" means the agent waits
for his word in chat.

| Step | Who | What | Done when |
|---|---|---|---|
| O1 | **Mitchell** | Orders OVHcloud VPS-2 in Vint Hill, VA, with plain Ubuntu 24.04, no backup add-on, and the `caesura-vps` public key; reads the checkout total first. Creates an R2 bucket `caesura-backups` and an S3 API token scoped to it. Sends the IPv4 address | `ssh` with the key answers |
| O2 | agent | `ufw` 22/80/443/8000, a 2 GB swap file, Coolify by its official script, concurrent builds 1 | dashboard answers on `:8000` |
| O3 | **Mitchell** | Coolify admin account; the new instance added to Coolify's GitHub App; a Coolify API token for the session; GHCR pull credentials in Coolify (a fine-grained token with `read:packages`) | token works |
| O4 | agent | Postgres 17 + pgvector, with no public port and its host port bound to `127.0.0.1`; databases and roles `caesura`, `caesura_preview`, `umami`; scheduled S3 backup to R2 nightly at 03:30 UTC, keeping 14; the `tunnel` user (no shell, `permitopen=127.0.0.1:5432`). Redis with serverless-redis-http (consistent container name on, KI-2026-11-15-a). Umami at `umami.caesura.today`. `caesura-web`, built on the box from the Dockerfile for now (nothing else runs there yet), with production's env copied by name (KI-2026-11-09-b's three dropped) and `DATABASE_URL` set to the internal Postgres. `caesura-preview` empty. The four scheduled tasks (embed-days, tier-rollup, discover-rank and any others in the runbook's table) | each service healthy; `nc -vz <public ip> 5432` from the laptop fails |
| O5 | agent | **Restore drill:** wait for (or trigger) one R2 backup, restore it into a scratch database, then `compare-databases` against the source. Then drop the scratch database | compare equal (gate box 3) |
| O6 | agent | **Rehearsal:** `pg_dump -Fc` Neon production, `pg_restore` into `caesura`, `compare-databases` Neon vs box, recording each step's time. Point `staging.` at the new box and walk it (gate box 5). Try maintenance on and off on the new box (gate box 4). Run part 3's tunnel from the branch (`migration-pending`). Retarget stack B's top to `main`, mark it ready, read CI green. Measure memory with production plus one preview (gate box 11). Export Plausible's CSV to R2 | all four gate boxes ticked with evidence |
| O7 | agent, on Mitchell's go | Lowers the Cloudflare TTL on the apex, `www`, `staging.`, `coolify.` and `*.preview.` (plus new `preview.` and `umami.` records) to 60 s, a day ahead. Agrees the evening with Mitchell | TTLs read 60 |
| O8 | agent, on Mitchell's go | **Cutover**, in the runbook below | production serves from the box (gate box 6) |
| O9 | agent, each on Mitchell's OK | After a day with no rollback: deletes Hetzner `caesura-1` and its IPs and firewall (Plausible goes with it). Suspends Neon or drops it to the free plan, not deleting it. Mitchell pauses the Vercel project. Records the bills (gate box 13). Deleting Neon two weeks later is a follow-up | gate box 12 |

### The cutover runbook (O8)

Times are for a rehearsal that took *T* minutes to dump and restore. The window is about *T* + 10.

1. **Before:** stack B's top PR is green and ready (O6). The new box's `caesura` is the rehearsal
   copy, and is about to be overwritten.
2. **Maintenance on, on the old box** (`MAINTENANCE_MODE=true` on Hetzner's `caesura-web`,
   restart). Check: `curl -s https://caesura.today/api/health` shows `"maintenance":true`, and `/`
   answers 503. Writes stop here. Pause the old box's scheduled tasks.
3. **Final copy:** `pg_dump -Fc` from Neon, drop and recreate `caesura` on the box, `pg_restore`,
   then `compare-databases` Neon vs box. **If anything differs, stop:** turn maintenance off on the
   old box, and the evening is over with nothing lost.
4. **Merge stack B's top PR.** `deploy-production` runs. Its migrate step finds nothing pending
   through the tunnel, it builds the image, and it deploys the image to the new box's
   `caesura-web` (whose secrets `COOLIFY_URL`, `COOLIFY_APP_UUID`, `COOLIFY_API_TOKEN` and the
   tunnel's were switched to the new box in O6). Check: the new box answers
   `/api/health` with the merge's sha and no maintenance, through `curl --resolve`.
5. **DNS:** in Cloudflare, point the apex, `www`, `staging.`, `coolify.`, `*.preview.`,
   `preview.` and `umami.` at the new IP (grey cloud, unchanged). Let's Encrypt issues on the
   first request.
6. **Walk production** (gate box 14): sign in with Google, open a trip, ask the assistant, a
   pageview in Umami. Fire one cron by hand.
7. **After:** the old box stays in maintenance (anyone on stale DNS sees the notice, not stale
   data) until O9 deletes it. Raise the TTLs back.

**Rollback**, if step 6 fails **before any real user has written**: point the DNS back at the old
box's IP, turn maintenance off there, and resume its scheduled tasks. Neon was never written to
after step 2, so nothing is lost. **After real writes**, rolling back means copying those rows to
Neon by hand first. That is why step 6 happens straight away and the window is kept short.

## Gate

Read CI on each stack's top part head: part 2's PR for stack A, part 5's PR for stack B. Code boxes
point at tests seen red. The ops boxes (2, 3, 5, 6, 7, 8, 11, 12, 13) are ticked from the
evidence each O-step names: command output, Coolify execution logs, the R2 listing. The **[walk]**
is Mitchell's, on production after O8.
