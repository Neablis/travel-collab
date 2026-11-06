# M59 - Self-host Caesura on a Coolify VPS

**Status:** **Proposed 2026-11-06, placed last, after M53 (current). Not scoped yet**: decisions
D1–D9 are open with recommendations and none has been answered. Proposed on
Mitchell's ask, following the Coolify VPS guide; see `docs/milestones/README.md`.

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

**Open (recommendations; none answered):**

1. **VPS provider.** Hostinger KVM 2 per the guide (2 vCPU, 8GB RAM, NVMe,
   about $6/mo in the guide) vs Hetzner (the Oct 25 notes call the Hetzner
   one-box the cheapest raw option). *Recommended:* price both at build time;
   Hetzner if it is cheaper for 2vCPU/8GB in the region the audience is in,
   else Hostinger per the guide.
2. **Database.** Keep Neon vs move Postgres into Coolify. *Recommended:* keep
   Neon for this milestone (data, backups, branches stay put); self-hosted
   Postgres is a later, separate decision.
3. **Redis.** Keep Upstash vs self-host Redis in Coolify. *Recommended:*
   self-host in Coolify once the off-Vercel fallback in
   `server/cache/redis.ts` is confirmed; keep Upstash as the fallback if the
   fallback is "no cache". The file's own comment says the in-process Map is
   for one process only, so a multi-replica deploy needs a shared store or
   `off`.
4. **Analytics.** Replace with self-hosted (Plausible/Umami) vs drop.
   *Recommended:* drop Speed Insights, replace Analytics with Plausible
   self-hosted only if Mitchell wants the numbers; default drop.
5. **Flags.** What replaces the `@flags-sdk/vercel` adapter plus the Toolbar
   per-reviewer flip workflow (the Toolbar's Flags Explorer flips `ai-live`
   for one reviewer session). *Recommended:* survey at Part 1 and propose; do
   not assume.
6. **Previews.** Coolify per-PR preview URLs vs keep Vercel for previews.
   *Recommended:* Coolify previews if they exist; else keep a Vercel preview
   project until they do.
7. **Cron.** Coolify scheduled task vs system cron. *Recommended:* whichever
   Coolify natively supports, verified in Part 3; never an in-app timer.
8. **Cutover.** DNS flip with dual-run + rollback vs hard cutover.
   *Recommended:* dual-run with Cloudflare, rollback is DNS back to Vercel.
9. **Placement.** Where M59 sits in the queue (proposed last, after M53,
   the current milestone) and whether it jumps ahead of M48 (paused) or
   M53. Mitchell's call; the plan proposes last, after M53, and says so.

## Scope

- Decoupling the app from Vercel runtime APIs: the origin/env module, the
  `@vercel/functions` and `@flags-sdk/vercel` replacements, analytics, the
  standalone output and Dockerfile, HSTS.
- Provisioning the VPS and Coolify, Cloudflare DNS and SSL, the deploy
  pipeline, and per-PR previews or their replacement.
- Cron, migrations and backups on the new host, and the staging/preview
  database story.
- Cutover: dual-run, DNS flip, soak, rollback criteria, and the decision
  about what Vercel becomes.

## Out of scope

- Moving Postgres off Neon (D2 recommends keeping it; a later decision).
- Deleting the Vercel project. It stays as the rollback target through the
  soak, and is never deleted in this milestone.
- Changing what the app does. No behavior change is in scope; the app that
  runs on the VPS is the app that runs on Vercel.
- The Cloudflare Workers route from the Oct 25 verdict. It stays the
  comparison point, not work in this milestone.

## Exit gate

- [ ] **Decisions D1–D9 are answered and recorded here.**
- [ ] **Production serves from the VPS**, after a dual-run soak whose length
      is recorded here, with the Vercel deployment still standing by.
- [ ] **Previews work for PRs** (or the D6 replacement is in place and the
      part-reviewer walks it).
- [ ] **Both crons fire on the new host** (embed-days and tier-rollup, with
      `CRON_SECRET`), and a missed run is visible the way a missed Vercel
      cron run was.
- [ ] **Migrations dispatch on the new host** with the disposable-branch gate
      intact, and a preview build cannot migrate production.
- [ ] **No `@vercel/` or `@flags-sdk/vercel` import remains** in `apps/web/src`
      (grep), and HSTS is served.
- [ ] **Flags work without the Vercel adapter**, including the per-reviewer
      flip workflow or its agreed replacement.
- [ ] **Rollback is exercised or documented** (DNS back to Vercel), and the
      Vercel project is retained, not deleted.
- [ ] **[walk]** On the VPS deployment, the app behaves as on Vercel: sign in
      with Google, open a trip, and watch a cron fire.
- [ ] A retro is appended at gate close.
