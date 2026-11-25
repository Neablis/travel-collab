# M64 — Caesura runs on one cheap box, with its own Postgres

**Status (2026-11-24): scoped.** Minted, scoped and placed by Mitchell on 2026-11-24, with every
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
2. **Box: OVHcloud VPS-2**, 4 vCore, 8 GB, 75 GB NVMe, unlimited traffic, about **$8.50–10/mo**.
   The price comes from third-party trackers (vpsbenchmarks, Valebyte, devvpscompare, Oct–Nov
   2026), so **read the checkout total before paying**. Mitchell picked it over the recommended
   VPS-1 (4 GB, ~$5), and over Contabo's 8 GB plan (~$6–7, oversold CPU and weak support, on
   the box that will now hold the database). Hetzner EU's CX33 (€8.49–9.99) was ruled out. It is
   no cheaper, it adds ~100 ms per page for US users, and new Hetzner orders were restricted in
   2026. OVHcloud upgrades a VPS in place but never downgrades one.
3. **Region: US east, Vint Hill, VA.** Neon no longer decides the region. US east is closer to
   most US users and to Europe, at the same price as Hillsboro.
4. **Analytics: Umami replaces Plausible.** Umami runs as a Coolify service with its own database
   and its own role (`umami`) in the box's Postgres. `NEXT_PUBLIC_UMAMI_SRC` and
   `NEXT_PUBLIC_UMAMI_WEBSITE_ID` replace the two Plausible variables in `app/layout.tsx:111`.
   The script stays env-gated and absent when the variables are unset, and the CSP in
   `next.config.ts` names Umami's origin instead of Plausible's. Pageviews only: the app sends
   no custom events today. **History:** Plausible's data starts 2026-11-09, and Umami cannot
   import it. A CSV export from Plausible goes into the backup bucket before Plausible is
   switched off. That loses about two weeks of charts.
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
    `server/public-api/discovery.test.ts:247`). `OVHcloud`, `Umami` and `Plausible` are added
    to those barred lists. No page copy changes. Mitchell picked this over naming OVHcloud.
11. **M59 is folded in.** M59 closes now (2026-11-24). Its three open boxes are amended there and
    carried here: *Vercel paused* is part of gate box 12, *Coolify previews* is gate box 9
    (amended from "a disposable Neon branch" to "the box's preview database"), and M59's retro
    is written at its close. Mitchell picked this over keeping M59 open.
12. **Placement: M64 is current** once M59 closes, ahead of M53.
13. **Rollback.** Until the first write lands on the new box, rollback is to point DNS back at
    the old box and turn maintenance off there. Neon and the Hetzner box are untouched until
    then. After the first write, rolling back means copying those writes to Neon, which is why
    the window is short and walked straight away. The Hetzner box is deleted after a day with no
    rollback. **Neon is suspended (or dropped to its free plan), not deleted**, for two weeks
    after cutover; deleting it is a follow-up on Mitchell's OK, not a gate box.
14. **Cost is measured, not asserted.** The gate records the monthly bill before (Hetzner 73.49
    plus Neon's last invoice) and after (the OVHcloud invoice plus R2).

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
- Moving DNS away from Cloudflare (M59 D10's overturn stands: grey cloud, DNS only).

## Exit gate

- [x] **Decisions D1–D14 are answered and recorded here.** (2026-11-24)
- [ ] **The new box runs Coolify, Postgres 17 with pgvector, Redis and Umami** (OVHcloud VPS-2,
      Vint Hill), and **Postgres is unreachable from the internet**: a connection to port 5432 on
      the box's public address from outside it fails.
- [ ] **A nightly backup reached R2, and a restore drill from it** into a scratch database
      matched the source on the compare script (every table's row count, the migration journal,
      the `vector` extension and the HNSW index).
- [ ] **Maintenance mode behaves as D9 sketches**: tests seen red then green, and switched on
      and off once on the new box before cutover.
- [ ] **The rehearsal is done**: Neon's production dump restored on the new box, the compare
      script equal, the dump-to-restore time recorded, and `staging.` walked on the new box
      (Google sign-in, open a trip, ask the assistant, a pageview in Umami).
- [ ] **Production serves from the new box on its own Postgres.** `caesura.today/api/health`
      answers from it, and the compare script was equal between Neon's final dump and the box at
      cutover.
- [ ] **Images are built in GitHub Actions and pulled from GHCR**: the deploy log of a push to
      `main` shows a pull, not a build, and no `next build` runs on the box.
- [ ] **Every workflow that reaches production's database goes through the SSH tunnel**, a push
      to `main` migrates and then deploys (ADR-091's order), and `PRODUCTION_DATABASE_URL` names
      `127.0.0.1`.
- [ ] **PR previews work** (from M59): a labelled PR gets its image deployed to
      `caesura-preview` on the box, using `caesura_preview` and never production's database, and
      the part-reviewer's, phase-verifier's and close-a-milestone's walk instructions point at it.
- [ ] **Umami counts `caesura.today` pageviews, and Plausible is gone.** The CSP names Umami
      only, and `OVHcloud`, `Umami` and `Plausible` are barred on `/ai`, `/security` and in API
      discovery.
- [ ] **Memory headroom is measured** on the new box with production and one preview running
      (`free -m` and `docker stats`, recorded here), and is not swapping.
- [ ] **Neon is out, and the old hosts are wound down.** No code, script or workflow names Neon
      (historical docs aside). The Neon project is suspended or on its free plan, not deleted.
      Hetzner `caesura-1` is deleted. The Vercel project is paused, not deleted (from M59).
- [ ] **The monthly bill, before and after, is recorded here** (D14).
- [ ] **[walk]** On production after cutover: sign in with Google, open a trip, ask the
      assistant, watch a cron fire, see the pageview in Umami.
- [ ] A retro is appended at gate close.
