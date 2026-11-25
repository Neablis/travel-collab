# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues/`.

**This file is live instruction only, and it is kept short on purpose.** At
gate close a phase's narrative moves to its milestone file or a retro in the
same commit, and this file keeps the pointer. Closed sections go verbatim to a
`docs/retros/<date>-status-archive.md`; *Where the history went* at the end
lists every one. **A stale section is the defect to watch for, more than
length**: this file has named a closed milestone as current four times.
`pnpm state`'s DRIFT line checks it against the Current milestone line.

**Local dev recipe:** `AGENTS.md` points here for it; it is not restated here,
because two copies drift. `docs/guidelines/cloud-agent-sessions.md` is the one
to read in a container (native Postgres on :5433, Playwright's browsers, what is
different from a laptop), and `docs/guidelines/building-the-parts.md` is the
general setup.

## Where the work is right now

**M64 is current** (*Caesura runs on one cheap box, with its own Postgres*; decisions D1–D14 in `docs/milestones/M64-one-cheap-box-own-postgres.md`, ADR-093). Minted, scoped and placed ahead of M53 by Mitchell on 2026-11-24, every decision answered the same day. Part 0 is `claude/caesura-neon-migration-b5c8f3` (prose only, merges last). Plan: `docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`: two stacks around one cutover, stack A (maintenance mode, the compare script, Umami) merged before it and stack B (GHCR images, the SSH tunnel, Neon removed) merged at it. No code part has started.

**M59 closed 2026-11-24, folded into M64** (gate 9 of 9, two boxes amended out to M64 by Mitchell's decision "Fold M59 into M64": the Vercel pause and PR previews). Production has served from the Hetzner box since 2026-11-09. Evidence, retro and spend are in `docs/milestones/M59-self-host-on-coolify-vps.md`; its old STATUS section is in `docs/retros/2026-11-24-status-archive.md`.

**M63 closed 2026-11-22, gate 18 of 18** (*Two pages say Caesura is AI first, and safe to hand to your AI*: `/ai`, `/security`, a *Connect your AI* section on `/developers`, code samples per endpoint, and `/agents.md`; decisions, evidence and retro in `docs/milestones/M63-caesura-works-with-your-ai.md`), by `pnpm milestone close M63 --confirm` on part 0 (PR 783, `ccr-8a6d904d-vhaiet`, prose only), which **merges last**. The five code parts are on `main` through PR 788 (merge `ded937e`). Every clause was checked on production; the last two, the sitemap clause for `/ai` and `/security`, passed only after Mitchell purged Cloudflare's copy of `/sitemap.xml` on 2026-11-22, because it had served a pre-merge file (`s-maxage=86400`). A task to shorten that cache or purge on deploy was suggested and is not filed. ChatGPT was cut by decision 20 (Gemini is the Gemini CLI; Muse is named). Open known issue that recurred: KI-20261111-b. Retro: the orchestrator's share of spend missed its target again (44.5% and 37%, against 15%).

**M62 closed 2026-11-21, gate 10 of 10, the walk amended** (*An account can ask for a second factor, and you control every one*; decisions, evidence and retro in `docs/milestones/M62-a-second-factor-you-control.md`, ADR-092), by `pnpm milestone close M62 --confirm` on part 0 (PR 773, `ccr-f7b14b1c-can07a`, prose only), **merged as 5db7b06**. All six code parts are on `main`: PRs 774 to 778 through PR 778 (2557e2e, 18:19Z), then PR 779 (301f28e, 18:26Z). `deploy-production` run 44934907812 on 2557e2e applied `0079_mfa`; run 44935504221 on 301f28e is green. Mitchell walked production the same day with no iPhone: an authenticator app, and a biometric passkey on Android and on desktop. He amended the [walk] box for that (Face ID replaced) and it is ticked. **Not walked on production:** removing a factor, turning MFA off, iOS Safari. One known issue: `KI-20261121-m62-early-lock-script-warns-on-client-navigation`.

**M60 closed 2026-11-14, gate 11 of 11, with two boxes amended out** (*A personal agent can find
Caesura, and act for you within what you allow*; decisions, evidence and retro in
`docs/milestones/M60-personal-agents-act-for-you.md`, mechanisms in ADR-089), by `pnpm milestone
close M60 --confirm` on part 0 (PR 712, `claude/relaxed-pascal-i6125m`, prose only), which **waits
on Mitchell's merge**. All code is on `main`: PRs 714 to 717 in `d05a1fd` and PR 718 in `44eac29`
(2026-11-11). Migration `0075_agent_sessions` is applied (`migrate-production` run 43155805732 on
`678a90d`, which contains `44eac29`). Four boxes (the walk, Disconnect, Claude's connector, the
tasks endpoint and a console report) are ticked on Mitchell's word of 2026-11-14 that he saw them
work on production; PR previews never had working sign-in. **Two boxes are amended out, not
passed:** the kit validator run on `poppy.json` (KI-2026-11-14-a, since run 2026-11-15 and resolved) and a domain-audience token
through v1's gates (KI-2026-11-14-b, since tested 2026-11-15 and resolved); Mitchell confirms both when he merges. KI-2026-11-01-u is
resolved by PR 721.

**M61 closed 2026-11-14, gate 9 of 9, with the *[walk]* box waived, not walked** (*Discover ranks
what's worth borrowing now*; decisions, evidence and retro in
`docs/milestones/M61-discover-ranks-what-is-worth-borrowing.md`, rule in ADR-090). PR 727 landed
parts 1 to 5 as 678a90d on 2026-11-12, `migrate-production` applied `0076_saved_day_ranks`
(run 43155805732), and the Coolify task `discover-rank` ran hourly (`17 * * * *`) until Mitchell
asked on 2026-11-18 for daily (`17 4 * * *`), with the cache cleared only when the order moves
(ADR-090's amendment; the schedule is set in Coolify, not in the repo). Mitchell said
*"Let's close out the gate and merge"* without saying he had walked production; the orchestrator
took that as a waiver, and nobody has opened preview or production in a browser. `pnpm milestone
close M61 --confirm` has run (TODO.md row ticked). Production was down for about 8 minutes after
the merge, because the code deployed before `0076` was applied (inferred, not traced); no known
issue exists for that ordering yet. Part 0 is PR 722 (`ccr-229c0104-j14ya5`, prose only), waiting
for Mitchell to merge.

**Next action:**
0000. **M63:** Mitchell merges PR 783 (part 0, prose only; every code part is on `main` in `ded937e`, so no lower draft is open and no migration is due). Then remove the orchestrator's `tc-orchestrator` guard file. Optional: file the task to shorten the sitemap cache or purge it on deploy.
000. **M62:** closed and merged (5db7b06). Optional: walk remove-a-factor and turn-off on production, and an iPhone when one is at hand.
00. **M60:** Mitchell merges PR 712 (part 0, prose only; all code is merged and `0075` is applied, so
   no `migrate-production` is due and no lower draft is open) and confirms the two amended-out boxes. The kit validator ran 2026-11-15
   and was re-run after an Allow (KI-2026-11-14-a resolved; its leftovers are KI-2026-11-15-a, since resolved, and
   KI-2026-11-15-b). The v1 domain-audience test is in (KI-2026-11-14-b resolved).
0a. **M61:** Mitchell merges PR 722. File a known issue for deploy-before-migrate ordering; the
   unwalked *Discover rank* tab and `first_published_at` back-fill are the retro's leftovers. No
   migration is outstanding.
0. **M64 (current):** build stack A (parts 1 and 2) by `docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`,
   merged before the rehearsal (O6); stack B (parts 3 to 5) merges at the cutover (O8). Part 0 is
   `claude/caesura-neon-migration-b5c8f3` and merges last. Carried from M59: the Vercel pause and
   PR previews (M64 gate boxes). M59's deferred KIs stay open: KI-20261109-a, KI-20261109-b,
   KI-20261110-b, KI-20261110, KI-20261114-d. M53 follows M64.
1. Mitchell merges PR 679 (M44's part 0, prose only). Parts 1 to 5 are merged, so close no lower
   drafts. `migrate-production` is not needed: M44 added no migration.
2. **M58 closed 2026-11-06, gate 11 of 11**, and `0074` is applied. Follow-ups: KI-20261105-a
   and -b. **M53 follows M64** (*A search engine reads every public page the way a person does*).
   It is proposed and not scoped: scope it with Mitchell (`plan-a-milestone`, seven open
   decisions). M48 stays parked.
3. Open follow-ups from M44: KI-2026-11-03-a, KI-2026-11-02-a (the flaky `TripProvider.suggest`
   test) and the candidate *The share page shows a stop is booked*.
Then remove the orchestrator's `tc-orchestrator` guard file from the build session's git dir.
Earlier next action, still open: Mitchell merges M43's part 0 (PR 659) and M57's (PR 667) if not merged yet. Open follow-ups from M43:
KI-2026-11-01-s, -t, -u and -v; PR 660's hand-listed plural test (kept, his decision); part 5's
untested undated trip (his call). Hand tasks for Mitchell from M56: delete the stray remote branch `claude/m56-part5-ask-show-hand-off`
(`1449913`), and, in the old container only, the empty `/tc-orchestrator` at the filesystem root.
Open follow-ups from M56: KI-2026-10-30-a, -b, -c, -m and -p, KI-2026-10-28-e, whether
LocationIQ's `/v1/search` returns `name`, PR 655's unresolved CodeQL thread, and the live eval
(his call). Open follow-ups from M55: KI-2026-10-27-e to -i, and the candidate *Claude can search
for a cover photo* in `docs/candidates.md`. Open follow-ups from M54: KI-20261027-a to -c,
KI-20261026-x and -y, and KI-20261013-a's first-load gap. Open follow-ups from M49:
KI-20261025-w, and the candidate *Reposition a playbook day's cover*.
Open follow-ups from M52: KI-2026-10-24-a to -o (`docs/known-issues/open/`). Outside M52:
PR 491 (dependabot) is red, and GitHub reports 5 dependabot vulnerabilities on `main` (2 high,
3 moderate). The order is M58 (scoped 2026-11-04, building) → M53 (minted 2026-10-25 from an SEO audit, not scoped), with M48 parked.

**M48 is parked, not closed** (2026-10-19, Mitchell): gate 4 of 11, its open boxes wait on
flag-on plan turns, which M50's launch should bring. When it resumes, its no-traffic work comes
first: (1) ~~record the example count per plan turn in the M31 ledger~~ — built 2026-10-23
(`ai_usage.plan_examples`, migration 0066, `ai-usage` query 12); (2) paste the baseline (the `ai-usage` skill over plan turns before 2026-10-18);
(3) capture PR 470's red text for the playbook-filter box. `RAG_PLAN_RETRIEVAL=1` stays on in
production. Decisions 1 and 11 and both offline checks' pasted numbers are Mitchell's.

**Built off the milestone order, by Mitchell's approval (2026-10-17).** Three things were moved
up ahead of the row order, and each was his call. This is his waiver, recorded here once, of
*"do not build ahead of the current milestone"* (`AGENTS.md`) and of *"part 0 merges last"*
(`docs/guidelines/building-a-milestone.md`) for them:
- **Trip guests**: travellers who are not on the app (PR 457, its parts stacked into it,
  ADR-074, migration `0053`).
- **Plan-retrieval RAG, M48's serving code**: PRs 459-467, migration `0054`, pgvector in Neon
  (ADR-075). It serves behind `RAG_PLAN_RETRIEVAL`, which Mitchell turned on in production on
  2026-10-17 to let it prove itself on real plan turns (his walk is done). The Gate 1 recall eval
  (PR 461) merged on 2026-10-17 too, on Mitchell's call, so it can be re-run from `main`. M48 became current on
  2026-10-18, when M47 closed; its decisions and remaining gate boxes are in
  `docs/milestones/M48-plans-start-from-examples.md`.
- **M46's part 0**, PR 432, merged before the gate rather than last.

Also merged beside it: `docs/guidelines/building-with-judgment.md` (PR 468).

Order: `… M42 ✓ → M45 ✓ → M46 ✓ → M47 ✓ → M50 ✓ → M51 ✓ → M52 ✓ → M49 ✓ → M54 ✓ → M55 ✓ → M56 ✓ → M48 (parked) → M43 ✓ → M44 → M58 → M53`; the M51 reorder is in
`docs/milestones/README.md`, *2026-10-20 — minted: M51, ahead of M49*. Earlier closed milestones'
narrative is in `docs/retros/2026-10-16-status-archive.md`, `docs/retros/2026-11-14-status-archive.md`, `docs/retros/2026-11-21-status-archive.md` (M58 back to M52), `docs/retros/2026-11-24-status-archive.md` (M59) and each milestone's own file.

## Live rules that the code cannot enforce

Three standing facts, kept here because each is instruction rather than history and
nothing in CI will tell you when one is broken. The narrative each came from is in
`docs/retros/2026-09-11-status-archive.md`.

- **Merging applies a migration, before the deploy** (ADR-091, 2026-11-15).
  `deploy-production` migrates on every push to `main` and deploys nothing if that fails;
  `migrate-production` is the break-glass. Whether production is current is **computed, not written here**: `pnpm
  state`'s `PROD MIGRATIONS` line, or the row count of `drizzle.__drizzle_migrations` on the
  production branch against `apps/web/drizzle/meta/_journal.json`. *(This entry said
  "Production is at `0020`" for two weeks after `0021`-`0031` shipped; the one before it said
  `0018` was NOT applied after it was. A number in this file is a snapshot. The rule
  outlived three of them.)* Runbook:
  `docs/guidelines/content-bundles.md` for what `0018` unblocks (`--prune` against a bundle
  that has stopped declaring content).
- **The `ai-live` flag's dashboard fallthrough stays "Simulated" until release, then flips
  to "Live"** — ADR-019's **2026-09-13 amendment**, which reverses the 2026-09-08 rule that
  it must stay Simulated forever. Until the flip the old reasoning holds exactly: targeting
  only ever *widens*, a caller no rule matches falls through to the default, and that default
  is the only thing keeping anyone off. **The flip is safe only after M20's entitlement gate
  is live in production** — `selectAiModel` checks entitlement *before* the flag
  (`modelSelection.ts:215-218`), so a paid-account check becomes the spend control and the
  flag goes back to being an emergency disable. Flipping it early leaves an interval with no
  spend control at all. **That precondition was met 2026-09-14**: the gate is live in
  production and migrated, so the flip is now a decision rather than a dependency — and
  Mitchell's, not a session's. Note what it would expose today: every account that predates
  0019 holds a permanent `founder` grant, so the spend control binds on new accounts and not
  on those. After the flip, keep Production's rule list empty: a widening rule
  would make *the rule* load-bearing, and disabling in a hurry must stay one action. It lives
  in the Vercel dashboard and no test can assert any of it.
- **e2e refuses to start unless `AI_LIVE=false`.** `/api/health/ai-mode` reports
  `{ live, source }` and `e2e/global.setup.ts` requires `source: "env"` — an anonymous
  `live: false` from a *targetable* flag stopped being evidence about the signed-in user the
  specs sign in as, which had quietly broken what KI-25 bought. `.env.example` ships it; CI
  sets it in the workflow env.

## Blocking / broken right now

**Promoted out of the 2026-09-20 handoff on 2026-09-21.** These were live
inside a section that was 69% of this file, where nothing looks for a blocker.

* **Coordinates.** `KI-2026-09-20-d`. Every derivation above needs `lat`/`lng`
  and the seed has three. The gateway blocks the geocoder (403 to `CONNECT
  nominatim.openstreetmap.org:443`), so this cannot be closed from a cloud
  session. Two routes that do not need one: lift coordinates from the 19
  already-geocoded bundles under `content/` where the places overlap (Mexico
  City, Glen Coe, New York are plausible — CHECK, do not assume), or run the
  geocoder from a laptop per `docs/guidelines/content-bundles.md`.
* **The preview's database.** It has never had `content:import` run and is not
  reseeded by a deploy, so seed-side work stays invisible there until somebody
  with the credential reseeds it. Mitchell knows; it is his to do.

**1. The Map lens's tiles have still never been confirmed to paint.** KI-49,
the cloud-session half, is resolved (2026-09-24). The e2e suite no longer fetches
tiles at all: it serves a background-only fixture style at the real URL and
asserts that no request left for a third party. So the e2e suite never renders a
real basemap, by design. Confirming real tiles is now a written manual check on a
preview: `docs/guidelines/third-party-services-on-a-preview.md` → *Map tiles*.
The pixel caveat still holds. The WebGL canvas has captured blank in the
screenshot pipeline, so look at the page, not the capture. A blank canvas is not
a pass.

**A preview deployment is walkable from a cloud session, and the CSP defect that
found is fixed.** `pnpm --filter web walk:preview <url> [path ...]` —
`docs/guidelines/cloud-agent-sessions.md` carries the diagnosis, and that file's
old "the preview is NOT reachable from here" paragraph is gone; it was wrong and
it cost several runs. Three obstacles stacked: Deployment Protection, Chromium
not trusting the egress CA, and a TLS 1.3 ClientHello the `*.vercel.app` tunnel
cannot carry.

What the walk found is the point: **the CSP refused the Vercel Toolbar's loader
on every preview page**, which breaks the Flags Explorer — the documented way to
flip `ai-live` for one reviewer's session. M11's gate saw the same refusal and
filed it as harmless preview noise; it was not. The policy now admits the
Toolbar's origins on preview only, gated on `VERCEL_ENV`, with a test asserting
production's policy is untouched.

**No longer pending (M59):** previews moved to Coolify and are public, so the
Vercel Protection Bypass secret this paragraph asked for does not exist and is
not needed.

**The `_vercel_share` fallback was tested on 2026-08-30 and is not a substitute
— tried while looking for M18b's gate evidence.** A freshly minted link gets
*past* Deployment Protection and is then stopped by `429 Vercel Security
Checkpoint` at the redeem step, twice, five minutes apart, before any app
response. That is Vercel's anti-bot interstitial challenging the client —
headless Chromium on a datacenter IP — not rate limiting and not the protection
layer. It suits a person in a browser; it does not reliably suit the automated
walk. The bypass secret is honoured before the checkpoint renders, which is why
it is the only dependable route. `docs/guidelines/cloud-agent-sessions.md`
carries the detail. Treat the secret like `FLAGS_SECRET`:
it unlocks every protected deployment this project has.

**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Open, not gating

**Carried out of M24, not gating:** `KI-2026-09-25-q`. About a dozen
surfaces read `activity.location.city` directly, including the M14 ones this
section used to list (`placeOfDay`, weather, `select.ts`). Each still reads a
travel leg's origin by default. The KI's first step adds one activity-level
helper with no behaviour change. The PR that resolves it files the second step:
a start-vs-end decision per surface.

**Two operator items are open:** the production content re-import M12's gate
close owes (three corrected country codes), and, from M27,
`LOCATIONIQ_API_KEY` on Vercel (Production and Preview) — the Playbook pin
backfill does nothing without it.

**Waiting on Mitchell, not blocked.** Whether to flip `ai-live`; *Live rules* above says what
it would expose. M9's gate is closed, but its Phase 0 open questions were never answered
(`docs/milestones/M9-ai-planning-partner.md`, *open questions*). The one that costs if left is
*which quota window a sold ceiling binds*: it is implemented per-day and stated in no contract.
Also his, from the SEO pass (recorded 2026-10-02, not re-checked since): the Vercel firewall
bypass for the public pages, submitting the sitemap, and checking production's canonical on
`caesura.today/playbooks`.

**`KI-20260916-d` is still open**: no account can hold `api.tokens` on a
preview, so the next tier-gated box walked on a preview will meet it. The entry
carries the next step.

## Where the history went

| What | Where it is now |
|---|---|
| Everything this file said before 2026-08-28, verbatim and in order | `docs/retros/2026-08-28-status-archive.md` |
| This file's lines 243-1188 as of `845fc48` — the phone assistant (2026-09-05), M14's builder half, the 2026-08-30 three-PR stack | `docs/retros/2026-09-11-status-archive.md` |
| M9 Phase 0 — what each phase landed, the squash-merge hazard, the open questions | `docs/milestones/M9-ai-planning-partner.md`, ADR-043, and the design spec |
| M10 Wave 2, per phase — what each shipped, what it deliberately did not, the landing gaps that cost time | that archive, plus `docs/milestones/M10-visual-craft.md`'s scope, exit gate and Wave-2 retro |
| M15's gate and its two resolved open questions | `docs/milestones/M15-front-door.md` |
| Every roadmap reorder and its reasoning | `docs/milestones/README.md`'s reorder notes, and ADR-018 / ADR-021 / ADR-022 |
| The 2026-08-23 design sync, its routing, and the 2026-08-26 UI audit | `docs/design-feedback/` |
| The feature-flag / AI-kill-switch insert (PR #24) | ADR-019 and `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md` |
| The test-suite overhaul, Phases 0-4 | `docs/plans/2026-08-23-test-suite-overhaul.md`, `docs/testing-baseline.md`, `docs/testing-inventory.md` |
| Which known issues are open, and which were closed when | `docs/known-issues/` — authoritative, and the only place that list should be kept |
| The 2026-09-20 shared-day-map handoff (43,702 B) | `docs/retros/2026-09-21-status-archive.md` |
| The closed M12, M13 and M26-link-4b `DONE` sections, moved 2026-09-25 | `docs/retros/2026-09-25-status-archive.md` |
| The M11-gate retired list, the pre-M14 *Next action* history, *Landed in the last week* (2026-08-28 to 2026-09-11), and this header's cut history, moved 2026-09-30 | `docs/retros/2026-09-30-status-archive.md` |
| The M45 close-out, the closed-milestone narrative from M42 back to M14 (lines 61-232 as of `14cda86`), and the stale second *Next action*, moved 2026-10-17 | `docs/retros/2026-10-16-status-archive.md` |
| The M45, M46, M47, M50 and M51 close-outs, moved 2026-11-14 to bring this file back under its surface budget's headroom | `docs/retros/2026-11-14-status-archive.md` |
| The M58, M44, M57, M43, M56, M55, M54, M49 and M52 close-outs, moved 2026-11-21 to restore the surface budget's headroom | `docs/retros/2026-11-21-status-archive.md` |
| M59's section and its *Next action* item, moved 2026-11-24 when M59 closed folded into M64 | `docs/retros/2026-11-24-status-archive.md` |
