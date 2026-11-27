# STATUS archive — 2026-11-24

Moved here verbatim on 2026-11-24, from `docs/STATUS.md` as it stood at `9133c5ba`, when M59
closed folded into M64 (Mitchell, 2026-11-24, "Fold M59 into M64"; M64 decision 11).

Why each went (`docs/guidelines/retiring-a-rule.md`'s criteria): history (2). The first is M59's
section from *Where the work is right now*, the second its *Next action* item; both described an
open gate that is now closed. M59's gate evidence, retro and spend are in
`docs/milestones/M59-self-host-on-coolify-vps.md`, and its two amended-out boxes are M64's.
Also removed, not moved: the closing sentence of the M63 paragraph,
"**M59 is still current, with 3 gate boxes open.**"

**M59 is current, production cut over 2026-11-09, gate open** (*Self-host Caesura on a Coolify
VPS*; decisions and evidence in `docs/milestones/M59-self-host-on-coolify-vps.md`, plan
`docs/plans/2026-11-06-M59-self-host-on-coolify-vps.md`, runbook `docs/ops/coolify-vps.md`).
Vercel blocked the account on 2026-11-08 and production went down; it now serves from the Hetzner
box through Coolify, built from `main` (`/api/health` version `5504d935`), with DNS on Cloudflare.
All five code parts are on `main`: PR 702 (`7b390a21`), then PR 707 (`6f07974d`), which carried
PRs 703, 704 and 706. Migrations `0070` to `0074` are applied (`migrate-production` run
42561546021). Gate: 8 of 11. **Open, by Mitchell's choice to keep M59 open rather than defer
them:** the Vercel project is not paused, Coolify PR previews are not on (the preview Neon branch is
archived), and the retro waits for those two. Part 0 is PR 701 (`claude/next-milestone-setup-3ccab6`,
prose only); it merges at the close, not before.

0. **M59 (current):** Mitchell pauses the Vercel project (never deletes it). Then switch on Coolify
   PR previews only after the Preview-scope `DATABASE_URL` points at a live preview Neon branch
   (`docs/ops/coolify-vps.md`, *Previews*, steps 1 to 3), and check one PR's preview. Then tick the
   last two boxes, write the retro with a spend block, `pnpm milestone close M59`, delete the plan,
   and Mitchell merges PR 701. Deferred out of the gate: KI-20261109-a (plan retrieval, needs an
   OpenAI key) and KI-20261109-b (three unread env vars); KI-20261108 (stale Vercel mentions).
   M53 follows M59.
