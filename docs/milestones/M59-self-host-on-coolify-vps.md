# M59 - Self-host Caesura on a Coolify VPS

**Status:** **Closed 2026-11-24, folded into M64** (gate 9 of 9 ticked, two boxes amended out to
M64; see *Exit gate* and the retro). Mitchell, 2026-11-24, "Fold M59 into M64"
(`docs/milestones/M64-one-cheap-box-own-postgres.md`, decision 11): the Vercel pause and PR
previews are carried by M64's gate, not left open here. *(Was: production cut over 2026-11-09;
gate held open by Mitchell's 2026-11-09 call to keep M59 open until Coolify PR previews worked
and the Vercel project was paused, rather than closing with those deferred.)* Scoped 2026-11-08
with Mitchell, placed ahead of M53 (D11).
Decisions D1–D9 are answered below. Plan: `docs/plans/2026-11-06-M59-self-host-on-coolify-vps.md`, deleted at the close
(retrieve it from git).
Part 0 is `claude/next-milestone-setup-3ccab6`, which supersedes the proposal PR 695.

## Why this exists

Caesura runs on Vercel Pro and Neon, paid, after hitting a usage cap. The Oct 25
cheap-operations verdict (draft PR #586, `docs/ops/cheap-operations.md`) priced
the options: Cloudflare Workers + Neon about $11-22/mo at medium effort,
stay-and-tune on Vercel+Neon about $26-40/mo with the Vercel portion unverified,
and a VPS the cheapest flat-price route. Mitchell, 2026-10-25: leaning toward
the VPS route, "Vercel is getting really expensive", not that night. This
milestone is that lean, picked back up on his ask, following one guide end to
end: Saqib Shah, Medium, Feb 2026, "Stop Paying the Vercel Tax: Self-Host
Next.js with Coolify & VPS". Coolify gives the Vercel experience (git push to
deploy, preview URLs, SSL) on a VPS the owner runs.

Two things the guide does not do for us, and the plan has to: the guide's
numbers are the guide's, not verified against our bill, and the guide prices
bandwidth and seats, not function duration. Our bill drivers are app-specific
(the 2s board poll, 300s AI/cron durations, per-hit quota writes), and our
current Vercel Pro + Neon spend is unverified anywhere in the repo. The plan
asks Mitchell for the actual monthly bill as the baseline input instead of
asserting a saving.

## Decisions

**Answered 2026-11-08 by Mitchell** (D7 and the DNS host were not asked; they are the
recommended defaults and he can overturn them before Part 3):

1. **VPS provider: Hetzner.** Mitchell creates the account and pays. An API token,
   if he gives one, lets the agent create and resize the server itself.
2. **Box size: 8GB.** Mitchell's pick over the recommended 16GB box. Production, Coolify
   previews, Redis and Plausible share one box, so a preview build can run out of memory.
   Coolify's concurrent-build limit is set to 1, and a resize is the answer if it happens.
   It is not a reason to drop previews.
3. **Database: keep Neon.** Data, backups and branches stay put. Each Coolify preview gets
   a disposable Neon branch, and Preview and Production `DATABASE_URL` are never the same value.
   Self-hosted Postgres is a later, separate milestone.
4. **Redis: self-host in Coolify.** Upstash goes away. If `server/cache/redis.ts` speaks only
   the Upstash REST protocol, the Redis service sits behind an Upstash-compatible REST proxy
   (serverless-redis-http) on the box, so the client code does not change. Part 1 confirms this.
5. **Analytics: self-hosted Plausible** in Coolify. `@vercel/analytics` and
   `@vercel/speed-insights` come out, and a Plausible script, set by env and absent when the
   env is unset, goes in. Speed Insights is not replaced.
6. **Flags: env vars only.** The `@flags-sdk/vercel` adapter and the Toolbar's per-reviewer
   Flags Explorer flip go away. A flag's value is an env var per deployment, and
   `defaultValue: false` stays the fail-closed fallback. To test `ai-live` on a preview, set the
   env var on that preview.
7. **Previews: Coolify per-PR previews** (wildcard subdomain on the box). The part-reviewer and
   the phase-verifier walk a Coolify preview URL instead of a Vercel one.
8. **Cron: Coolify scheduled tasks** hitting both cron routes with `CRON_SECRET`. Never an
   in-app timer.
9. **Cutover: hard cutover.** Production's DNS flips to the VPS once the VPS deployment has
   passed the walk on its own subdomain. There is no dual-run soak. The Vercel project is
   downgraded or paused, never deleted, so rollback stays possible (DNS back plus
   un-pause), only slower.
10. **DNS: stays on Vercel DNS** (`caesura.today`'s nameservers are `ns1/ns2.vercel-dns.com`,
    checked 2026-11-08), which is free on any plan. No Cloudflare in this milestone. HSTS is served by the
    app (`next.config.ts`), because nothing in front of it adds it.
    **Overturned 2026-11-09 by events:** Vercel blocked the account for fair use, and Vercel DNS
    writes failed with it. DNS moved to a Cloudflare zone (nameservers set in Vercel's domain
    dashboard, since the domain is a Vercel-resold registration). Every record is DNS-only (grey
    cloud), so Cloudflare proxies nothing and HSTS is still the app's.
11. **Placement: M59 now, ahead of M53**, which follows it.

## Scope

- Decoupling the app from Vercel runtime APIs: the origin/env module, the
  `@vercel/functions` and `@flags-sdk/vercel` replacements, analytics, the
  standalone output and Dockerfile, HSTS.
- Provisioning the Hetzner box and Coolify, DNS records (Vercel DNS) and SSL, the deploy
  pipeline, per-PR Coolify previews, self-hosted Redis and Plausible.
- Cron, migrations and backups on the new host, and the staging/preview
  database story.
- Cutover: hard DNS flip, rollback runbook, and pausing (not deleting) Vercel.

## Out of scope

- Moving Postgres off Neon (decision 3 keeps it; a later milestone).
- Deleting the Vercel project. It is paused or downgraded after the cutover, as the
  rollback target, and is never deleted in this milestone.
- Changing what the app does. No behavior change is in scope; the app that
  runs on the VPS is the app that runs on Vercel.
- The Cloudflare Workers route from the Oct 25 verdict. It stays the
  comparison point, not work in this milestone.

## Exit gate

Evidence read 2026-11-09 by the close session. CI: the top part, PR 707, at head `a50b6d7d`,
every check green (lint, typecheck, unit, scripts, integration, e2e 1/2 and 2/2, `ci-ok`, CodeQL);
the only red is the commit status "Vercel", which is the account block, not the code.

- [x] **Decisions D1–D9 are answered and recorded here.** (2026-11-08; D10 overturned 2026-11-09, see above)
- [ ] ~~**Production serves from the VPS** (hard cutover, D9), and the Vercel project
      is paused or downgraded, not deleted.~~
      **Amended out of the gate at the close, 2026-11-24, by Mitchell's decision "Fold M59 into
      M64"; half met, half moved.** *Met:* production serves from the box.
      `https://caesura.today/api/health` answered `{"ok":true,"version":"5504d935…"}` (main's
      head) from it on 2026-11-09, with a Let's Encrypt (YR2) certificate issued that day.
      *Not met, moved:* the Vercel project was never paused. That is now part of M64's gate box
      **"Neon is out, and the old hosts are wound down"** (the Vercel project paused, not deleted).
- [ ] ~~**Coolify previews work for PRs**, each on its own disposable Neon branch, and the
      part-reviewer's and phase-verifier's walk instructions point at them.~~
      **Amended out of the gate at the close, 2026-11-24, by Mitchell's decision "Fold M59 into
      M64"; moved, not passed.** *What exists:* the walk instructions point at
      `https://<pr>.preview.caesura.today` (`.claude/agents/phase-verifier.md:60`,
      `.claude/skills/review-a-part/SKILL.md:38`). Coolify previews were switched on 2026-11-10;
      on 2026-11-14 fifteen of them ran the 8 GB box out of memory and took production down
      (KI-20261114-d), so since then a PR gets a preview only on demand, through the `preview`
      label, one at a time, on one shared preview Neon branch, not a disposable branch per PR
      (`docs/ops/coolify-vps.md`, *Previews*). M63's words were approved on the PR 788 preview
      that way. *Moved:* M64's gate box **"PR previews work"**, where a labelled PR's image runs
      as `caesura-preview` on the new box against the box's shared preview database
      (`caesura_preview`), never a Neon branch and never production's database.
- [x] **Redis and Plausible run on the box**, and the app uses both (a cache hit is
      observable; a pageview shows in Plausible).
      `caesura-redis` and `caesura-redis-http` run as Coolify services with `KV_REST_API_URL`/`TOKEN`
      set on `caesura-web`; Plausible is the compose service at `plausible.caesura.today`, and
      Mitchell confirmed 2026-11-09 that caesura.today pageviews arrive. A cache hit was not
      observed separately.
- [x] **Both crons fire on the new host** (embed-days and tier-rollup, with
      `CRON_SECRET`), and a missed run is visible the way a missed Vercel
      cron run was.
      Coolify scheduled tasks on `caesura-web`, read through
      `GET /applications/<uuid>/scheduled-tasks/<uuid>/executions`: embed-days ran
      2026-11-09T04:00:06Z, `success`, `200 {"claimed":0,…,"pending":17}`; tier-rollup ran
      04:30:02Z, `success`, `200 {"weekStart":"2026-11-09",…}`. A 200 means `CRON_SECRET` was
      accepted (`server/cronAuth.ts`). A missed or failed run shows as a missing or failed row in
      that execution log, as Vercel's cron log did.
- [x] **Migrations dispatch on the new host** with the disposable-branch gate
      intact, and a preview build cannot migrate production.
      `migrate-production` run 42561546021 at `7b390a21` succeeded (0070 to 0074 applied).
      Production's build never migrates and a preview build needs `APP_ENV=preview` and
      `PREVIEW_DB_IS_DISPOSABLE=true` (`apps/web/scripts/lib/build-steps.mjs`, tested by
      `build-migrate.test.ts`, green in CI at `a50b6d7d`).
- [x] **No `@vercel/` or `@flags-sdk/vercel` import remains** in `apps/web/src`
      (grep), and HSTS is served.
      `git grep -nE "@vercel/|@flags-sdk/vercel" 5504d935 -- apps/web/src` prints nothing;
      `curl -sI https://caesura.today` carries `strict-transport-security: max-age=63072000`.
- [x] **Flags work without the Vercel adapter**, from env vars per deployment (D6).
      `apps/web/src/server/flags.ts:25,35`: `ai-live` reads `FLAG_AI_LIVE === "true"`, covered
      by `server/flags.test.ts`, green in CI at `a50b6d7d`.
- [x] **Rollback is exercised or documented** (DNS back to Vercel), and the
      Vercel project is retained, not deleted.
      Documented in `docs/ops/coolify-vps.md`, *Rollback*, for Cloudflare DNS. The project is
      retained. While the Vercel account is blocked, a rollback to Vercel cannot serve; the
      runbook says so.
- [x] **[walk]** On the VPS deployment, the app behaves as on Vercel: sign in
      with Google, open a trip, and watch a cron fire.
      Mitchell walked `staging.caesura.today` (the same box and application) on part 5 and said
      "walk passed"; both crons fired on production the same night (above).
- [x] A retro is appended at gate close (2026-11-24, below).

**Deferred with Mitchell's OK (2026-11-09), not gate boxes:** plan retrieval stays paused until
there is an OpenAI key (`KI-20261109-a`), and three leftover env vars on `caesura-web` are to be
deleted (`KI-20261109-b`).

**Gate status, 2026-11-24 (closed, folded into M64).** 9 of 9 boxes ticked, with two more amended
out at the close and carried by M64's gate by Mitchell's decision of 2026-11-24 ("Fold M59 into
M64", M64 decision 11): the Vercel pause (M64, *Neon is out, and the old hosts are wound down*) and
PR previews (M64, *PR previews work*). The eight boxes ticked on 2026-11-09 rest on CI at PR 707's
head `a50b6d7d` and on the production reads recorded under each.

## Retro — written 2026-11-24 (9 of 9 boxes ticked, 2 amended out to M64)

### What went well

- **Production came back on a box the project runs, in about a day.** Vercel blocked the account
  on 2026-11-08 and `caesura.today` went down; on 2026-11-09 it served from Hetzner `caesura-1`
  through Coolify (`/api/health` version `5504d935`, Let's Encrypt certificate issued that day).
- **All five code parts landed in two merges, green.** PR 702 (`7b390a21`) and PR 707
  (`6f07974d`, carrying PRs 703, 704 and 706); every check green at `a50b6d7d`. Two follow-ups
  fixed what the cutover found: PR 710 (`f6ebde2e`, the `/playbooks` rewrite loop and canonical
  URLs) and PR 711 (`0261b50b`, robots.txt's origin). The app has no `@vercel/` or
  `@flags-sdk/vercel` import left in `apps/web/src`.
- **Migrations, crons and the walk were checked on the new host the same night.**
  `migrate-production` run 42561546021 applied `0070` to `0074`; both Coolify scheduled tasks
  returned 200 at 04:00 and 04:30Z on 2026-11-09; Mitchell walked `staging.caesura.today` and said
  "walk passed".

### What could be better

- **The 8 GB box could not hold per-PR previews.** D2 picked 8 GB over the recommended 16 GB, and
  part 5 (`8f0517d`) switched Coolify's automatic previews on. On 2026-11-14 fifteen KI-sweep PRs
  each got a running preview, the box ran out of memory, and production was down for over an hour
  (KI-20261114-d). Previews became label-only, one at a time (PRs 750, 756, 759). What would have
  prevented it: pricing a preview in memory, not money, before switching them on. M64 measures
  memory headroom with one preview running as a gate box.
- **Two ops boxes held the gate open for fifteen days.** The Vercel pause and previews were
  operator work, not code, and nothing moved them between 2026-11-09 and 2026-11-24 while M60 to
  M63 closed ahead of M59 in the meantime. A gate box that waits on an operator step needs a
  date or an owner in *Next action*, or it should be split out at the close.
- **D10 (DNS on Vercel) was overturned by events.** Vercel DNS writes failed with the account
  block, and DNS moved to a Cloudflare zone mid-cutover. Keeping DNS on the host being left was
  a single point of failure for the move itself.
- **Some production config lives only in Coolify.** The Traefik labels that strip
  `x-middleware-rewrite` were hand-edited (`f5da4453` records them), and the schedules are set in
  Coolify, not in the repo. M64's move to a new box has to carry them by hand.
- **The orchestrator carried most of the spend**: 56.6% of units across the four sessions, against
  a target under 15%. Cause: the cutover was done live, in the orchestrator's own context, with
  Mitchell (22 human turns in the build session alone), rather than through briefs.
- **The saving was never measured.** The plan asked for the Vercel and Neon bill as the baseline;
  the box costs 73.49/mo in Ashburn (M64, *Why this exists*), and no before-and-after was
  recorded. M64 decision 14 makes the bill a gate box.

### Leftovers

- **Pause the Vercel project, never delete it**: M64 gate box *Neon is out, and the old hosts are
  wound down*.
- **PR previews**: M64 gate box *PR previews work*, on the box's preview database.
- **Plan retrieval paused without an OpenAI key**: KI-20261109-a (open).
- **Three leftover env vars on `caesura-web`**: KI-20261109-b (open).
- **`serverless-redis-http` runs an unpatched Alpine**: KI-20261110-b (open).
- **preview-link-check passes when no preview answers**: KI-20261110 (open).
- **Every PR preview ran the box out of memory**: KI-20261114-d (open; previews are label-only).
- **Stale Vercel mentions**: KI-20261108, resolved (PR 744).
- **The move from Hetzner Ashburn to OVHcloud** (`docs/plans/2026-11-09-move-vps-to-ovhcloud.md`,
  never started) is replaced by M64.

## Spend
<!-- session-metrics:milestone v1 -->

12 agents, 491 API calls, 9.68M units. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `orchestrator` | 1 | 203 | 255k | 358k | 6.47M | 66.8% |
| `phase-implementer` | 6 | 213 | 73k | 122k | 2.20M | 22.7% |
| `part-reviewer` | 4 | 69 | 68k | 142k | 868k | 9.0% |
| `Explore` | 1 | 6 | 80k | 88k | 149k | 1.5% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units |
|---|---|---|---|---|---|
| Fix playbooks rewrite loop | `phase-implementer` | 57 | 73k | 114k | 550k |
| Build M59 part 2 | `phase-implementer` | 34 | 92k | 122k | 446k |
| Review M59 part 2 | `part-reviewer` | 24 | 96k | 142k | 393k |
| Fix M59 parts 1 and 2 | `phase-implementer` | 36 | 72k | 105k | 372k |
| Build M59 part 3 | `phase-implementer` | 30 | 67k | 88k | 293k |
| Fix M59 parts 2 and 3 | `phase-implementer` | 32 | 61k | 81k | 281k |
| Build M59 part 1 deploy-env | `phase-implementer` | 24 | 67k | 80k | 252k |
| Re-review M59 part 2 | `part-reviewer` | 21 | 60k | 91k | 230k |
| Review M59 part 3 | `part-reviewer` | 15 | 51k | 65k | 151k |
| Survey Vercel couplings for M59 | `Explore` | 6 | 80k | 88k | 149k |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | Share of orchestrator | Idle |
|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 10 | 1.02M | 15.8% | – |
| Subagent finished | 4 | 98k | 1.5% | – |
| Harness | 0 | 0 | 0.0% | – |
| Human | 22 | 3.30M | 51.0% | – |
| Other (unrecognised frame) | 42 | 2.05M | 31.6% | – |

Unrecognised frames, by opening tag: `<ci-monitor-event>` × 27, `<bash-input>` × 3, `<side-sessions-event>` × 11, `(empty)` × 1. Add a row to `TURN_CLASSES`.

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 5 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 5 | 0 |
| `orchestrator-context-limit` | 0 | 60 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 66.8% |
| No phase-implementer averaging > 250k context | met | worst 92k |
| GitHub wakes per merged part < 5 | met | 0 / 5 = 0.0 |
| Dollars per 1k lines added < 20 | not measurable | needs --cost-usd and --lines-added |
| Coordinator-message re-writes <= 2 | met | 0 |

This block is the build session only (`685da065`, "M59 — self-host Caesura on a Coolify VPS",
2026-11-08 to 11-09), generated at this close from its transcript, which is still on Mitchell's
laptop. Three more sessions worked on M59, also measured at this close from their transcripts:

| Session | Agents | Calls | Units | Orchestrator share |
|---|---|---|---|---|
| `685da065`, build (the block above) | 12 | 491 | 9.68M | 66.8% |
| `5deefd3f`, "rushed VPS move, continued" | 14 | 352 | 5.38M | 56.6% |
| `aa214740`, "continued (staging up, cutover)" | 11 | 323 | 6.22M | 68.9% |
| `4cf9bcba`, gate evidence and part 0 (2026-11-09) | 1 | 49 | 1.13M | 100.0% |
| **Total** | **38** | **1,215** | **26.41M** | **56.6%** |

A fifth transcript, `b6bc30b8` ("Side chat"), is a copy of the first 44 calls of `5deefd3f` and
is left out. No dollar figure was recorded for any session, so `$ per 1,000 lines` is not
measurable. Lines added: 1,483 (PRs 702, 707, 710 and 711, without `docs/`, `*.generated.json`
and `pnpm-lock.yaml`), in 5 parts. This close session (2026-11-24) is not included.

### Spend against the last milestone

The last milestone closed is M63 (2026-11-22).

- Orchestrator's share of the spend: target under 15%, **missed** at 56.6% over the four sessions
  (M63: 44.5% and 37%, missed). Cause: the cutover under an outage, run live in the orchestrator.
- Dollars per 1,000 lines added: target under 20, **not measurable** (no cost recorded; M63 $3.65).
- A builder's average context: target none over 250k, **met** (worst 92k; M63 worst 89k).
- GitHub wakes per merged part: **met**, 0 of 5. Coordinator-message re-writes: **met**, 0.
