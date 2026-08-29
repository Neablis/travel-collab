# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**This file is live instruction only, and it is kept short on purpose.** It hit
1,779 lines on 2026-08-28, ~88% of it history, in the one file every session is
told to read first — so a first-read file became a file people skim. The rule
now: **at gate close, a phase's narrative moves to its milestone file or a retro
in the same commit, and this file keeps the pointer.** Everything that was here
before 2026-08-28 is in `docs/retros/2026-08-28-status-archive.md`, verbatim and
in order, with an index mapping each part to its durable home. Nothing was
deleted.

**Local dev recipe:** `AGENTS.md` points here for it; it is not restated here,
because two copies drift. `docs/guidelines/cloud-agent-sessions.md` is the one
to read in a container (native Postgres on :5433, Playwright's browsers, what is
different from a laptop), and `docs/guidelines/building-the-parts.md` is the
general setup.

## Where the work is right now

**M11 — "Sharing, invites, and a trip you can hand to someone" — is the current
milestone and is in flight.** Mitchell scheduled it 2026-08-27 ahead of M18's
remaining surfaces and ahead of M16; `docs/milestones/M11-sharing-and-invites.md`
carries that decision, and `docs/milestones/README.md` and `TODO.md` are
reconciled to it. It also absorbed M13's invites/roles/revocation scope, leaving
M13 with near-real-time sync and its transport ADR.

**Links 1-6 landed 2026-08-28 via PR #71** — users/identity (ADR-025), roles and
access, invites (ADR-026), pinned share links (ADR-027), clone-with-lineage
(ADR-028) and saved days (ADR-029). **Its gate has not been run:** one of nine
exit-gate boxes is ticked, and PR #71's own review
(`docs/reviews/2026-08-28-m11-pr71-review.md`) still has open findings against
it.

**M18 is started but not current.** Its contract PR landed 2026-08-27 (PR #63):
`ActivityKind` and `ActivityTag` are real fields on the commands, both V1 event
payloads and `ActivityView`, with no migration — the payload additions default,
so every stored event replays as `planned` / `[]`. The dependent surfaces
(Calendar transit split, `N to book`, the home-hero tile, `act.badge`, tag chips
and the filter row) are PR 2+ and sit behind M11.

**Done:** M0-M8, the Phase 1 gate review, M10 (Wave-2 gate closed 2026-08-27)
and M15 (gate closed 2026-08-26, PR #56).

**M17 "Account customization" is approved and deliberately unplaced** — see
`docs/milestones/README.md`. Re-scope it before scheduling it: M11 link 1
already shipped the `users` table its file frames as the deliverable.

**`/demo` is the real board, read-only, 2026-08-28 (PR #79) — ADR-031, closes
KI-61.** The demo trip is now the Japan fixture folded in memory and served
through the ordinary trip endpoints, rendered by the ordinary `TripBoardScreen`;
`DEMO_SHARE_TOKEN`, `readFeaturedShare` and `GET /api/shares/featured` are gone,
so a preview branch validates its own front door with no manual step. One seam
did it: `requireTripAccess` answers the demo before `auth()`, as a viewer, so
all four read routes serve it publicly and none of them changed.

It also gated the invited-viewer board on the way past — `readOnly` threads from
`TripProvider`'s gate into Board, Column, ActivityCard, TimelineLens,
OverlapWarning, ConflictBanner and UnscheduledRack. That work arrived
independently of this branch's own gating of the same components (PR #71 review
§5) and won on merge, being the browser-walked one; what this branch adds on top
is `MapLens` (double-click-to-create calls `openCreate` directly, so no
`onSelectActivity` withholding reaches it), the `onCommand` seam, and the rack's
drag registration, which #79's message lists as covered but does not gate.

**Next 16 and Vitest 4 landed 2026-08-28 (PR #77)**, closing the postcss and
sharp advisories that a `next@15` pin was holding open. Two things every session
needs from it: `src/middleware.ts` is now `src/proxy.ts` (Next 16's name; the
ADR-024 lint wall and the preview-registry entry-point regex moved with it), and
the node/jsdom test split is expressed as vitest `projects` — Vitest 4 removed
`environmentMatchGlobs` entirely, and dropping the split rather than migrating
it would have silently cost the whole Phase 0 saving with nothing red.

**In flight on this branch (`claude/project-review-plan-xnsmw1`):** remediation
of the two 2026-08-28 reviews, per `docs/plans/2026-08-28-review-remediation.md`.
Landed so far — the revoke/accept race and invite-metadata leak, the rejected-
fetch send-queue wedge, dev-login environment gating plus security headers, the
AI prompt cap and AI/geocode spend meters, and the repo's own tooling no longer
teaching what the repo bans.

## Blocking / broken right now

**1. ~~Migrations 0006-0010 are merged and undispatched to production.~~ CLEARED
2026-08-29 — production is at 0010.** Two dispatches, both green: run 1
(2026-08-28 21:58, at `63f83ff`) applied 0006-0009, the M11 tables whose absence
made `recordSignIn`'s untry/catch'd upsert throw sign-in itself; run 2
(2026-08-29 02:41, at `d41af2e`) applied **0010 `rate_limit_counters`**, which
landed with PR #78 after run 1 and is why one dispatch was not enough. Without
it the quota limiter fails closed and every AI and geocode request 503s — a
visible outage rather than a silent hole, by design.

**The rule that produced this, unchanged and worth re-reading: merging does not
apply a migration.** A merged migration sits pending until someone dispatches
`migrate-production.yml` from `main` with `confirm=migrate`, and the check that
a migration is outstanding is comparing `apps/web/drizzle/*.sql` on `main`
against the `head_sha` of the last successful run — not the absence of a
complaint. See `docs/guidelines/environments-and-deploys.md`.

**2. `/s/featured` dead-ends on every environment — KI-61.** The landing page's
most prominent secondary CTA resolves through `DEMO_SHARE_TOKEN`, which is unset
everywhere and has no token to be set *to*, because the seed creates no share.
`.env.example` now documents the variable (added 2026-08-28, commented out),
which closes one of KI-61's three gaps and leaves the other two. The e2e suite
asserts the empty state, so CI is green *because* nothing is configured. Needs a
decision (a committed, guessable demo token vs. a seed-time random one), not a
fix.

**3. The Map lens cannot be visually verified from a cloud session — KI-49.**
The egress proxy blocks the tile host, so the map's chrome can be walked and its
tiles cannot. Nothing on the roadmap is blocked by it; it bounds what a browser
walk from here is allowed to claim.

**4. ~~The CSP has never been executed by a browser — KI-66.~~ CLEARED.** Walked
locally 2026-08-28 (twenty surfaces, zero violations, enforcement proved with a
control probe) and on a **real preview** 2026-08-29, which found the one thing a
local walk structurally cannot: the Vercel Toolbar's loader refused by
`script-src`, breaking the Flags Explorer workflow. Fixed preview-only and
pinned by `apps/web/next.config.test.ts`. What remains open in KI-66 is the
`'unsafe-inline'` weakening itself, which is accepted and recorded, not a gap.

**A preview deployment is now walkable from a cloud session** —
`pnpm --filter web walk:preview <url> [path ...]`. Three obstacles stacked
(Deployment Protection, Chromium not trusting the egress CA, and a ClientHello
the `*.vercel.app` tunnel cannot carry); `docs/guidelines/cloud-agent-sessions.md`
carries the diagnosis and that file's old "the preview is NOT reachable from
here" paragraph is gone. It was wrong, and it cost several runs. The durable
CI half still needs one click from Mitchell: generate **Protection Bypass for
Automation** in the Vercel project's Deployment Protection settings and mirror
the value into a `VERCEL_AUTOMATION_BYPASS_SECRET` repo secret. Until then only
the interactive 23-hour share-link route works, and nothing unattended can test
a preview.

**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Next action

**Finish the review-remediation branch and open its PR as a draft**
(`docs/plans/2026-08-28-review-remediation.md` has the wave table and the file
scopes). Wave 1's five agents have landed as commits; Wave 2 was running in one
tree with disjoint scopes when this was written, and **Wave 3 — the testing loop
and the small refactors — had not started** (nothing had touched
`vitest.unit.config.ts`, `playwright.config.ts` or the §6.2 files). Check
`git log` against that plan's table rather than trusting this sentence; it is
the one line here with a half-life measured in hours. Per `AGENTS.md`, open the
PR as a draft, mark it ready only when you believe it is green, then
`gh pr checks <n> --watch --fail-fast`.

**Then M11's gate**, which is the first thing that needs a human: eight of its
nine exit-gate boxes are unticked, PR #71's review findings are open, and the
gate cannot honestly close while the migrations behind it are undispatched.

**Deliberately deferred, each recorded where it belongs rather than dropped:**

1. **The activity-field descriptor refactor** (project review §6.1) — the right
   call, but a `packages/contracts` change is its own reviewed step and it
   touches ten sites plus the shared property generator. Its own PR.
2. **The test-suite overhaul's Phases 5-7.** Their resume condition — M10's
   Wave-2 gate closing — fired on 2026-08-27 and nothing resumed. Now surfaced
   in `TODO.md` under "Deferred work with a resume condition that has already
   fired", because the only thing recording it was a paragraph in this file
   marked "history". Re-run the Phase 0 inventory first; the current one
   predates Wave 2 Phases 5-8.
3. **The 19 Dependabot alerts** — per-advisory triage against actual usage, not
   a bulk bump.
4. **M17's re-scope** — see above.

## Landed in the last week

Compressed on 2026-08-28. Each line names the durable record; the long-form
narrative is in `docs/retros/2026-08-28-status-archive.md`.

- **A binding operating contract for dispatched subagents, 2026-08-28.**
  `.claude/protocol/` — lifecycle, three exit states, a two-strike handback
  rule, a run-scoped board and a mechanically checked report shape, enforced by
  four fail-open hooks. `ADAPTER.md` and `adapter.json` hold every
  travel-collab-specific fact and a test enforces that the other three files
  name nothing about this repo. Start a run with `/dispatch`. Design:
  `docs/specs/2026-08-28-subagent-operating-contract-design.md`. Known defects
  consciously left: KI-62, KI-63.
- **A travel day is no longer a false conflict, 2026-08-28 — KI-60.** The Japan
  demo went from 12 conflicts to 2 with no fixture change: `detectConflicts`
  compared every same-day located pair against a flat 150km and never read
  `kind`, so all ten `impossible-geography` warnings sat on the two days the
  trip relocates, each with the day's own shinkansen scheduled *between* the two
  stops. The rule now excuses a distance a transit stop crosses **in time**, on
  time order rather than stored order, and never excuses an untimed stop. Full
  reasoning, including the weaker rule that was rejected with evidence:
  `docs/known-issues.md` KI-60.
- **One canonical Japan fixture, 2026-08-28 — ADR-030 (PR #74).**
  `@tc/fixtures` owns the 14-day/68-stop trip; the seed script, the preview
  branch's demo reset and `@tc/factories` all call the same commands, and
  `src/lib/japanTripImporter.ts` is deleted. The two copies that existed were
  identical by luck, and where they differed was live on preview: the reset
  produced a trip with **zero tags** the day before M18's tag chips shipped, and
  coordinates were 72/72 local against 51/72 preview with six wrong venues.
  `pnpm seed:verify` is the thing that keeps it true. Procedure for new
  features: `docs/guidelines/fixtures-and-seed-data.md`. Filed rather than
  fixed: KI-57, KI-58, KI-59.
- **M18's contract PR, 2026-08-27 (PR #63).** See "Where the work is right now".
  The trap worth remembering: `equality.ts`, `diff.ts`, `hydrate.ts` and
  `detail.ts` each hand-enumerate activity fields, so adding a contract field
  without touching all four compiles cleanly and is wrong at runtime — and
  because `decide.ts` gates `UpdateActivity` on `okUnlessNoOp`, a kind-only
  update was rejected as a no-op until equality learned the field. The shared
  property generator needed both fields too, or the diff property test would
  have kept passing while never generating either. The project review found the
  same class again in `Location.city`/`countryCode` (KI-54, since resolved), and
  §6.1's descriptor refactor is the standing fix.
- **M10's Wave-2 gate closed 2026-08-27, and M15's closed 2026-08-26 (PR #56).**
  Evidence, retros and the rules promoted out of the deleted phase plans:
  `docs/milestones/M10-visual-craft.md`, `docs/milestones/M15-front-door.md`.
- **Two full reviews, 2026-08-28.** `docs/reviews/2026-08-28-project-review.md`
  (seven dimensions, six parallel agents) and
  `docs/reviews/2026-08-28-m11-pr71-review.md`. Both are being worked through on
  the current branch; read the remediation plan for what is in scope and what
  was deferred with a reason.

## Where the history went

| What | Where it is now |
|---|---|
| Everything this file said before 2026-08-28, verbatim and in order | `docs/retros/2026-08-28-status-archive.md` |
| M10 Wave 2, per phase — what each shipped, what it deliberately did not, the landing gaps that cost time | that archive, plus `docs/milestones/M10-visual-craft.md`'s scope, exit gate and Wave-2 retro |
| M15's gate and its two resolved open questions | `docs/milestones/M15-front-door.md` |
| Every roadmap reorder and its reasoning | `docs/milestones/README.md`'s reorder notes, and ADR-018 / ADR-021 / ADR-022 |
| The 2026-08-23 design sync, its routing, and the 2026-08-26 UI audit | `docs/design-feedback/` |
| The feature-flag / AI-kill-switch insert (PR #24) | ADR-019 and `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md` |
| The test-suite overhaul, Phases 0-4 | `docs/plans/2026-08-23-test-suite-overhaul.md`, `docs/testing-baseline.md`, `docs/testing-inventory.md` |
| Which known issues are open, and which were closed when | `docs/known-issues.md` — authoritative, and the only place that list should be kept |
