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

**M52 — The trip comes with you — is the current milestone: parts 1–10 merged, part 11 in
review; the gate (10 of 13) waits on part 11 and Mitchell** (`docs/milestones/M52-the-trip-comes-with-you.md`).
Parts 1–10 merged 2026-10-23/24 (PRs 530–537, 539, 540, and PR 541, part 9's follow-up),
migrations `0062`–`0065` applied in production. **Part 11** is PR 542
(`claude/m52-part11-today-weather-settings`; r1 changes requested, fix in progress), from
Mitchell's 2026-10-24 decisions (M52 decisions 9 and 10, amended; ADR-080 amended): Today's
weather and sunrise/sunset on the real day at the nearest trip day's place, *Weather Report* and
*Sunrise/Sunset* as two sections, and notebook settings superseding widget settings
(`NOTEBOOK_SETTINGS`), which reverses "an explicit binding still wins" and reopened the
Today-scope box. Part 0 is PR 529 (`claude/serene-tesla-quoyte`, draft), carrying the boxes and
the retro; the plan is deleted. `pnpm milestone close M52` refuses on the three open boxes, as it
should.

**Next action:** (1) Finish part 11's review round and merge PR 542; tick the Today-scope box on
its merged CI. (2) Mitchell runs the live M33 eval from `main` (PR 534's day-of cases; box 8).
(3) The [walk] on a phone with a trip dated today, which also covers: a two-member trip's *No
messages yet* opening the chat (a free preview account cannot invite, 402); `@assistant`'s reply
under Auth.js `auth()` inside `after()` on production; PR 537's final head and PR 541 unwalked.
(Mitchell confirmed on 2026-10-24 that Today cannot be deleted on production and that part 10's
API works on a deployment.) Then tick the boxes, `pnpm milestone close M52 --confirm`, mark PR 529
ready, and Mitchell merges it. After M52 the order is M49 → M43 → M44, with M48 parked.

**M51 closed 2026-10-22, gate 11 of 11**, on Mitchell's ruling at the close: his walk at 390, 1440
and 3440 works, and the parts are merged (PRs 506–511, 513, 514, 516; part 0 PR 505 merged early;
follow-up tweaks PR 518). Three things left the gate as known issues: the landing's signup →
new-trip path (KI-2026-10-22-a), re-proving the gate's red evidence after the test-pruning pass
(KI-2026-10-22-b), and checking the sea's links against production (KI-2026-10-20-c). Closed with
`--no-spend`. Evidence and retro are in `docs/milestones/M51-the-front-door-tells-the-story.md`.

**M50 closed 2026-10-19, gate 11 of 11** (part 0 PR 493). Parts are PRs 494-501 and 503 (part 9,
from Mitchell's walk), migrations `0060` and `0061`, both applied in production; ADR-079. Five
boxes are ticked on Mitchell's walk of the landing page (his ruling, option a). Evidence, retro
and spend are in `docs/milestones/M50-strangers-find-a-day.md`.

**M48 is parked, not closed** (2026-10-19, Mitchell): gate 4 of 11, its open boxes wait on
flag-on plan turns, which M50's launch should bring. When it resumes, its no-traffic work comes
first: (1) ~~record the example count per plan turn in the M31 ledger~~ — built 2026-10-23
(`ai_usage.plan_examples`, migration 0066, `ai-usage` query 12); (2) paste the baseline (the `ai-usage` skill over plan turns before 2026-10-18);
(3) capture PR 470's red text for the playbook-filter box. `RAG_PLAN_RETRIEVAL=1` stays on in
production. Decisions 1 and 11 and both offline checks' pasted numbers are Mitchell's.

**M47 closed 2026-10-18, gate 7 of 7**, on Mitchell's production test-card walk (ticked on his
word). Parts are PRs 474, 476, 477 and 475, migrations `0055` to `0057`; part 0 PR 473. Evidence,
retro and spend are in `docs/milestones/M47-the-business-over-time.md`.

**M46 closed 2026-10-17, gate 10 of 10** (part 0 PR 472, after PR 432 merged early). The last box,
the two-person walk, is ticked on Mitchell's confirmation that day. Evidence, retro and the
`list_sessions` spend block (closed with `--no-spend`: the transcripts were gone) are in
`docs/milestones/M46-a-trip-has-a-conversation.md`. Parts 1 to 6 and the walk fixes are PRs 433,
435, 436 and 438-447, migrations `0048` to `0052`.

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

**M45 closed 2026-10-13, gate 12 of 12** (part 0 PR 420); evidence and retro in
`docs/milestones/M45-the-assistant-beyond-one-trip.md`. Accepted gap: KI-2026-10-13-a.

Order: `… M42 ✓ → M45 ✓ → M46 ✓ → M47 ✓ → M50 ✓ → M51 ✓ → M52 → M48 (parked) → M49 → M43 → M44`; the M51 reorder is in
`docs/milestones/README.md`, *2026-10-20 — minted: M51, ahead of M49*. Earlier closed milestones'
narrative is in `docs/retros/2026-10-16-status-archive.md` and each milestone's own file.

## Live rules that the code cannot enforce

Three standing facts, kept here because each is instruction rather than history and
nothing in CI will tell you when one is broken. The narrative each came from is in
`docs/retros/2026-09-11-status-archive.md`.

- **Merging does not apply a migration.**
  `gh workflow run migrate-production.yml -f confirm=migrate`, from `main`, is the only thing
  that applies one. Whether production is current is **computed, not written here**: `pnpm
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

**One thing is still Mitchell's to do, and nothing unattended can test a preview
until it is done:** generate **Protection Bypass for Automation** (Vercel → the
project → Settings → Deployment Protection) and copy the value into a
`VERCEL_AUTOMATION_BYPASS_SECRET` repo secret.

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
