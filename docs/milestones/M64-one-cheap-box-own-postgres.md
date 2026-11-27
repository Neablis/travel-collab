# M64 — Caesura runs on one cheap box, with its own Postgres

**Status (2026-11-27): closed, gate 14 of 14, one box amended out (PR previews).** Production has
served from the Netcup box on its own Postgres since 2026-11-26 22:06Z (PR 799 merged as
`fb30cf02`). Hetzner is deleted and Neon is on its free plan. The cutover's evidence log is on
Mitchell's laptop (`~/caesura-m64-box/log.md`); what the gate needs from it is quoted below.
**Scoped 2026-11-24.** Minted, scoped and placed by Mitchell on 2026-11-24, with every
decision answered the same day (see *Decisions*). Plan:
`docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`, deleted at the close (2026-11-27;
`docs/plans/README.md`, *Retrieving a deleted plan*). Part 0 is
`claude/caesura-neon-migration-b5c8f3`. ADR-093. **M59 is folded in** (D11): M59 closes with its
three open boxes moved here.

Mitchell, 2026-11-24: *"We have a milestone to get caesura migrated over to a cheaper hosting than
70$ a month. Also we have been working on keeping neon prices low. Could we combine these two
projects and also have Postgres on our servers, and get off neon?"* Then: *"a lot of our memory
usage isnt my server, its the analytics server, Plausible … We would also need a really clear
migration plan"*, and *"I am really focused on price"*.

## Why this exists

Two pieces of cost work were running separately:

- **The box.** M59 put production on Hetzner `cpx31` in Ashburn at **73.49/mo**, about 3.5x the
  same box in Hetzner's EU regions. The plan to move it to OVHcloud
  (`docs/plans/2026-11-09-move-vps-to-ovhcloud.md`, never started; this milestone replaces it)
  picked Hillsboro, Oregon, **only because Neon is in `aws-us-west-2`**: every page makes several
  queries one after another, so the box had to sit next to the database.
- **Neon.** Since M59 a run of changes has gone into letting Neon sleep: the library snapshot
  (ADR-063's amendments), the daily rather than hourly Discover rank (ADR-090's amendment), the
  in-memory link-preview limiter, the public-page warmer.

With Postgres on the box, a query takes well under a millisecond, the box's region can follow the
users instead of the database, and the Neon bill goes to zero. The two moves become one cutover
instead of two.

**The memory is mostly Plausible, not the app** (Mitchell, 2026-11-24). Plausible's ClickHouse holds
1–2 GB even when idle. Umami keeps its data in Postgres, which is now on the box anyway.
Production `next build`s of about 4 GB on the box already caused one outage (KI-2026-11-14-d).
Building the image in GitHub Actions removes that spike from the box altogether.

## Decisions

**Answered 2026-11-24 by Mitchell.** Each one names the option he picked. Where he did not take
the recommendation, it says so.

1. **The database leaves Neon** for Postgres 17 with pgvector (`pgvector/pgvector:pg17`, the image
   CI and `docker-compose.yml` already use), managed by Coolify on the box. **It has no public
   port**: the app reaches it on Coolify's private network, and anything outside the box reaches
   it only through an SSH tunnel (D7). The app needs no driver change. It uses plain `pg` and
   drizzle (`server/db/client.ts:7`), and the only extension is `vector`, from migration
   `0054_rag_day_embeddings`.
2. **Box: Netcup VPS 1000 G12, Manassas, VA**, specs as ordered, **€16.11/mo** as shown at
   Mitchell's checkout, 128 GB SSD (the earlier research's €10 / 256 GB figure was wrong).
   Ordered and paid 2026-11-26, the box is up and the `caesura-vps` key is installed. Its IP
   address is not in the repo; it lives in the `BOX_SSH_HOST` secret. Ruled out: OVHcloud (no US
   stock), OVHcloud Singapore (too far), Hetzner EU CX33 (Germany, ~100 ms extra per page).
3. **Region: US east, Manassas, VA.** Neon no longer decides the region. US east is closer to
   most US users and to Europe.
4. **Analytics: Umami replaces Plausible.** Umami runs as a Coolify service with its own database
   and its own role (`umami`) in the box's Postgres. `NEXT_PUBLIC_UMAMI_SRC` and
   `NEXT_PUBLIC_UMAMI_WEBSITE_ID` replace the two Plausible variables in `app/layout.tsx:111`.
   The script stays env-gated and absent when the variables are unset, and the CSP in
   `next.config.ts` names Umami's origin instead of Plausible's. Pageviews only: the app sends
   no custom events today. **History:** Plausible's data starts 2026-11-09, and Umami cannot
   import it. A CSV export from Plausible goes into the backup bucket before Plausible is
   switched off. That loses about two weeks of charts. *Amended 2026-11-26 by Mitchell:* no
   export; Umami starts from scratch ("start from scratch"). Plausible was deleted with the
   Hetzner box.
5. **Backups: a nightly `pg_dump` to Cloudflare R2**, kept 14 days, using Coolify's scheduled
   S3 backups for the Postgres resource. A **restore drill** is a gate box: restore an R2 dump
   into a scratch database and compare it. There is no point-in-time restore (no wal-g). The
   worst case is losing up to a day of writes. Mitchell accepted that.
6. **Builds: GitHub Actions builds the image and pushes it to GHCR**, and Coolify only pulls
   and runs it. No `next build` runs on the box once production is there. The production image
   is built on every push to `main`. A preview image is built for the PR that carries the
   `preview` label (one at a time, as now). The public build variables (`NEXT_PUBLIC_*`,
   `APP_ENV`) are Actions variables per image. The commit goes into the image as
   `SOURCE_COMMIT`, because Coolify no longer has a git source to set it from.
7. **Migrations: an SSH tunnel from Actions.** `deploy-production` keeps ADR-091's order
   (migrate, check, then deploy). It first opens a tunnel to the box, then runs the same
   `db:migrate` and `db:state`. Every workflow that reaches production's database does the
   same: `migrate-production`, `migration-pending`, `backfill-countries-production`,
   `import-content-production`. The tunnel logs in as a restricted user, with no shell, that can
   only forward to Postgres on `127.0.0.1`. The PgBouncer/UNPOOLED notes go, since there is no
   pooler. ADR-093 records this as an amendment to ADR-091.
8. **Previews: one shared `caesura_preview` database** in the box's Postgres, migrated and
   seeded by the preview build, and **never production's**. Previews stay one at a time,
   through the `preview` label (KI-2026-11-14-d). With images built in Actions, a preview is a
   second Coolify application, `caesura-preview`, which deploys the labelled PR's image at
   `https://preview.caesura.today`. `phase-verifier`, `review-a-part`, `close-a-milestone` and
   `preview-link-check` read that one URL, and `version` in `/api/health` says which PR is on it.
   *(This follows from D6 and D8: a pulled image has no Coolify git preview to hang a
   `<pr>.preview` URL on.)*
9. **Cutover: a maintenance page.** It replaces the recommended planned outage. Interaction
   model, approved as sketched:
   - **On:** `MAINTENANCE_MODE=true` on the application, then a restart (seconds). **Off:** unset
     it, restart.
   - **A visitor, on any page,** sees one static notice: *Caesura. We're moving to a new home.
     Back in a few minutes. Nothing you've saved is lost.* It answers HTTP 503 with
     `Retry-After: 600` and `noindex`. It reads no database, needs no sign-in and has no links.
   - **API, MCP, OAuth and cron routes** answer `503 {"error":"maintenance"}` with `Retry-After`.
     *Amended 2026-11-25 by Mitchell:* no shared code path covers the ~150 `/api` handlers
     (PR 795's review), so `/api` stays outside the maintenance page. **Writes are stopped at the
     database instead:** at cutover step 2, production's Neon role is set to
     `default_transaction_read_only = on`, so every write fails from any route and the final copy
     cannot miss one. API writes answer an error for those minutes, not a tidy 503. Mitchell
     picked this over a Traefik edge rule and over wrapping every handler.
   - **`/api/health`** answers `200 {"ok":true,"maintenance":true,…}`, so deploys and checks
     keep working.
10. **Public pages: the provider stays unnamed.** `/ai`, `/security` and the API discovery text
    name no host or database today. Their tests bar `Neon`, `Hetzner`, `Coolify`, `Vercel`
    (`components/front/AiScreen.test.tsx:205`, `SecurityScreen.test.tsx:156`,
    `server/public-api/discovery.test.ts:247`). `Netcup`, `Umami` and `Plausible` are added
    to those barred lists. No page copy changes. Mitchell picked this over naming Netcup.
11. **M59 is folded in.** M59 closes now (2026-11-24). Its three open boxes are amended there and
    carried here: *Vercel paused* is part of gate box 12, *Coolify previews* is gate box 9
    (amended from "a disposable Neon branch" to "the box's preview database"), and M59's retro
    is written at its close. Mitchell picked this over keeping M59 open.
12. **Placement: M64 is current** once M59 closes, ahead of M53.
13. **Rollback.** Until the first write lands on the new box, rollback is to point DNS back at
    the old box and turn maintenance off there. Neon and the Hetzner box are untouched until
    then. After the first write, rolling back means copying those writes to Neon, which is why
    the window is short and walked straight away. The Hetzner box is deleted after a day with no
    rollback. *Amended 2026-11-26 by Mitchell* ("I would like to start saving money sooner"):
   Hetzner was deleted on the cutover evening, about 20 minutes after production moved, once
   the walk passed. From then on rollback is the Neon route only. **Neon is suspended (or dropped
   to its free plan), not deleted**, for two weeks
    after cutover; deleting it is a follow-up on Mitchell's OK, not a gate box.
14. **Cost is measured, not asserted.** The gate records the monthly bill before (Hetzner 73.49
    plus Neon's last invoice) and after (the Netcup invoice plus R2).

## Scope

- **Code, in two stacks** (the plan says why there are two). Stack A merges before cutover:
  maintenance mode, the database compare script, and Umami. Stack B merges at cutover: images
  built in Actions with the `caesura-preview` app, the SSH tunnel for every production-DB
  workflow, and removing Neon from code, scripts and docs.
- **Ops, in steps O1–O9** (the plan): ordering and building the box, Postgres, backups, Redis,
  Umami and both applications, the restore drill, the rehearsal, the cutover, and the clean-up.
- `docs/ops/coolify-vps.md` is rewritten for the new box. `docs/ops/cheap-operations.md` gets a
  dated note saying its Neon prices no longer apply.

## Out of scope

- Point-in-time restore, replicas and failover (D5). The box is a single point of failure, with
  backups off-box.
- Deleting the Neon project (D13 follow-up).
- Changing what the app does. Apart from the maintenance page, the app on the new box behaves as
  it does today.
- Moving DNS away from Cloudflare (M59 D10's overturn stands). *Correction 2026-11-26:* the apex
  and `www` are **proxied** (orange cloud) with SSL mode Full (strict); the other records are
  grey. The cutover runbook in the plan says why that mattered.

## Exit gate

- [x] **Decisions D1–D14 are answered and recorded here.** (2026-11-24)
- [x] **The new box runs Coolify, Postgres 17 with pgvector, Redis and Umami** (Netcup VPS 1000 G12,
      Manassas), and **Postgres is unreachable from the internet**: a connection to port 5432 on
      the box's public address from outside it fails.
      *(2026-11-26, O2/O4: Debian 13, not the Ubuntu 24.04 the plan assumed; Coolify 4.7.9;
      `pgvector/pgvector:pg17` (17.12, vector 0.8.7) published on `127.0.0.1:5432` only, Redis
      with serverless-redis-http, Umami; every container healthy. `nc -vz <box> 5432` from the
      laptop timed out on IPv4 and IPv6. Docker-published ports skip `ufw`, so Coolify's
      6001/6002 were public too: closed after cutover by a `DOCKER-USER` drop on `eth0` in
      `/etc/ufw/after*.rules`, checked closed from the laptop with the dashboard's live updates
      still working through 443.)*
- [x] **A nightly backup reached R2, and a restore drill from it** into a scratch database
      matched the source on the compare script (every table's row count, the migration journal,
      the `vector` extension and the HNSW index).
      *(2026-11-26, O5: schedule `30 3 * * *` UTC to bucket `caesura-backups`, keep 14, databases
      `caesura`, `caesura_preview`, `umami`. One backup triggered by hand: all three dumps listed
      in R2 (Coolify's `s3_uploaded` field reads null even when the upload worked; the R2 listing
      is the evidence). The `caesura` dump downloaded from R2, restored into `caesura_drill`
      (only the expected `must be owner of extension vector` error), compare-databases: "58
      tables, 80 migrations … The two databases match." Scratch database dropped.)*
- [x] **Maintenance mode behaves as D9 sketches**: tests seen red then green, and switched on
      and off once on the new box before cutover.
      *(Box half 2026-11-26, O6: on, `/` and `/trips/…` answered 503 with `Retry-After: 600` and
      `X-Robots-Tag: noindex` and the notice with no links, `/.well-known/…` answered
      `503 {"error":"maintenance"}`, `/api/v1/trips` 401 (outside, per D9's amendment),
      `/api/health` `"maintenance":true`; off, everything back. An env change takes effect on a
      Coolify restart, about 50 s. Used for real on the old box at cutover. Tests half, from PR
      795's *Verification actually performed*: deleting the catch-all matcher entry
      `/((?!api/|_next/).*)` failed `proxy.test.ts` with `AssertionError: expected false to be true`;
      the earlier catch-all `/((?!_next/static).*)` failed the `/api`-excluded case with `expected
      true to be false`; loosening the still-any-`.`-suffix rule failed with `expected null to be
      '1'`; a plain `BEGIN TRANSACTION READ ONLY` failed `compare-databases.test.mjs`'s isolation
      check; removing the try/catch around `main` failed its exit-2 test with `actual: 1, expected:
      2`; the first push's table covers `isMaintenance`, the health flag and the row-count diff.
      Each restored and seen green: vitest on `proxy.test.ts`, `maintenance.test.ts` and
      `app/api/health` 61 passed, `node --test` on the compare test 7 passed. Recorded 2026-11-27 on
      Mitchell's word, "Record 1, we already did it".)*
- [x] **The rehearsal is done**: Neon's production dump restored on the new box, the compare
      script equal, the dump-to-restore time recorded, and `staging.` walked on the new box
      (Google sign-in, open a trip, ask the assistant, a pageview in Umami).
      *(2026-11-26, O6: dump 13 s (6.9 MB), restore 1 s, compare equal. The restore with
      `--role=caesura` left every object owned by `caesura`: no ownership fallback needed.
      Mitchell walked staging on the box: "Walk passed". Umami's script only reached pages with
      PR 799, so the pageview was seen on production instead (the walk box below).)*
- [x] **Production serves from the new box on its own Postgres.** `caesura.today/api/health`
      answers from it, and the compare script was equal between Neon's final dump and the box at
      cutover.
      *(2026-11-26, O8: old box in maintenance 21:50Z; Neon read-only 21:50:52Z (a test `UPDATE`
      refused on the direct and pooled endpoints); final dump 13 s, restore 1 s, app-role check
      through the tunnel, compare "The two databases match" at 21:52:31Z. PR 799 merged as
      `fb30cf02`, deployed through the new Coolify; DNS flipped 22:06Z. Downtime about 16 minutes,
      about 8 of them waiting on the merge and the image build. `/api/health` reports `version`
      `"HEAD"`, not the sha: Coolify sets `SOURCE_COMMIT` at runtime for image applications and
      overrides the image's value. The running image is `web:fb30cf02…`; the version field needs a
      code follow-up.)*
- [x] **Images are built in GitHub Actions and pulled from GHCR**: the deploy log of a push to
      `main` shows a pull, not a build, and no `next build` runs on the box.
      *(2026-11-26: `deploy-production` run 45901870874 built and pushed
      `ghcr.io/neablis/travel-collab/web:fb30cf02…` (build secrets `APP_ENV`, `PUBLIC_ORIGIN`, both
      Umami variables and the Sentry DSN "from build secret"); Coolify deployment
      `zjzcompie43n861vyftok8f9`'s log reads "Pulling latest images from the registry … Pull
      complete" and no build. `caesura-web` was recreated as a Docker-image application for this:
      the O4 one was a Dockerfile/GitHub app, which the deploy script cannot retag.)*
- [x] **Every workflow that reaches production's database goes through the SSH tunnel**, a push
      to `main` migrates and then deploys (ADR-091's order), and `PRODUCTION_DATABASE_URL` names
      `127.0.0.1`.
      *(2026-11-26: run 45901870874: "127.0.0.1:15432 - accepting connections", migrations
      applied, "80/80 migrations applied", then build and deploy. `PRODUCTION_DATABASE_URL` is
      `caesura@127.0.0.1:15432/caesura?sslmode=disable`, set at cutover just before the merge.
      `scripts/check-workflow-tunnel.mjs` (part 3) keeps every other workflow on the tunnel.)*
- [ ] ~~**PR previews work** (from M59): a labelled PR gets its image deployed to
      `caesura-preview` on the box, using `caesura_preview` and never production's database, and
      the part-reviewer's, phase-verifier's and close-a-milestone's walk instructions point at it.~~
      *Amended 2026-11-27 by Mitchell ("skip #2"):* the deploy half stands as evidenced below; the
      green `preview-link-check` on a labelled PR after PR 803 is not waited for at the close.
      *(2026-11-26: PR 799 labelled `preview`, run 45899608400: image `pr-799-db94a69d…` deployed
      to `caesura-preview`, healthy at `https://preview.caesura.today`; its `DATABASE_URL` names
      the `caesura_preview` role and database. `phase-verifier.md`, `review-a-part` and
      `close-a-milestone` name that URL. `preview-link-check` timed out waiting for `version` to
      equal the sha, because Coolify sets `SOURCE_COMMIT=HEAD` at runtime. PR 803 (`97a385c2`,
      merged as `216b4960`) bakes the sha as `IMAGE_COMMIT`; production's `/api/health` now reports
      `216b4960e3cd91e6bad66b484026f47bcde7fda3`. PR 803's own `preview-link-check` (run
      45909916097) still failed, "last: no answer", so a preview after PR 803 is unproven; see the
      retro's *Leftovers*.)*
- [x] **Umami counts `caesura.today` pageviews, and Plausible is gone.** The CSP names Umami
      only, and `Netcup`, `Umami` and `Plausible` are barred on `/ai`, `/security` and in API
      discovery.
      *(2026-11-26: three pageviews from Mitchell's phone at 22:59Z (`/home`, a trip). His laptop
      browser sent none, so a blocker there is likely; a clean headless load also sends
      `/api/send` 200, which Umami drops as a bot. Production's CSP: `script-src 'self'
      'unsafe-inline' https://umami.caesura.today`, `connect-src` likewise. Plausible was deleted
      with the Hetzner box and its DNS record removed. The barred words are in part 5's tests.)*
- [x] **Memory headroom is measured** on the new box with production and one preview running
      (`free -m` and `docker stats`, recorded here), and is not swapping.
      *(2026-11-26 ~21:45Z: used 2264 of 7945 MB, 5680 available. production `caesura-web` 472
      MiB, `caesura-preview` 165, `coolify` 287, Umami 120, Postgres 116, proxy 79, redis-http 43,
      Redis 9. Swap held 332 MB left over from the earlier on-box Dockerfile build, with 5.6 GB
      free, so not swapping. After cutover (no on-box builds), 2123 MB used.)*
- [x] **Neon is out, and the old hosts are wound down.** No code, script or workflow names Neon
      (historical docs aside). The Neon project is suspended or on its free plan, not deleted.
      Hetzner `caesura-1` is deleted. ~~The Vercel project is paused, not deleted (from M59).~~
      *Amended 2026-11-26 by Mitchell ("Yes, amend it"):* the Vercel project stays on Vercel's
      free tier, costing nothing, rather than paused.
      *(2026-11-26: Hetzner `caesura-1` with its two primary IPs and firewall deleted at 22:25Z;
      `hcloud` lists nothing. Neon org moved Launch to Free at 22:42Z, the project and data kept
      (`production` still read-only). Neon's code removal is part 5. The Vercel project is on the
      free tier, per the amendment above.)*
- [x] **The monthly bill, before and after, is recorded here** (D14).
      *(2026-11-26, list prices and metered charges, not invoices: Mitchell, "I really dont think
      we need actual invoices". **Before: about $87/mo.** Hetzner `cpx31` in Ashburn $73.49 (its
      list price there; the same type is $20.49 in Nuremberg), plus Neon Launch about $13.70
      (November's metered $11.88 over 26 days: 111.76 CU-hours $11.85, storage $0.03), plus Vercel
      $0. **After: €16.11/mo.** Netcup VPS 1000 G12 at Mitchell's checkout; R2 $0 (the backup
      bucket holds 6.96 MB per night, about 100 MB at 14 kept, inside R2's free 10 GB); Neon Free
      $0; Vercel free tier $0. Saved: roughly $70 a month. One-off: Neon's November $11.88 and
      Hetzner's hours up to its deletion.)*
- [x] **[walk]** On production after cutover: sign in with Google, open a trip, ask the
      assistant, watch a cron fire, see the pageview in Umami.
      *(2026-11-26: Mitchell, "Walk passed". It found the assistant simulated: `FLAG_AI_LIVE` had
      never been set since M59 made flags env variables (the Hetzner app had it unset too, so
      `ai_usage` was silent from early November). Set to `true` on the box at 22:16Z, then
      `/api/health/ai-mode` read `"live":true`. `discover-rank` executed by hand at 22:07Z:
      `200 {"ok":true,"cleared":true}`. Umami pageviews as above.)*
- [x] A retro is appended at gate close. (2026-11-27, below)

## What the cutover found

*Moved here from the plan at the close (2026-11-27), for the next move of the box.*

The runbook held (2026-11-26); these are the corrections, for the
next move:

- **Blockers it did not list.** (a) `caesura-web` had to be a *Docker image* application before
  the merge: `coolify-deploy.mjs` retags `docker_registry_image_tag`, which a Dockerfile/GitHub
  application ignores. It was recreated and its env copied by name. (b) `COOLIFY_URL` is written
  into `deploy-production.yml` and `coolify-preview.yml`, so `coolify.` had to move to the new box
  (and its instance domain be set) *before* step 4, not at step 5, together with
  `COOLIFY_API_TOKEN` and `COOLIFY_APP_UUID`. From then until the merge, any other push to `main`
  would fail its deploy, so merges were held. (c) The `PRODUCTION_*` and `PREVIEW_*` Actions
  variables, `COOLIFY_PREVIEW_APP_UUID` and `PREVIEW_DATABASE_URL` had to exist first;
  `PRODUCTION_PUBLIC_ORIGIN` is required by the build.
- **The apex and `www` are proxied** (orange), with SSL Full (strict) and Always Use HTTPS, not
  grey as step 5 says. Their TTL is moot. Let's Encrypt tried at deploy time, while DNS still
  named the old box, and failed; after the flip it does not retry by itself. What worked: SSL to
  Full for the flip, `docker restart coolify-proxy` (both certificates within 15 s; the HTTP-01
  challenge passes through Cloudflare unredirected), then SSL back to strict.
- **`PRODUCTION_DATABASE_URL` was re-pointed after step 3 and before the merge.** The *Tunnel*
  order in `coolify-vps.md` (secrets, merge, re-point) would have let step 4's migrate step check
  Neon instead of the box.
- **`/api/health`'s `version` reads `HEAD`** on image applications: Coolify sets `SOURCE_COMMIT`
  at runtime. Step 4's check used the container's image tag instead.
- **Timings:** maintenance on (restart) 174 s; Neon read-only and box apps stopped under a minute;
  dump 13 s, restore 1 s, compare 6 s; merge to deployed about 5 minutes; site down about 16
  minutes in all.

## Retro — written 2026-11-27 (14 of 14 boxes ticked, one amended out)

### What went well

- **The cutover took about 16 minutes of downtime and lost nothing.** Neon was made read-only at
  21:50:52Z, the final dump took 13 s and the restore 1 s, and the compare script said "The two
  databases match" at 21:52:31Z, before DNS flipped at 22:06Z (gate box 6). About 8 of the 16
  minutes were waiting on PR 799's merge and image build.
- **The rehearsal took the risk out of the evening.** The O6 rehearsal ran the same dump, restore
  and compare against Neon's production data, and found that `--role=caesura` left every object
  owned correctly, so the ownership fallback was dropped before the cutover (commit `e405e5f4`).
- **Making the database read-only replaced 150 handler wrappers.** PR 795's review found no shared
  seam over `/api`; Mitchell's D9 amendment stopped writes with
  `default_transaction_read_only = on` instead, and a test `UPDATE` was refused on both Neon
  endpoints at cutover.
- **The bill dropped by about $70 a month**, from about $87 (Hetzner $73.49, Neon about $13.70) to
  €16.11 (gate box 13). R2 holds the backups inside its free tier.
- **No build runs on the box any more.** `deploy-production` run 45901870874 built the image in
  Actions and Coolify only pulled it, which removes the ~4 GB `next build` spike behind
  KI-2026-11-14-d; the box ran at 2123 MB used after cutover.
- **Production's walk found a month-old silent fault.** `FLAG_AI_LIVE` had been unset since M59
  made flags env variables, so the assistant ran simulated and `ai_usage` was empty from early
  November. It was set at 22:16Z and `/api/health/ai-mode` read `"live":true`.

### What could be better

- **Stack B merged early, and had to be reverted.** Parts 2–4 (PRs 796–798) merged to `main`
  before the box existed, so `deploy-production` failed at the SSH tunnel step; PR 801 reverted
  them and the cutover reverted the revert (commit `9b65b733`). The plan said stack B merges at
  cutover, but nothing enforced it. The change that would have prevented it: keep stack B's PRs as
  drafts, or labelled do-not-merge, until O8.
- **The runbook missed four blockers** (*What the cutover found*, above): the Docker-image
  application, `COOLIFY_URL` having to move before the merge, the Actions variables that had to
  exist first, and re-pointing `PRODUCTION_DATABASE_URL` before the merge. Each was found live on
  the evening, and merges to `main` were held while `coolify.` pointed at the new box. A dry run of
  `deploy-production` against the new Coolify during the rehearsal would have caught the first
  three.
- **`/api/health`'s `version` read `HEAD` on image applications**, so `preview-link-check` could
  never pass and the previews box could not be ticked. PR 803 fixed it the next day, but its own
  preview run still failed, and the box was amended rather than proven.
- **Coolify's ports 6001/6002 were public** because Docker-published ports skip `ufw`. They were
  closed after cutover by a `DOCKER-USER` drop; the O4 check only tested 5432.
- **Spend was mostly the orchestrators.** 78% of the measured units (below), against a target
  under 15%. The Netcup setup and the cutover were run inline by two sessions with no subagents,
  because each step needed Mitchell's console or approval. That is the nature of ops work, but
  the two sessions peaked at 353k and 366k context.

### Leftovers

- **A preview after PR 803 is unproven.** Label a PR `preview` and read its `preview-link-check`;
  PR 803's run 45909916097 ended "last: no answer", and `preview.caesura.today` answered a
  not-found page on 2026-11-27. Mitchell's call (he skipped it at the close).
- **Deleting the Neon project** after two weeks with no rollback (from 2026-12-10): D13's
  follow-up, on Mitchell's OK.
- **Umami saw no pageviews from Mitchell's laptop browser** (likely a blocker); his phone's views
  counted. Not tracked; Mitchell's call.
- **The state digest reports `0079_mfa` as not applied in production.** It was: run 44934907812
  applied it on 2026-11-21, and the cutover's run 45901870874 read "80/80 migrations applied". The
  digest's journal check still reads from before the cutover. Not tracked.
- **PR 794's `ci-monitor-event` turn is unclassified** in `session-metrics` (`TURN_CLASSES` has no
  row for it; see session 1 in the spend).

## Spend

Five sessions worked this milestone, and all five were measured. **The builders of parts 3–5 left
no transcripts on this laptop** (session 1 dispatched part 1 and 2's builders and reviewers only),
so every total here is a floor. **No session recorded dollars or cost by model, so none is given
and `$ per 1,000 lines` is not measurable.** Lines added: 1,744 (`git diff --numstat
b3184b82^1 216b4960`, without `docs/`, generated JSON and the lockfile; 449 deleted).

| Session | What it did | Agents | Calls | Units | Orchestrator |
|---|---|---|---|---|---|
| 1 | plan, parts 1–2, M59's close | 8 | 309 | 7.02M | 2.64M (37.6%, peak 294k) |
| 2 | Netcup box setup (O2, O4–O6) | 1 | 222 | 5.97M | 5.97M (100%, peak 353k) |
| 3 | cutover (O7–O9) | 1 | 203 | 5.82M | 5.82M (100%, peak 366k) |
| 4 | PR 803, the `version` fix | 1 | 29 | 721k | 721k (100%, peak 168k) |
| 5 | this close | 1 | 34 | 753k | 753k (100%, peak 204k) |
| All | | 12 | 797 | 20.28M | 15.90M (78.4%) |

Session 1's agents: orchestrator 2.64M, `phase-implementer` 1.48M (3 agents, peak 102k),
`part-reviewer` 1.44M (2, peak 115k), `general-purpose` 861k (M59's close), `Explore` 591k.

**Session 5 (this close, generated):**

<!-- session-metrics:milestone v1 -->

1 agents, 34 API calls, 753k units. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `orchestrator` | 1 | 34 | 168k | 204k | 753k | 100.0% |

**Costliest agents**

No subagent transcripts found.

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | Share of orchestrator | Idle |
|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 0 | 0 | 0.0% | – |
| Subagent finished | 0 | 0 | 0.0% | – |
| Harness | 0 | 0 | 0.0% | – |
| Human | 4 | 753k | 100.0% | – |
| Other (unrecognised frame) | 0 | 0 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 6 | 0 |
| `orchestrator-context-limit` | 0 | 69 |
| `reviewer-report-check` | 1 | 0 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 100.0% |
| No phase-implementer averaging > 250k context | not measurable | no phase-implementer transcripts |
| GitHub wakes per merged part < 5 | met | 0 / 5 = 0.0 |
| Dollars per 1k lines added < 20 | not measurable | needs --cost-usd and --lines-added |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

- **Orchestrator share under 15%: missed.** 78.4% over all five sessions (M60: 52.2%). Sessions 2
  and 3 were ops run inline with Mitchell at the console, with no subagents; session 1, the one
  that built, was 37.6%.
- **Builder context under 250k: met** where measured (part 1's fixer averaged 80k, peak 102k).
  Parts 3–5's builders were not measured.
- **Dollars per 1,000 lines: not measurable.** No session recorded dollars (M60: not measurable
  either). In units, M64 spent 11.6M per 1,000 lines against M60's 1.29M; M64 was mostly
  operations, not code.
- **GitHub wakes per merged part under 5: met** (0 in every session).
- **Cache re-writes after a coordinator message: met** (0).
