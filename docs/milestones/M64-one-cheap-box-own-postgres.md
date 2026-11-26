# M64 — Caesura runs on one cheap box, with its own Postgres

**Status (2026-11-26): cut over.** Production has served from the Netcup box on its own Postgres
since 2026-11-26 22:06Z (PR 799 merged as `fb30cf02`). Hetzner is deleted and Neon is on its free
plan. Open: the code boxes' red-then-green evidence, the Vercel box (see the gate), the bills, and
the retro. The cutover's evidence log is on Mitchell's laptop (`~/caesura-m64-box/log.md`); what
the gate needs from it is quoted below. **Scoped 2026-11-24.** Minted, scoped and placed by Mitchell on 2026-11-24, with every
decision answered the same day (see *Decisions*). Plan:
`docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`. Part 0 is
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
- [ ] **Maintenance mode behaves as D9 sketches**: tests seen red then green, and switched on
      and off once on the new box before cutover.
      *(Box half 2026-11-26, O6: on, `/` and `/trips/…` answered 503 with `Retry-After: 600` and
      `X-Robots-Tag: noindex` and the notice with no links, `/.well-known/…` answered
      `503 {"error":"maintenance"}`, `/api/v1/trips` 401 (outside, per D9's amendment),
      `/api/health` `"maintenance":true`; off, everything back. An env change takes effect on a
      Coolify restart, about 50 s. Used for real on the old box at cutover. Open: the red-then-green
      test evidence from part 1.)*
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
- [ ] **PR previews work** (from M59): a labelled PR gets its image deployed to
      `caesura-preview` on the box, using `caesura_preview` and never production's database, and
      the part-reviewer's, phase-verifier's and close-a-milestone's walk instructions point at it.
      *(2026-11-26: PR 799 labelled `preview`, run 45899608400: image `pr-799-db94a69d…` deployed
      to `caesura-preview`, healthy at `https://preview.caesura.today`; its `DATABASE_URL` names
      the `caesura_preview` role and database. `phase-verifier.md`, `review-a-part` and
      `close-a-milestone` name that URL. Not ticked: `preview-link-check` waits for `version` to
      equal the sha and so times out (the `HEAD` finding above).)*
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
- [ ] **Neon is out, and the old hosts are wound down.** No code, script or workflow names Neon
      (historical docs aside). The Neon project is suspended or on its free plan, not deleted.
      Hetzner `caesura-1` is deleted. The Vercel project is paused, not deleted (from M59).
      *(2026-11-26: Hetzner `caesura-1` with its two primary IPs and firewall deleted at 22:25Z;
      `hcloud` lists nothing. Neon org moved Launch to Free at 22:42Z, the project and data kept
      (`production` still read-only). Neon's code removal is part 5. **Open:** the Vercel project is
      on Vercel's free tier, not paused; Mitchell says that costs nothing. Ticking this needs his
      call on amending the box or pausing it.)*
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
- [ ] A retro is appended at gate close.
