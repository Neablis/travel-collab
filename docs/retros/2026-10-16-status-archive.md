# STATUS and TODO archive — 2026-10-16

Moved here verbatim on 2026-10-17, from `docs/STATUS.md` and `TODO.md` as they stood at
`14cda86`, by Step 1 of `docs/reviews/2026-10-16-codebase-and-agent-architecture-audit.md`
(§4.1, and §4.3 cuts 2 and 3). `STATUS.md` was at 25,486 B against its 30,000 B surface
budget, 15 bytes under its retirement trigger.

Why each went (`docs/guidelines/retiring-a-rule.md`'s criteria):

1. **STATUS's M45 close-out paragraph** — history (2): M45's gate closed 2026-10-13, and its
   milestone file carries the gate evidence and the retro.
2. **STATUS's closed-milestone narrative, M42 back to M14** (lines 61-232 at `14cda86`) —
   history (2): every paragraph names a closed milestone whose file holds its retro. What was
   still live is carried forward in `STATUS.md`: the `KI-2026-09-25-q` carry, the operator
   items, and the SEO pass's three steps for Mitchell (as recorded 2026-10-02, not re-checked).
3. **The first paragraph of STATUS's second `## Next action`** — stale (5): it said *"Scope
   M43"* and *"All 48 migrations are applied"* while M46 was current and the journal held 55,
   and it called `KI-2026-10-04-c` pending, which has since been retired as obsolete (the cheap
   tier is `anthropic/claude-haiku-5.5`). It read: *"**Scope M43**
   (`docs/milestones/M43-notebooks-keep-up.md`) with Mitchell: answer its decisions against
   today's UI, then plan its parts (`build-a-milestone`). M42 is merged, with no migration. All
   48 migrations are applied. Separately, `KI-2026-10-04-c` resolves on query 8 of
   `ledger.sql` over a few days of cheap-tier step durations."* The rest of that section stays
   in `STATUS.md` as *Open, not gating*.
4. **TODO.md's closed-out history** (lines 105-191 at `14cda86`) — history (2): the test-suite
   overhaul's Phases 5-7 verdict, the seed-content entry, tasks 7.1, 7.2 and 7.4, and the
   `ci.yml` `changes` job, all done. So is the activity-field descriptor refactor the audit
   counted as live: it shipped 2026-09-21 as `KI-2026-09-05-o` (in `resolved/`). `TODO.md`
   keeps one line each for what is still live: task 7.5 and the Dependabot triage.

---

## 1. STATUS.md — the M45 close-out, as it was

**M45 closed 2026-10-13, gate 12 of 12**, on part 0, PR 420 (`claude/stoic-dijkstra-01wxup`).
The assistant answers across all your trips and takes you places:
- An account-scoped ask with four deterministic cross-trip tools (PR 421).
- The palette learns notebooks and runs a command by id (PR 422); the assistant names palette
  commands, and edit mode turns on only after Approve (PR 424, ADR-072).
- Home's rail and ⌘K's *Ask:* row (PR 426); the assistant on the playbook pages (PR 427).
- Fixes the live eval found: KI-2026-10-12-e (PR 425), and the trip-name matcher (PR 429,
  `8143772`, now on production).

No migrations. Both [walk] boxes are ticked on Mitchell's word ("Tested and worked"). The Home
walk shows in production's `ai_usage` as two `ask.account` turns. The playbook walk left no
production trace, so the ledger box closed without an `ask.playbook` row, on his call. Accepted
known gap: KI-2026-10-13-a (Ask at hydration on a phone). Gate evidence and retro:
`docs/milestones/M45-the-assistant-beyond-one-trip.md`. The plan is deleted.

## 2. STATUS.md — lines 61-232, as they were

**M42 closed 2026-10-12.** The front door shows more than one trip, and what it costs:
- `/demo/<slug>` for every bundled trip, with a picker on `/demo`; a demo opens on Plan (#411).
- Three plan cards and prices on the landing at `#pricing`, read from a generated snapshot of
  `planVersions.ts` (#405).
- Thirteen activity tags (twelve categories, Ticketed as a modifier), with bundled content
  re-tagged, API 1.13.0 → 1.15.0 (#406, #408, ADR-070).
- A trip or day description worked out from its tags, on five surfaces (#409); tag and city×tag
  pages, a Discover tag filter and Discover pagination (#412); four tag widgets (#410).
- Leaving a playbook review needs Plus or Premium (#407, ADR-071).
- The landing's feature blocks and phone claims render the real app, with Mitchell's Hanoi
  playbook as the Discover card (#413).

It shipped as #405–#413, all merged by 2026-10-12; part 0 is #404. CI on #413's head (`97c4d9e`,
run 38184850349, attempt 2) was green on every job, including both e2e shards. Mitchell walked it
after every part had merged. No migrations. Its retro is at the end of
`docs/milestones/M42-the-front-door-shows-more.md`.

**M41 closed 2026-10-11.** Moving and adding stops takes one gesture wherever you are: the
editor's Day field moves any stop, a drawer of just cards with double-click to create, the
empty-day hint, *"from Day N"* on a parked stop (API 1.12.0), Calendar's city-block drag, Plan's
day drag, Option-drag copy, top-edge resize and Delete, paste or drop to add, and a ⌘K palette
that runs the page's own actions (ADR-068, ADR-069). It shipped as #392–#398 (with #399), merged
into part 0, #391, which Mitchell merges to `main`. CI on #391 (`50d9a2d`, run 38103062053) was
green on every job, including both ci-like e2e shards, and Mitchell walked the preview with the
mouse and keyboard only. No migrations. Its retro is at the end of
`docs/milestones/M41-planning-without-friction.md`.

The README had stamped M41–M47 *"scoped 2026-10-07, all six decisions answered"* by a bulk edit.
Corrected 2026-10-10: **M42–M47 are not scoped**, and each needs its decisions checked against
today's UI before building, as M41's were.

**M40 closed 2026-10-10.** A big change is reviewed, taken and undone whole:
- *Accept all* is one batch, so one History entry and one undo (#376).
- Named snapshots save, preview and restore in one undoable step (#377).
- An assistant turn of several changes is stored as one suggestion on the board, after a
  "Before: …" snapshot. Its note in the chat offers *Accept all* too (#378, ADR-067).

Found on the way:
- #379 moved CI's Postgres image to ECR Public.
- #381 draws a suggested new day as a ghost day.
- #382 refuses a turn on a deleted trip.

Migrations `0045_trip_snapshots` and `0046_suggestions_via` are applied (`migrate-production` runs
43 and 44, on #377's and #378's merges). The ci-like e2e passed 292 of 292, with no retries, on merged
`main` (`b8fb9aa`). Its retro is at the end of
`docs/milestones/M40-a-big-change-is-one-change.md`.

**M39 closed 2026-10-09.** The phone layout was decided once, in the critique (#362). It shipped
as Parts 1–7 (#363–#369, plus #371 for Part 7's self-review), all merged 2026-10-09:
- one pinned header row with the day rail;
- a touch floor on touch screens;
- a phone Overview and a phone conflicts chip;
- safe-area insets;
- an installable app, with the two-stroke icons (#372) and an *Install app* row and one-time
  phone nudge (#373).

The hotfix #374 removed the service worker's `fetch` listener, which had lost edits queued at a
reload in production (`KI-2026-10-09-e`). The ci-like e2e passed 290 of 290 on `814f469`. The
device walk was **Android only**, by Mitchell's call: the iPhone half is open as
`KI-2026-10-09-f`. Its retro is at the end of `docs/milestones/M39-the-phone-is-decided.md`.

**M38 closed 2026-10-08.** People carry a chosen avatar, colour and display name on every person
surface. A clash within a trip shifts the later joiner. A chosen name reaches public pages only
when its owner opts in. An invitee sees the plan, who is going and the total before joining, drawn
by the shared notebook widgets. It shipped as #356 → #360, merged 2026-10-08, and every code part
was reviewed by CodeRabbit. Its retro is at the end of
`docs/milestones/M38-people-you-can-tell-apart.md`. Migration `0044_personas` is applied:
`migrate-production` ran on `b10f513`.

**M37 closed 2026-10-07.** Trip cards show length and stops, and an unplanned trip is designed.
Trips and playbook days get Unsplash covers. It shipped as #350 → #354, merged 2026-10-07, with a
self-review and a CodeRabbit review on every code part. Its retro is at the end of
`docs/milestones/M37-trips-look-like-somewhere.md`. Migrations `0042_trip_covers` and
`0043_saved_day_covers` are applied: `migrate-production` ran on `eeef6cc`.

**M35 closed 2026-10-06.** Migration `0039` is confirmed applied from `migrate-production` run #37
on #335's merge. CodeRabbit never reviewed #335, so there was nothing to work. The eval re-run is
ticked on Mitchell's word and was **not** run. Its retro is at the end of
`docs/milestones/M35-travellers-and-people.md`.

**M37 to M47 were proposed on 2026-10-06** by grouping the candidates file, and placed after M35 in
that order. The order was confirmed the same day, and **M37 is scoped**: its six decisions were answered as
recommended. M38 was scoped 2026-10-07, M39 on 2026-10-08 and M40 on 2026-10-09; M41–M47 are not scoped yet. Grouping and order:
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*.

**M36 closed 2026-10-06** on Mitchell's word that the admin console works; its two walk boxes are
ticked on that attestation, not re-walked. Its retro is at the end of
`docs/milestones/M36-operator-console.md`.

**M34 and M9 closed 2026-10-06** on Mitchell's word that both work in production; their walk
boxes are ticked on that attestation, not re-walked. **M9 is closed for good**, not paused: two of
its boxes asked for an artefact (a pasted `meta`, a recorded transcript) that was not added, and
are ticked by decision. Each retro is at the end of its milestone file.

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
2026-10-04**, at 20 of 20 and 9 of 9; each retro is at the end of its milestone file. Their
ticked rows were added to `TODO.md` on 2026-10-06, so `pnpm milestones` reads them as closed.

**Built beside M19, not a milestone: the SEO pass** (five stacked draft PRs, #295-#299,
to merge 1 → 5 with merge commits; plan `docs/plans/2026-10-02-seo-pass.md`). It adds robots
and canonicals, a sitemap, server-rendered day and Discover pages with real 404s and
slugged URLs, JSON-LD, and city and country pages. **Three steps are Mitchell's:** the
Vercel firewall bypass for `/`, `/welcome`, `/playbooks/**`, `/robots.txt` and
`/sitemap.xml` (crawlers get the Security Checkpoint today); submitting the sitemap once
part 2 is live; and checking production's canonical on `caesura.today/playbooks`.

**M35 — who is travelling, and the People panel — minted 2026-10-05, after it was built** beside
M33 and M34 (PR #335, one branch `ccr-d8e97d98-xyat7o`, T1–T9, not restacked by Mitchell's call;
plan `docs/plans/2026-10-05-travellers-and-people-panel.md`). Gate:
`docs/milestones/M35-travellers-and-people.md`. **Gate closed 2026-10-06, 12 of 12.**
Per-person totals count travellers, not members (ADR-065, amending ADR-060 decision 2). Trip
settings → People replaces the Travelers panel, and the owner's open panel now sees a join
(KI-2026-10-04-b, resolved). **Migration 0039** is applied (run #37). Open from it: `KI-2026-10-05-e`, `-f` and `-g`.

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

## 3. TODO.md — lines 105-191, as they were

## Deferred work with a resume condition that has already fired

Not a milestone, and not a candidate idea — work that was consciously paused
behind a named trigger, where the trigger has since happened. Listed here
because the only thing that recorded it was a paragraph in `docs/STATUS.md`
marked "history", so nothing live surfaced it and nobody resumed.

- **Test-suite overhaul, Phases 5-7 — CLOSED OUT 2026-08-31.** Phases 0-4
  landed 2026-08-23; 5-7 were gated on M10 Wave 2's gate, which closed
  2026-08-27 with nothing resuming. The required Phase 0 re-inventory was run
  (`docs/plans/test-overhaul/phase-5-inventory-2026-08-30.md`) and the verdict
  is per phase, not wholesale:
  **Phase 5 superseded** — the suite is 138 files / 1,908 tests against the
  overhaul's 95/569 baseline, but reading the candidates rather than ranking
  them, category (c) is empty, (a) is 7 assertions, (b) is 60, and (d), the big
  lever at a claimed 152 tests, is nine false positives. The suite tripled
  because the product tripled; volume is real, waste is not.
  **Phase 6 absorbed** — 6.4 was `check-sleep-wall.mjs` (since 2026-09-25 the ESLint rules `playwright/no-wait-for-timeout` and `no-restricted-properties` on `waitForTimeout`, fixtured in `check-lint-wall.mjs`), 6.5 is AGENTS.md's
  property-test rule plus `witness.ts`, whose last gap (three `fast-check`
  files with no floor) was closed 2026-08-30 with measured, non-vacuity-proven
  floors.
  **Phase 7 is NOT closed** — see the two live items below.

- **The activity-field descriptor refactor — unattached since 2026-08-31.**
  Project review §6.1. Scheduled 2026-08-29 "alongside" M11a and M11b; both
  gates closed 2026-08-31 and it did not happen, so it belongs to no milestone
  and nothing surfaced it. **Recorded here 2026-09-11** because the only thing
  carrying it was `docs/STATUS.md`'s "Next action" — the precise failure this
  section exists for, repeated. It is **not blocked**: its stated prerequisite
  is already met (§1.6 / KI-54 resolved, `equality.ts:55-56` compares `city`
  and `countryCode`). `AGENTS.md` reserves the contracts step as **its own
  reviewed PR**, which Mitchell scheduled it knowing — so keep it separate from
  any milestone PR.
- **The 19 Dependabot alerts.** Per-advisory triage against actual usage, not a
  bulk bump. Deferred deliberately; recorded here 2026-09-11 for the same
  reason as the item above.

## Live, and previously hidden inside a closed-out plan

- ~~**Seed content is code, so there is not much of it**~~ — **done 2026-09-06**,
  branch `claude/serialize-and-seed-data-66f8tb`, **ADR-041**. Mitchell asked for
  a JSON serialization for notebooks, activities and trips, an importer, and *"a
  lot of believable playbooks"*. `travel-collab/content-bundle/v1` +
  `pnpm --filter web content:import` + **148 playbook days over twenty regions**
  and four demo trips, all in `content/` — including San Francisco, Napa,
  Capitola/Monterey and the Finger Lakes, which Mitchell named on the night. `saved_days.author_kind` (migration `0017`)
  is the human-vs-AI flag he asked for, surfaced as an "AI starter" badge.
  **It closed a real gap**: Discover's budget filter had no occupant in three of
  its four bands anywhere in the seed — the thing `starterDays.ts`' own header
  flagged and said it was too small to fix. All four are populated now.
  What it left open, on purpose: **`KI-2026-09-06-c`** — imported stops carry no
  coordinates (a wrong pin is worse than none; KI-39 measured that once already),
  so the four demo trips read "N stops have no place yet" on the Map lens until
  somebody runs an offline geocoding pass on the model of
  `scripts/geocode-japan-seed.mts`. The playbook days are unaffected — Discover
  matches on `location.city` and all 1,375 stops carry one. And
  **`KI-2026-09-06-d`** — the later bundles were written without live web access,
  so their prices and opening hours need a verification pass; each says so in its
  own `bundle.sources`.

- ~~`docs/guidelines/testing.md` does not exist~~ (7.2) — **done 2026-09-02.**
- ~~No `write-a-test` skill~~ (7.4) — **done 2026-09-02.**
- ~~Task 7.1's lint rules~~ — **done 2026-09-02**, and the reason it was still
  live is worth keeping: 7.1's header had said *landed* since 2026-08-31 on the
  strength of four unrelated walls in `scripts/`. Five of its six rows had
  shipped as nothing. **A task marked done by substitution is worse than one
  marked open** — nothing was looking for it. Two of the six rows are now
  rejected in writing rather than left implied (`randomUUID` breaks the
  integration lane's row isolation; the `TripDetail` row needs type information
  ESLint does not have).
- **Task 7.5 — close out the plan.** The last live item in the test overhaul.
  `ADR-021-testing-strategy.md` does not exist, and it is the thing that stops
  a future session re-proposing the three levers already evaluated and
  rejected: `isolate: false` (248 failures), a coverage-percentage gate, and a
  permanent mutation-testing CI job. Then `docs/plans/2026-08-23-test-suite-overhaul.md`
  and `docs/plans/test-overhaul/` are removed in the same commit, per
  `docs/plans/README.md`. Own PR. **Do not delete the directory without writing
  the ADR first** — the rejected levers are the durable half.
- **DONE 2026-10-04 — `ci.yml` has a `changes` job and `ci-ok` is the one
  required check on `main`.** What it was: Convert `ci.yml`'s `paths-ignore` to a skip-job pattern BEFORE enabling
  branch protection. The repo went public 2026-08-31, so branch protection is
  now available (`gh api .../branches/main/protection` returns "Branch not
  protected", not the old "Upgrade to GitHub Pro"). The moment a path-filtered
  job is made a *required* status check, every prose-only PR is unmergeable
  forever — a required check that never runs never reports. A job that runs and
  skips does report, which is the fix. `docs/guidelines/ci-cost-and-capacity.md`
  carries the detail. **Do this before flipping required checks on, not after.**
