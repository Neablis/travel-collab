# M59 - Self-host Caesura on a Coolify VPS

**Status:** **Scoped 2026-11-08 with Mitchell; current milestone**, placed ahead of M53 (D9).
Decisions D1–D9 are answered below. Plan: `docs/plans/2026-11-06-M59-self-host-on-coolify-vps.md`.
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

- [x] **Decisions D1–D9 are answered and recorded here.** (2026-11-08)
- [ ] **Production serves from the VPS** (hard cutover, D9), and the Vercel project
      is paused or downgraded, not deleted.
- [ ] **Coolify previews work for PRs**, each on its own disposable Neon branch, and the
      part-reviewer's and phase-verifier's walk instructions point at them.
- [ ] **Redis and Plausible run on the box**, and the app uses both (a cache hit is
      observable; a pageview shows in Plausible).
- [ ] **Both crons fire on the new host** (embed-days and tier-rollup, with
      `CRON_SECRET`), and a missed run is visible the way a missed Vercel
      cron run was.
- [ ] **Migrations dispatch on the new host** with the disposable-branch gate
      intact, and a preview build cannot migrate production.
- [ ] **No `@vercel/` or `@flags-sdk/vercel` import remains** in `apps/web/src`
      (grep), and HSTS is served.
- [ ] **Flags work without the Vercel adapter**, from env vars per deployment (D6).
- [ ] **Rollback is exercised or documented** (DNS back to Vercel), and the
      Vercel project is retained, not deleted.
- [ ] **[walk]** On the VPS deployment, the app behaves as on Vercel: sign in
      with Google, open a trip, and watch a cron fire.
- [ ] A retro is appended at gate close.
