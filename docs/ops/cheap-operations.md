# Running Caesura as cheaply as possible

Status: draft for Mitchell's review. No Vercel or Neon dashboard was accessed
while writing this (no account logins, no bill figures seen), so every number
below is either **verified** on an official pricing page fetched 2026-10-25,
an **estimate** with its assumptions stated, or explicitly marked
**unverified** where the official page did not render. Nothing here is a
measured bill. See §2 for the three numbers only Mitchell can supply from his
dashboards — they decide between several options below.

Scope: the production app as deployed today — Next.js all-in-one on Vercel,
Neon Postgres via Drizzle, pnpm monorepo — at its current scale: a small
invite-only site. All monthly estimates assume roughly 30k page views/month,
under 1M requests/month, under ~10 GB transfer/month, a 1–2 GB database, one
region, one developer seat. Those are assumptions, not measurements; if real
traffic is an order of magnitude larger, the usage-sensitive options change
and the fixed-minimum options do not.

The one-line summary: at this scale the bill is dominated by fixed monthly
minimums and idle compute, not by per-request usage. The game is picking the
lowest base price, turning idle compute off, and not paying for managed
services whose value the app does not use. §5 gives the recommendation.

## 1. Where the money plausibly goes today

### 1.1 Vercel: invocations, duration, builds

- **The trip-board poll is the largest steady invocation driver in the repo.**
  `apps/web/src/components/trip/context/broadcast.ts:47` sets
  `POLL_INTERVAL_MS = 2000`, and the poll hits
  `GET /api/trips/:tripId/events` — about 30 requests per minute per visible,
  multi-member trip tab, each a function invocation plus several DB reads
  (access check plus event/suggestion/access/chat/presence revisions). Solo
  trips, demo trips, and hidden tabs cost zero polling, and presence writes
  are already bounded to one per member per 5 minutes
  (`apps/web/src/server/presence/presence.ts`). A single user leaving a
  multi-member board open all day is ~1,800 invocations/hour from that tab
  alone. Whether this dominates the real bill is dashboard question §2.1.
- **Long-duration tail: AI routes and the embed cron.** `apps/web/src/app/api/ask/route.ts`,
  `apps/web/src/app/api/trips/[tripId]/ask/route.ts`, and
  `apps/web/src/app/api/trips/[tripId]/chat/route.ts` all set
  `maxDuration = 300` (seconds). The daily embed-days cron
  (`apps/web/vercel.json`, `0 4 * * *`) runs up to 50 embeddings inside a
  240-second budget (`apps/web/src/server/ai/sweep.ts`) under a 300-second
  ceiling. These are duration risk, not steady cost: a few long invocations
  can outweigh thousands of short ones in GB-seconds.
- **The proxy runs on every matched request.** `apps/web/src/proxy.ts` is
  Node (not Edge) and matches `/home`, `/plans`, `/account`, `/trips/:path*`,
  `/invite/:path*`, `/playbooks/:path*`, and any path with `?ref=`. It does
  no DB read (JWT sessions, no adapter), but every `/playbooks/**` request
  pays a proxy execution on top of the page render. Whether Vercel bills
  proxy executions as function invocations on this plan is unverified from
  the repo — dashboard question §2.1.
- **Anonymous playbook traffic is already the cheapest traffic in the app.**
  Signed-out, query-free playbook pages go through a 24-hour data cache
  (`apps/web/src/server/libraryCache.ts:26`, `LIBRARY_CACHE_SECONDS = 86_400`,
  tagged `library`, purged on publish/unpublish) plus the CDN. Signed-in or
  filtered playbook traffic renders per request. Two caveats: the cache key
  includes the deployment id (`cacheScope()`), so **every deploy cold-starts
  the data cache** and the next crawl wave re-reads the library; and the
  internal `GET /api/playbooks` route calls live `discoverFor`, not the
  cached wrapper the page uses, so API Discover may be DB-per-request
  (unverified — check before assuming the API is cached).
- **Every anonymous library/OG API hit pays a Postgres write before the read.**
  Anonymous `/api/playbooks`, `/api/playbooks/board`, `/api/places`, and the
  OG image routes are rate-limited per IP in Postgres (`rate_limit_counters`
  via `pgCounters()` in `apps/web/src/server/quota.ts`; 120/min per IP and
  6,000/min global for the library, 60/3,000 for OG). Caching helps the read
  but not the counter write. The v1 public API (42 routes) likewise writes
  quota counters and touches `last_used_at` per call.
- **Builds: production on every `main` push; previews on demand only.**
  `apps/web/vercel.json` enables deploys for `main` only (`**`: false), and
  since 2026-10-25 previews build only when asked for
  (`.github/workflows/vercel-preview.yml`, label or manual dispatch). CI
  (`.github/workflows/ci.yml`) is draft-gated and prose-skipped, and the repo
  notes its own minutes as free while public — confirm the repo is still
  public in Settings before relying on that. Build cost is therefore already
  near its floor; the remaining lever is deploy frequency (see §3.6).
- **Deliberately cheap already, do not "fix":** images are plain `<img>` to
  Unsplash/OpenFreeMap, never through Vercel's optimizer
  (`apps/web/src/components/cover/CoverImage.tsx`); fonts are self-hosted;
  the landing is static with a client-side signed-in redirect
  (`apps/web/src/app/(front)/page.tsx`); the sitemap is `force-dynamic` but
  reads through the 24-hour cache, so a warm sitemap costs an invocation
  with no DB hit.

### 1.2 Neon: connections first, compute hours second, storage a distant third

- **The most likely Neon lever is connections, not query volume.** The app
  connects with plain `pg` over TCP, one untuned pool per serverless
  instance (`apps/web/src/server/db/client.ts`: `new Pool({ connectionString })`
  with no `max`, `min`, or timeouts; no `@neondatabase/serverless` import
  anywhere). Each Vercel instance that cold-starts opens its own pool, so
  Vercel concurrency drives Postgres connection count and compute time, and
  idle connections linger per `pg` defaults until instances are reclaimed.
  Whether `DATABASE_URL` already points at Neon's pooler host (`*-pooler.*`)
  is not visible in the repo — it is the single most valuable two-minute
  check in this whole document (see §3.1).
- **Compute hours follow traffic shape, not table size.** Neon Launch bills
  $0.106/CU-hour (verified, §4.1). An always-on 0.25 CU minimum is
  182.5 CU-hours/month ≈ $19.35 + storage ≈ **~$20/month**; the same
  database with scale-to-zero enabled and bursty invite-only use
  (~50–150 CU-hours/month) is **~$6–$17/month** including ~2 GB of storage
  at $0.35/GB-month. Disabling scale-to-zero roughly triples the small-app
  Neon bill — if it is currently disabled, re-enabling it is the cheapest
  single change available.
- **Storage is small at this scale.** A 1–2 GB database is $0.35–$0.70/month
  on Launch. Tables that grow with traffic — the event log,
  `rate_limit_counters` (swept at 1% of anonymous requests),
  `external_data_cache`, `ai_usage_*` — matter for growth, not for this
  month's bill.
- **Branches are cheap until they are not.** Extra branches are
  $1.50/branch-month on Launch (verified). Preview databases are disposable
  by design; a pile of stale branches is a slow leak worth a periodic
  delete, not a migration reason.

### 1.3 Other vendors (separate bills, same app)

- **AI Gateway** (ask/chat embeddings, sweep embeddings): metered per model
  in Vercel's AI Gateway dashboard. The embed-days cron and the 300-second
  ask routes are the drivers; token spend is independent of Vercel/Neon.
- **LocationIQ** (geocoding, per-user quota + `places:read` scope) and
  **Unsplash** (cover photos): vendor quotas, not Vercel/Neon. Weather is
  served from the Postgres `external_data_cache`, so vendor calls happen
  only on cache miss.
- **Upstash Redis** (optional, `CACHE_DRIVER`): used only for OG invite /
  referral cards. Quotas deliberately do not use it. If it is enabled, it is
  a small separate bill; if unset, per-instance memory cache costs nothing
  and shares nothing across instances.
- **Sentry**: the `tunnelRoute: "/monitoring"` in `next.config.ts` routes
  client error reports through the app's own function (the config comment
  itself warns this "can increase your server load as well as your hosting
  bill"). Sending direct to Sentry would remove those invocations at the
  cost of ad-blocker visibility — a tradeoff, not a free win.

### 1.4 Traffic the repo cannot see

- **External seeding jobs.** Operator-run scheduled jobs call the Caesura
  API several times a week to create seeded playbooks (roughly one per run,
  on a multi-day cadence). Nothing about that schedule lives in `vercel.json`,
  so its invocation/DB volume is invisible here — check Vercel logs for the
  seeding paths if the API numbers look higher than page traffic explains.
- **Token holders.** The v1 API is token-scoped and quota-bounded, not
  session-bounded; a token holder can poll any v1 endpoint up to its plan
  quota. The quota, not authentication, is the bound — and every poll pays
  the counter writes in §1.1.

## 2. Numbers only Mitchell can supply

No repo artifact answers these. They are the difference between guessing and
knowing, and they should be read before acting on §3–§5 beyond the free
config checks.

1. **Vercel Usage (§2.1), last 30 days, by path/function.** Vercel → Usage /
   Functions / Logs: total invocations and GB-seconds, top 10 paths. This
   alone separates "the 2-second board poll is the bill" from "anonymous
   library crawling is the bill" from "a few 300-second AI/cron invocations
   dominate duration." Also split production vs. preview build minutes, and
   confirm whether proxy executions are billed as function invocations.
2. **Neon branch metrics (§2.2), same period.** Neon dashboard: peak concurrent
   connections, compute active hours and scale-to-zero suspensions, storage
   size — and whether `DATABASE_URL` points at the pooler host (report the
   hostname pattern only, never the value). This answers whether the
   untuned `pg` pools are actually exhausting connections/compute, or
   whether query volume is trivial and Neon is already near-free. Also
   confirm the current plan (Launch vs. Scale) and whether scale-to-zero is
   enabled.
3. **Repo visibility (§2.3, one click).** GitHub repo Settings: public vs.
   private. CI minutes are $0 only while public; if the repo ever goes
   private, CI becomes a real (if small) line item and the draft-gating in
   `ci.yml` matters more.

## 3. Optimize in place (before any migration)

Ordered by expected saving per unit of effort, not by ease of writing. Every
item states what it reduces and what it costs to do; items marked
"Mitchell's call" change behavior and should not be merged on an agent's say-so.

### 3.1 Check the pooler and scale-to-zero first (config only, potentially the whole Neon saving)

- In Vercel → Environment Variables, look at the `DATABASE_URL` hostname
  pattern only: if it already contains a pooler host, pooling is on and
  this item is done. If it is a direct compute host, test the pooler
  endpoint in preview first — pooling mode matters for prepared statements
  and transactions, so do not flip production blind — then switch the env
  var. No code change is needed either way; the app already connects
  through one `Pool` per instance.
- In the Neon dashboard, confirm scale-to-zero is enabled (5-minute idle)
  and the minimum compute is 0.25 CU. If scale-to-zero is currently
  disabled, enabling it moves the DB from ~$20/month always-on to ~$6–$17
  (verified rates, §4.1). The cost is cold-start latency after 5 idle
  minutes on the first request — acceptable for an invite-only site, and
  measurable before committing.
- Also consider a `max` on the `pg` Pool in `client.ts` (currently
  unset). This is a small code change with a real tradeoff: a low cap
  bounds connections but can queue queries under bursts. Do it only if the
  dashboard shows connection pressure (§2.2); otherwise the pooler handles
  it.

### 3.2 Board poll: the largest steady invocation count (Mitchell's call)

The 2-second poll exists for live collaboration. Options, in increasing
savings order: raise the interval to 5–10 seconds when the tab is visible
but idle (no typing/cursor activity); back off to 30–60 seconds after a
few minutes without changes; stop polling entirely when the tab has no
other members online (presence already tracks this). Each step trades
collaboration freshness for invocations. Do not change this without
Mitchell's call on how live the board must feel — the saving is real but
the product cost is visible.

### 3.3 Discover double-read (small–medium, code)

`apps/web/src/server/playbooks.ts`: `discoverDays` runs a 200-row candidate
window query (full `stops` jsonb per row) and then `discoverPage` runs the
same predicates again for the 25-card page, plus a sequential
`publishedPlaybookCount()` count query per read. In the common no-budget /
no-tag case both rank identically, so the page is a slice of the window.
Fix: serve the page from the fetched window and drop the second read;
serve the shared count from the 24-hour library cache (it only changes on
publish/unpublish, which already clears `LIBRARY_TAG`). Effect: 2 full
`stops` reads → 1 per Discover request, plus one fewer count query. This
is paid on every API Discover call and every signed-in search (both bypass
the page cache), so it matters even though anonymous page traffic is
cached. Effort: small–medium. Needs the usual covering tests; the ranking
equivalence is asserted by the code's own tests, which must keep passing.

### 3.4 Owner names: 400 correlated lookups per listing window (small, code)

`discoverColumns` in `playbooks.ts` embeds two correlated `users` subselects
per row (display name + name), so a 200-row window pays ~400 PK lookups on
top of the `stops` transfer. The batched alternative already exists in the
same file (`publicNamesOf`: one `users … WHERE id IN (…)`). Fix: replace
the subselects with a single `LEFT JOIN users` or a post-read
`publicNamesOf` batch over the window's distinct owner ids. Effect: 400
lookups → 1 per listing query. Effort: small. The subselects exist to keep
`GROUP BY` queries grouped by `owner_id` alone; Discover/place queries are
not grouped, so the constraint does not apply to them — but verify that
claim against each call site before merging.

### 3.5 Cache the hot JSON surfaces (small–medium, code)

`GET /api/playbooks`, `GET /api/playbooks/board` (leaderboard: a
`reviewTotals` CTE scanning all `saved_days` plus `GROUP BY owner` per
load), and v1 Discover all bypass the library cache by design ("stays
live, since the screens' own re-reads go there and it is rate-limited
already" — `publicLibrary.ts` header). Rate limiting bounds abuse, not
repeated legitimate cost: every board open and every client re-read after
first paint re-runs the full aggregates. Fix: wrap the signed-out-equivalent
responses in the existing `libraryCached` (Discover already has a
per-search key shape; the leaderboard needs a new key tagged `LIBRARY_TAG`
so publish/unpublish invalidation already covers it). Keep signed-in
`yours`/`saved` scopes live. Effect: repeated board/API reads go from N
full queries per request to cache hits until invalidation. Effort:
small–medium. Staleness window is the publish cycle, which the app already
accepts for pages.

### 3.6 Lattice cold-cache cost (medium, code)

On a cold cache, a sitemap/crawl burst pays 3 full published-library
`stops` scans (places, tags, country×cities via `readablePublishedDays`,
no limit) plus a narrow sitemap scan, and each paginated place/country/
author page miss re-scans its whole match in JS
(`publishedDaysPage`, whose comment admits every match is read and paged
in JS). Fix: compute the lattice once per invalidation epoch — one
`readablePublishedDays` pass producing places, tags, and country×cities
under a single cache key — and push `LIMIT`/`OFFSET` plus a separate
`count(*)` into SQL for non-tag listing pages (tag filtering must stay
post-read, since tags derive from `stops`). Effect: cold sitemap/place
pages from 3–4 full scans → 1; each paginated miss from a full-match scan
→ 1 page query. Effort: medium. Note the deploy interaction: because the
cache key includes the deployment id, every deploy re-pays this burst, so
batching deploys (fewer, larger pushes to `main`) is a free companion
saving — process, not code.

### 3.7 Place typeahead: memoise the country half (small, code — in progress separately)

`searchPlaces` (`apps/web/src/server/places.ts`) runs the city aggregate
(already 30-second memoised) plus `publishedCountries()` (full unnest +
group) on every keystroke. The country input changes only on
publish/unpublish/moderation, which already call `forgetCitySearches`.
Fix: memoise the countries aggregate under the same 30-second window and
clear it from the same invalidation paths. A small PR for exactly this
change is being attempted alongside this doc; if it does not land
cleanly, this item stays doc-only. It is the only code PR attempted in
this batch because its invalidation story is already proven by the city memo.
Effect: per keystroke from 2 scans (1 memoised, 1 not) → 0 scans within
the window. Effort: small.

### 3.8 Indexes for the real sort keys (small, migration — doc only for now)

The schema's partial index on `saved_days` serves only the pure-public
`published_at` order (sitemap). It does not serve Discover `newest` for
signed-in readers (`coalesce(published_at, created_at)` defeats the index
ordering, and the owner-inclusive predicate defeats the partial
predicate), `most-added` / `highest-rated` sorts (no `adds`/`rating`
index), or the unfiltered browse case. Candidate indexes (partial, public
+ undeleted + unmoderated): `(adds DESC, created_at DESC)`,
`(rating DESC NULLS LAST, created_at DESC)`, plus
`trip_summaries (status, created_at DESC, trip_id DESC)` for keyset
paging and `pages (trip_id, created_at, id)`. This is doc-only, not a PR,
for two reasons: the planner benefit is unverified without `EXPLAIN` on
production-shaped data, and Drizzle's migrator runs in one transaction,
so `CREATE INDEX CONCURRENTLY` is unavailable (see the comment in
`apps/web/drizzle/0058_perf_indexes.sql`) — dispatch off-peak and treat
the migration as a production event, not a drive-by. Merging a migration
does not apply it; production migrations are dispatched via
`gh workflow run migrate-production.yml -f confirm=migrate` from `main`.

### 3.9 Board first paint: duplicate guests query, unbounded history (small + medium, code)

Per board load, `tripFirstData.ts` fans out ~13 queries, including
`listGuests(tripId)` twice (once speculatively in `readTrip` before the
access decision, once in `tripAccessView`) and a full unbounded event
stream for history even though the history panel is not the first paint.
Fix: pass the already-fetched guests (and member list) from
`requireTripAccess` into `tripAccessView`; make history lazy/paginated
(tail N entries + `readStreamHeadSeq` for canUndo/canRedo). Effect: one
duplicate query gone outright; history from O(lifetime events) to O(page
size). Effort: small (guests), medium (history). Left doc-only because
it touches the access path, which deserves a careful review, not a
drive-by.

### 3.10 Home list and active-trips scan (medium–large, code — later)

Home reads every visible trip's full document twice (once inside the list
query's `trip_details` join + per-row `jsonb_agg` over all activities,
once via `getTripDetails` for the spend line), with no limit. The durable
fix is materialising `endDate`, `dayCount`, `stopCount`, `ideaCount`, and
a compact kind/tag summary onto `trip_summaries` at projection-write time
(the same transaction already writes both tables) and dropping the join +
aggregation from the list query. The same materialisation would also fix
`GET /v1/trips?active=true`, which today scans up to 5 batches of 200
heavy summary rows to fill one page because phase cannot be a SQL
predicate (it needs the full doc + per-trip zone math); a materialised
active window + index turns it into one indexed range query. Effort:
medium–large (projection change + migration + rebuild). Do this only if
§2 shows Home/trips traffic is material; at invite-only scale it likely
is not the first thing to fix.

### 3.11 Things deliberately not recommended here

- **Moving rate-limit counters to Redis.** The code deliberately keeps
  limiters in Postgres ("a limiter spends a command per request" —
  `og/limit.ts`); a Redis INCR is cheaper than a Postgres upsert only if
  counter writes dominate Neon volume, which §2 has not shown. Revisit
  only if the dashboard says `rate_limit_counters` is a top table.
- **Trimming the embed-days cron frequency.** It is already one invocation
  a day with a bounded budget; running it less often delays embeddings
  for newly published days. Only touch it if AI Gateway spend (not
  Vercel/Neon) is the problem.
- **Sending Sentry direct instead of tunneled.** Saves `/monitoring`
  invocations but loses reports to ad blockers. Only worth it if §2.1
  shows `/monitoring` near the top of invocations.
- **Chasing CI minutes.** CI is draft-gated, prose-skipped, and $0 while
  the repo is public. Revisit only if visibility changes (§2.3).

## 4. Migration options (verified prices, estimates labeled)

All prices below were fetched from official pages on 2026-10-25 unless
marked otherwise. Monthly totals are estimates under the assumptions stated in the introduction
(~30k views/month, <1M requests, <10 GB transfer, 1–2 GB database, one
region/seat). "Verified" means the figure appeared in the fetched official
text; "unverified" means the official page was fetched but its price table
did not render, and the figure comes from secondary sources — do not budget
on unverified figures without a dashboard/calculator check.

### 4.1 Stay on Vercel + Neon, tuned (baseline, config only)

- **Neon Launch (verified: https://neon.com/docs/introduction/plans):**
  $0.106/CU-hour, $0.35/GB-month storage, scale-to-zero after 5 minutes
  (can be disabled), up to 16 CU autoscaling, 500 GB egress then $0.10/GB,
  extra branches $1.50/branch-month. Free tier (verified): 100 CU-hours/
  project/month, 1 GB storage/project, scale-to-zero after 5 minutes
  (cannot be disabled) — already outgrown, which is consistent with
  "hit the cap."
- **Vercel Pro (unverified on official fetch):** the seat price
  ($20/developer/month, widely reported) and overage rates did not render
  in the fetched pricing text. Verified on the same page: Hobby cannot
  purchase additional usage (which plausibly explains "hit the cap":
  1M CDN requests, 100 GB transfer, 1M invocations, 4 CPU-hours/month,
  then a wall, not a bill), and Pro teams have a $20 included credit
  plus a default $200 on-demand budget.
- **Estimate:** Neon ~$6–$17/month scale-to-zero (or ~$20 always-on at
  0.25 CU) + Vercel Pro seat (secondary $20) ≈ **$26–$40/month total**,
  with usage overages ~$0 at assumed scale. Effort: config only
  (scale-to-zero, pooler check, minimum CU). Breaks: nothing.

### 4.2 Cloudflare Workers + Neon (cheapest verified managed-app total)

- **Workers Paid (verified: https://developers.cloudflare.com/workers/platform/pricing/):**
  $5/month minimum, 10M requests/month included then $0.30/million,
  30M CPU-ms/month included then $0.02/million CPU-ms, no egress charges,
  static-asset requests free and unlimited. Pages Free limits verified
  (500 builds/month, unlimited previews); Pages plan prices were not on
  the fetched page.
- **Postgres must stay external.** Cloudflare's own database, D1, is
  SQLite, not Postgres — verified mismatch, not a migration target. Keep
  Neon (via Hyperdrive or direct connection) as the database.
- **Estimate:** Workers $5 + Neon ~$6–$17 ≈ **$11–$22/month total**.
  Effort: medium. Breaks/needs rework: Next.js does not run natively on
  Workers — it needs the OpenNext/Cloudflare adapter; Node-only
  dependencies may fail on the Workers runtime; edge middleware becomes
  Workers code; ISR becomes Workers caching/revalidation logic; Vercel
  Cron becomes Workers Cron Triggers; preview deploys exist but with a
  different URL/workflow. The edge-runtime audit is the real work: the
  app is Node throughout today (no Edge routes found), so anything
  Node-specific (notably `pg` TCP) must be re-proved on Workers.

### 4.3 Fly.io (best VPS-like PaaS; managed Postgres dominates)

- **Machines (verified, iad/ewr: https://docs.fly.io/about/pricing/):**
  shared-cpu-1x 1 GB $6.70/month, 512 MB $3.69, 2 GB shared-2x $13.39;
  volumes $0.15/GB/month; egress $0.02/GB North America/Europe; no free
  tier for new orgs.
- **Managed Postgres (verified: https://docs.fly.io/postgres):** Basic
  $38/month (shared-2x, 1 GB), Starter $72, Launch $282; storage
  $0.28/GB on usage; HA/backups/pooling included. The official worked
  example totals $43.67/month.
- **Estimates:** managed-Postgres route ≈ **$44/month**; self-managed
  Postgres on a second Machine ≈ **$15/month** (app 1 GB $6.70 + PG 1 GB
  $6.70 + 10 GB volume $1.50 + egress) — but then you own backups and
  failover. A third variant, app on Fly (~$7) + Neon DB (~$6–$20), is
  ≈ $13–$27/month and keeps managed Postgres. Effort: medium. Breaks:
  Vercel previews (build your own), Vercel Cron (scheduled Machine or
  external scheduler), edge middleware (in the Node server), ISR
  semantics, Neon branching/pooling/serverless driver (use a standard
  connection string, or keep Neon as the DB).

### 4.4 Hetzner one box (cheapest cash, highest ops burden)

- **Prices unverified on official fetch** (https://www.hetzner.com/cloud/
  rendered product lines/locations only). Secondary June-2026 figures,
  Germany/Finland excluding VAT: CX23 (2 vCPU / 4 GB / 40 GB) €5.49/month,
  CAX11 (ARM, same spec) €5.99, CX33 (4 / 8 GB / 80 GB) €8.49. Older
  €3.99/€7.99 figures are stale. Re-check in the console before budgeting.
- **Estimate:** one box for app + Postgres ≈ **€5.49–€8.49/month**
  (secondary, unverified) plus your time. Effort: large. Breaks: everything
  managed disappears — previews, cron, CDN/edge, branching, pooling,
  managed backups, zero-downtime deploys; you build all of it (Docker +
  Caddy/Traefik + cron or a layer like Coolify/Dokploy) and you own
  patching, backups + tested restores, TLS, disk-full handling, and
  failover (none on one box — a single box is a single point of failure).
  A second box or managed backup store is needed for anything beyond
  "acceptable to lose a day." Only credible if owning Postgres ops is
  acceptable to Mitchell.

### 4.5 Supabase as the database (flat, no idle saving)

- **Pro (verified: https://supabase.com/pricing):** $25/month, 8 GB disk
  then $0.125/GB, 250 GB egress then $0.09/GB, $10 compute credit covering
  one Micro instance (1 GB); next sizes Small $15, Medium $60, Large
  $110/month. Spend cap on by default. No scale-to-zero: the instance
  bills whether idle or not. Free tier is not viable for production
  (pauses after 1 week idle, 500 MB database cap).
- **Estimate:** $25/month DB + app host ($5–$7) ≈ **$30–$32/month total**.
  Effort: small–medium. Breaks: real Postgres, so Drizzle + SQL largely
  carry over; lose Neon branching (Supabase branching is usage-based, not
  the same copy-on-write preview flow), the Neon serverless driver (use
  Supabase's pooler/direct connection), and scale-to-zero savings. Only
  worth it if the flat price or Supabase's extras (Auth/Storage/Realtime,
  which this app does not currently need) matter more than idle savings.

### 4.6 Turso (do not migrate for cost — wrong engine)

- **Paid plans (verified: https://turso.tech/pricing):** Developer
  $4.99/month (9 GB, 2.5B reads, 25M writes), Scaler $24.92/month. Free-tier
  limits did not render (only "100 databases for free" is confirmed).
- **Decisive caveat:** Turso is libSQL, a SQLite fork — not Postgres.
  Migrating means switching the Drizzle dialect, rewriting Postgres-
  specific SQL (types, sequences, `jsonb` operators, extensions), reworking
  migrations, and re-testing every query, for a DB bill that is $0–$5
  against Neon's $6–$17. The saving is smaller than the rewrite. Only
  worth it if the app is deliberately re-architected for edge/SQLite.
  Effort: large. Verdict: no.

### 4.7 AWS (no cost case at this scale)

All AWS figures are region- and config-dependent (us-east-1 below); use the
AWS Pricing Calculator for any real configuration.

- **Lightsail (verified: https://aws.amazon.com/lightsail/pricing/):**
  IPv4 Linux $7/month (1 GB) / $12 (2 GB) / $24 (4 GB); managed database
  $15/month Standard (1 GB / 40 GB) / $30 HA. Estimate: app $12–$24 +
  DB $15 ≈ **$27–$39/month**, no load balancer. This is the only AWS route
  with a clean flat price at this scale. Effort: medium (Docker on one
  box + managed DB).
- **EC2 + RDS Postgres:** instance hourly rates did not render on
  official fetch (per-second billing and T4g credit $0.04/vCPU-hour
  verified; db.t4g.micro ~$0.016/hr ≈ $11.70/month is secondary).
  Secondary-based estimate ≈ $25–$45/month before ALB/CloudWatch, with
  far more moving parts than Lightsail. Effort: large.
- **Aurora Serverless v2 (verified model, unverified rate):**
  ACUs billed per second, 1 ACU ≈ 2 GiB, starting capacity 0 ACU,
  0.5 ACU granularity — but $/ACU-hour did not render (secondary
  $0.12 Standard / $0.16 I/O-Optimized per ACU-hour). At the secondary
  rate, a 0.5 ACU floor alone is $43.80/month compute before storage
  and I/O. Aurora only wins if it genuinely pauses to 0 ACU for long
  idle stretches. No total is quoted because the rate is unverified.
- **ECS/Fargate (verified per-second rates: https://aws.amazon.com/fargate/pricing/):**
  x86 $0.04048/vCPU-hour + $0.004446/GB-hour. One always-on 1 vCPU / 2 GB
  task computes to ~$36.00/month compute alone; plus a DB and an ALB,
  a production-shaped setup estimates **$50–$70+/month**. Effort: large.
  What breaks everywhere on AWS: Vercel previews/cron/edge/ISR semantics
  and Neon branching/serverless driver; on Lightsail, managed-Postgres
  conveniences beyond the basic managed DB.
- **Verdict:** AWS is the most complexity for no saving at this scale.
  Setting up AWS is only worth it if Mitchell wants AWS skills or has a
  reason beyond cost (e.g. a future service that needs it). Cost alone
  does not justify it.

## 5. Recommendation

**Cheapest credible path: Cloudflare Workers ($5, verified) + Neon Launch
scale-to-zero (~$6–$17, verified rates) ≈ $11–$22/month total, medium
effort.** This is the lowest total built from verified components. The
effort is real — OpenNext adapter plus an edge-runtime audit of a
Node-throughout app — so treat it as a project, not a weekend flip. It
keeps managed Postgres (no engine change, no ops burden) and removes the
largest unverified line (Vercel Pro) from the bill entirely.

**Second-cheapest, lower-effort path: stay on Vercel + Neon Launch, tuned.
Config only: confirm scale-to-zero is on with a 0.25 CU minimum, check the
pooler hostname, delete stale branches, and do §3.3–§3.7 (the small code
optimizations) as ordinary PRs.** Estimated total $26–$40/month, but the
Vercel portion of that estimate rests on a secondary seat price — verify
it in the dashboard before treating the total as firm. This path costs
more than Cloudflare + Neon and keeps the Vercel bill uncapped in the
sense that overages (unverified rates) are the unknown; it costs almost
no effort and breaks nothing, which is why it is second despite the
higher number.

**Cheapest flat price, only if owning ops is acceptable: a Hetzner
one-box setup at a secondary €5.49–€8.49/month (unverified — re-check
before budgeting), large effort.** It beats both paths on cash and loses
on everything else: backups, failover, patching, previews, and cron all
become Mitchell's job. Do not pick this for cost alone unless the ops
burden is genuinely welcome.

**What NOT to do:** do not migrate to Turso (engine change for a smaller
saving than the rewrite); do not buy Fly Managed Postgres ($38 floor —
more than the whole app elsewhere) or Supabase Pro as a database-only
move ($25 flat, no idle saving); do not build on AWS for cost reasons
(Lightsail is the floor at ~$27–$39 and everything else costs more with
more complexity); do not go back to Vercel Hobby (it cannot purchase
additional usage — the cap that started this is a wall, not a bill); do
not chase CI minutes (already $0 while public) or preview builds
(already on-demand since 2026-10-25); do not "optimize" the AI eval
(`pnpm --filter web eval` runs on a paid key and is unrelated to hosting
cost — and never run it without asking).

## 6. Sequenced plan (cheapest first, each step independently shippable)

1. **Today, config only (no PR, no deploy):** read §2.1–§2.2 from the
   dashboards; confirm Neon scale-to-zero + 0.25 CU minimum; check the
   `DATABASE_URL` pooler hostname pattern; delete stale Neon branches.
   Expected effect: the Neon bill drops toward the $6–$17 range if
   scale-to-zero was off, and the connection question is answered.
2. **This week, small code PRs:** the place-countries memo (attempted
   alongside this doc; doc-only if it does not land cleanly), then §3.3 (Discover single-read), §3.4 (owner
   join), §3.5 (library-cache the hot JSON surfaces), each as its own
   draft PR with its own review, with §3.6 (lattice single-pass) as the
   medium-effort follow-on once the small ones land. Expected effect: fewer DB queries per
   request on the hottest paths; the saving shows up as Neon compute
   hours and Vercel duration, measurable only via §2 after shipping.
3. **Next, behavior calls (Mitchell only):** the board poll interval
   (§3.2) and the Sentry tunnel (§3.11). No agent should merge these
   without his explicit call.
4. **Then, if the Vercel number still hurts:** the Cloudflare Workers +
   Neon migration (§4.2) as a project with a preview-first proof (adapter
   + edge-runtime audit + a preview deployment serving real traffic
   shapes) before any DNS cutover. Do not cut over on price alone
   without the proof, because the edge-runtime audit is where the
   effort hides.
5. **Never on this track:** Turso, Fly Managed Postgres, Supabase-as-DB-
   only, AWS-for-cost, Hobby. See §5.

## 7. Decisions made autonomously (not Mitchell's)

These are calls the overnight work made without Mitchell, recorded here so
he can overturn any of them. Nothing here changes production, billing,
accounts, DNS, or his trips/playbooks.

- **Doc home:** `docs/ops/` is new. The repo has no ops section, and
  `docs/plans/` is explicitly for plans that are deleted when closed, so
  a durable ops doc does not belong there. `docs/guidelines/` is for
  process rules, not for this analysis.
- **Estimate assumptions:** ~30k views/month, <1M requests, <10 GB
  transfer, 1–2 GB database, one region/seat. These are stated
  assumptions, not measurements; if real traffic differs by an order of
  magnitude, §4's usage-sensitive rows need rework.
- **Recommendation framing:** "cheapest credible" is ranked on verified
  components (Cloudflare + Neon), and "second-cheapest lower-effort" is
  stay-and-tune, even though its total is higher — because its Vercel
  portion could not be verified on the official fetch. If Mitchell
  supplies the real Vercel number (§2.1) and it is lower than the
  secondary estimate, the ranking may flip.
- **The one code PR:** the place-countries memo was chosen as the only
  code PR attempted because its invalidation story is already proven by the city
  memo and its blast radius is one typeahead endpoint. The index
  migration, Discover rework, board changes, and poll changes were left
  doc-only because they need benchmarks, production-shaped `EXPLAIN`
  data, access-path review, or a behavior call Mitchell has not made.
- **What was not investigated:** per-route DB query counts (no repo
  instrumentation exists), actual traffic volumes (dashboard-only), and
  AI Gateway spend by model (separate dashboard). All three are listed
  in §2 rather than estimated.
- **Unverified prices are flagged, not smoothed over.** Where an official
  page did not render its price table (Vercel Pro seat/overages, Hetzner
  numerics, EC2/RDS/Aurora hourly rates, Turso free tier, Cloudflare
  Pages plan prices), this doc says so and does not budget on the
  figure. That makes some totals ranges instead of points; that is
  deliberate.

## 8. Sources

Pricing pages fetched 2026-10-25 (all figures in §4 trace to these; see
each subsection for what verified and what did not render):

- Vercel pricing — https://vercel.com/pricing
- Neon plans — https://neon.com/docs/introduction/plans
- Cloudflare Workers pricing — https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Pages limits — https://developers.cloudflare.com/pages/platform/limits/
- Fly.io pricing — https://docs.fly.io/about/pricing/
- Fly.io Managed Postgres — https://docs.fly.io/postgres
- Hetzner Cloud — https://www.hetzner.com/cloud/ (product lines only; numerics secondary)
- Supabase pricing — https://supabase.com/pricing
- Turso pricing — https://turso.tech/pricing
- Turso overview — https://turso.tech/what-is-turso (SQLite-compatible)
- AWS Lightsail pricing — https://aws.amazon.com/lightsail/pricing/
- AWS RDS for PostgreSQL pricing — https://aws.amazon.com/rds/postgresql/pricing/
- AWS Aurora pricing — https://aws.amazon.com/rds/aurora/pricing/
- AWS EC2 on-demand pricing — https://aws.amazon.com/ec2/pricing/on-demand/
- AWS Fargate pricing — https://aws.amazon.com/fargate/pricing/

Repo evidence cited by path throughout: `apps/web/vercel.json`,
`apps/web/next.config.ts`, `apps/web/src/proxy.ts`,
`apps/web/src/server/db/client.ts`,
`apps/web/src/server/libraryCache.ts`,
`apps/web/src/server/quota.ts`,
`apps/web/src/server/playbooks.ts`,
`apps/web/src/server/places.ts`,
`apps/web/src/server/cities.ts`,
`apps/web/src/components/trip/context/broadcast.ts`,
`apps/web/src/server/tripFirstData.ts`,
`apps/web/src/server/projections.ts`,
`apps/web/src/server/public-api/activeTrips.ts`,
`apps/web/src/app/api/playbooks/route.ts`,
`apps/web/src/app/api/playbooks/board/route.ts`,
`apps/web/src/server/publicLibrary.ts`,
`.github/workflows/ci.yml`,
`.github/workflows/vercel-preview.yml`,
`apps/web/drizzle/0058_perf_indexes.sql`.
