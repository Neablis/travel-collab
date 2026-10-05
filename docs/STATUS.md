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

**M34 — ADDING A STOP SUGGESTS WHAT OTHER TRAVELLERS DID NEARBY — IS THE CURRENT MILESTONE AS OF
2026-10-05**, by **M33's gate closing at 6 of 6**. Order: `… M31 ✓ → M32 ✓ → M33 ✓ → M34`
(M9 stays paused). The add-stop sheet lists stops from other people's published days in the same
city, closest first, and a pick fills name, place, length, kind and tags. It replaces the
*"Example match"* Preview, which had been filed under M9. A three-part draft stack:
`docs/plans/2026-10-05-M34-nearby-stops.md`. (`docs/milestones/M34-nearby-stops.md`)

**M33 closed 2026-10-05** on Mitchell's word, with every box but the retro already ticked. Its
retro is at the end of `docs/milestones/M33-evals.md`.

**M32 closed 2026-10-05** on Mitchell's production walk, same trip as the 162-second turn: one
`find_free_time {"wholeTrip": true}` call, two steps of 734 and 780 ms, 4.5s end to end, and
*"Day 8 … 660 minutes open between 8 am and 10 pm"* where the old turn said *"21 hours"*. Its
retro is at the end of `docs/milestones/M32-free-day.md`.

**M31 closed 2026-10-05** on Mitchell's two answers: a **$20/month** Gateway spend budget, and
the baseline accepted as two hand-typed production turns rather than a preview live-set run. Its
retro is at the end of `docs/milestones/M31-assistant-ledger.md`. **The eve port is deferred
until there are users** (ADR-062 § *Deferred: the port*). M19's leftovers, none gating:
`KI-2026-09-24-p` (totals add across currencies), `KI-2026-09-24-q` (a stored `person` filter
widens to the whole trip), and free vs unknown (KI-82).

**M33 — evals — minted and built 2026-10-05, beside M31 and M32.** `pnpm --filter web eval` runs the
live set on production's per-tier models through the real `/ask` handler and scores each turn by
code (needs `TRAVEL_COLLAB_EVAL_KEY`). It showed M32 working before merge (0/3 → 3/3 on
`q-most-free`), and found that a tool error the model recovers from was recorded as a failed turn
(`KI-2026-10-05-a`, `KI-2026-09-16-a`, both fixed on #327). With the turns recorded honestly, the
cheap tier's model stalls inside single steps (134.5s in one): `KI-2026-10-04-c`. **Mitchell switched
`AI_MODEL_CHEAP` to `zai/glm-5.3-flash` on 2026-10-05**; the KI stays open until production's step
durations show it held. Every run states its plan without `EVAL_CONFIRM=1` and stops at
`EVAL_MAX_USD` (seen live: $0.0027, two turns skipped). (`docs/milestones/M33-evals.md`)

**M29 (the time river) and M30 (notebooks with one job each) closed their gates on
2026-10-04**, at 20 of 20 and 9 of 9; each retro is at the end of its milestone file. Neither
has a row in `TODO.md`'s order, and placing them there is Mitchell's call.

**Built beside M19, not a milestone: the SEO pass** (five stacked draft PRs, #295-#299,
to merge 1 → 5 with merge commits; plan `docs/plans/2026-10-02-seo-pass.md`). It adds robots
and canonicals, a sitemap, server-rendered day and Discover pages with real 404s and
slugged URLs, JSON-LD, and city and country pages. **Three steps are Mitchell's:** the
Vercel firewall bypass for `/`, `/welcome`, `/playbooks/**`, `/robots.txt` and
`/sitemap.xml` (crawlers get the Security Checkpoint today); submitting the sitemap once
part 2 is live; and checking production's canonical on `caesura.today/playbooks`.

**Built beside M33, not a milestone: who is travelling, and the People panel** (one branch,
`ccr-d8e97d98-xyat7o`, T1–T9; plan `docs/plans/2026-10-05-travellers-and-people-panel.md`).
Per-person totals count travellers, not members (ADR-065, amending ADR-060 decision 2). Trip
settings → People replaces the Travelers panel, and the owner's open panel now sees a join
(KI-2026-10-04-b, resolved). It carries **migration 0039**, which has to be dispatched after
merge. Open from it: `KI-2026-10-05-e`, `-f` and `-g`.

**M28 — Three kinds — closed 2026-09-26** (#238, #239): a stop's kind is
`planned`, `pending` or `transit`, and the retired `idea`/`hold`/`booked` are
read back as their replacement (ADR-054). Its retro is at the end of
`docs/milestones/M28-three-kinds.md`. Open, not gating: the Pending badge's
amber matches the Meal tag's, which Mitchell's queued design handoff decides.
M24 shipped as #229, #230, #232 and #233. Its retro is at the end of
`docs/milestones/M24-travel-legs.md`, and what it left open is
`KI-2026-09-25-q` (surfaces that read a stop's city directly, first a shared
helper and then a start-vs-end decision per surface).

## CLOSED 2026-10-01 — M14 Rich layer, pulled ahead of M24; gate 22 of 22

Mitchell's call, 2026-09-24: build all of M14 ahead of M24. It shipped as four
stacked PRs: #222 → #223 → #226 → #221. **The gate closed 2026-10-01.** On
2026-09-27 Mitchell settled the insert Sheet box (a fixed sample preview, as
ADR-037 says) and accepted the six widgets on their e2e and ADR-052 as built. On
2026-10-01 he attested the real-service weather walk. The retro is at the end of
`docs/milestones/M14-rich-layer.md`. `docs/retros/2026-09-24-m14-stacked-prs-retro.md`
is the *process* retro. The route map block is unblocked by M24 but unbuilt and
unowned.

**Operator items: both done** (verified 2026-09-27, three days after this file
last called them outstanding). Production has `0000`-`0031` (runs #29/#30), and
`EXTERNAL_DATA_CONTACT` is set for all three Vercel targets. Migration state is
now `pnpm state`'s computed `PROD MIGRATIONS` line; don't restate it here.

Branches cut from `main` before #221 still carry the part-3 version of
`m14-notebook-widgets.spec.ts` *"a sentence inserted mid-sentence…"*. That
version fails about 3 times in 20: it types into a repeat node view before
React has mounted its editable line, and loses the first keystrokes. Merge
`main` into those branches; `main`'s version passed 20 of 20. Known carriers
are `claude/optimistic-shannon-tce4t8` and `claude/ecstatic-villani-13d488`.
The mechanism is in `docs/guidelines/testing.md` § *Copy these → E2E*.

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

## Next action

**M34, part 2 then part 3** of the stack in `docs/plans/2026-10-05-M34-nearby-stops.md`. The
walk box is Mitchell's, on part 3's preview. Separately, `KI-2026-10-04-c` resolves on query 8 of
`ledger.sql` over a few days of cheap-tier step durations.

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

**Waiting on Mitchell, not blocked.** Whether to flip `ai-live` now that its
precondition is met (*Live rules* above says what it would expose), and M9
Phase 0's three open questions (`docs/milestones/M9-ai-planning-partner.md`,
*open questions*). The second, *which quota window a sold ceiling binds*, is
the one that costs if left: it is implemented per-day and stated in no
contract.

**M9 is built; what is left is its gate**: a live model call, the Rochester
re-run resting on one, and the browser walks.

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
