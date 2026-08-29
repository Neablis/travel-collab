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

**M11's gate closed 2026-08-28. M18's remaining surfaces are the current work.**

M11 shipped links 1-6 (users/identity ADR-025, roles and access, invites
ADR-026, pinned share links ADR-027, clone-with-lineage ADR-028, saved days
ADR-029) via PR #71, with both 2026-08-28 reviews remediated in PR #78. All
eight exit-gate boxes are ticked. **The narrative, the evidence and the retro
are in `docs/milestones/M11-sharing-and-invites.md`** — per this file's own
rule, that is their durable home and this is the pointer. The three things a
future session is most likely to need from it:

- **KI-75** — `m10-map-rail.spec.ts` was skipping a day about half the time.
  Same failing line every run, *different* day each run. The repo's written
  heuristic is a failure whose **location** wanders; this one's location was
  fixed and its **value** wandered, and it is the same diagnosis. Read the
  whole failure for movement, not just the line number.
- **KI-76 — fixed 2026-08-29.** `pnpm check` used to exit 0 while running
  **zero** integration tests where `pg_isready` is not installed (Postgres in
  Docker, no host client). The guard is now a real `pg` connect against
  `DATABASE_URL` (`apps/web/scripts/db-probe.mjs`), and it distinguishes "no
  database" (skip, still green) from "the probe could not run" (fails loudly).
  A green `pnpm check` covers integration again.
- **KI-66's remaining gap — the Vercel preview — is now walked.** Its
  "nobody has run this" half was already closed 2026-08-28 by a local
  production-build walk of twenty surfaces; what that walk explicitly could
  not reach was the preview itself, behind Deployment Protection. M11's gate
  reached it, and a cloud session reached it again a day later by a different
  route, finding the same thing. One preview-only behaviour to know before it
  is mistaken for a defect: when Deployment Protection re-challenges an
  in-flight XHR, the blocked `vercel.com/sso-api` redirect reaches the app as
  a bare "Failed to fetch". The other one the gate recorded — the CSP blocking
  Vercel's feedback script on every preview page — **was a real defect and is
  fixed**, not a behaviour to tolerate: that script is the Vercel Toolbar, and
  the Toolbar is the Flags Explorer. A preview console should be clean now.

**Playbooks was carved out of M11's gate by Mitchell on 2026-08-28** and is its
own follow-on: **M11b in `TODO.md`, approved and unplaced**, needing its own
scope and exit gate. Its four `<Preview>` shells stay M11-tagged.

**M18 is now current.** Its contract PR landed 2026-08-27 (PR #63):
`ActivityKind` and `ActivityTag` are real fields on the commands, both V1 event
payloads and `ActivityView`, with no migration — the payload additions default,
so every stored event replays as `planned` / `[]`. The dependent surfaces
(Calendar transit split, `N to book`, the home-hero tile, `act.badge`, tag chips
and the filter row) are PR 2+ and are **the current work** — M11's gate close
unblocked them.

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

**The 2026-08-28 review remediation landed via PR #78** (plan:
`docs/plans/2026-08-28-review-remediation.md`) — the revoke/accept race and
invite-metadata leak, the rejected-fetch send-queue wedge, dev-login
environment gating plus security headers, the AI prompt cap and AI/geocode
spend meters, and the repo's own tooling no longer teaching what the repo bans.
Its commit message recorded the M11 e2e lane as **not run**; M11's gate ran it,
and every M11 spec passed.

## Blocking / broken right now

**1. The Map lens's tiles have still never been confirmed to paint — KI-49.**
From a cloud session the egress proxy blocks the tile host outright, so the
map's chrome can be walked and its tiles cannot. From a laptop the transport
verifies (M11's gate loaded the style, tilejson, sprites and glyphs from
`tiles.openfreemap.org` on the preview, and WebGL is real) and the **pixels
still do not**: the WebGL canvas captures blank in the screenshot pipeline, and
MapLibre fetches its data tiles from a worker the main thread cannot observe.
So neither environment has produced a picture of a rendered map. Nothing on the
roadmap is blocked by it; it bounds what a browser walk is allowed to claim,
from anywhere. A blank canvas is not a pass.

**Retired from this list at M11's gate, 2026-08-28** — all three were on it and
none of them is live any more:

- **Migrations 0006-0010 are dispatched to production.** The gate's blocker, and
  the preview walk signed in and wrote as two users against the migrated schema,
  which is exactly the `recordSignIn` upsert into `users` this entry warned
  would throw. The standing rule is unchanged: merging does not apply a
  migration — dispatch it (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`) and say so in the PR body.
- **`/s/featured`'s dead end is gone — KI-61.** PR #79 replaced it with `/demo`;
  see the `/demo` paragraph above. Walked on the preview: 14 days, 68 stops,
  read-only, 2 conflicts rather than the pre-KI-60 twelve.
- **The CSP's last unwalked environment, the Vercel preview, is walked —
  KI-66.** The entry's "never executed by a browser" half was already closed
  earlier the same day by a local production-build walk; the preview was the
  named remainder, and M11's gate covered it — as did a cloud session on
  2026-08-29, independently, finding the same violation. One preview-only
  behaviour is still worth knowing before it is mistaken for a defect: a
  Deployment Protection re-challenge of an in-flight XHR reaches the app as a
  bare "Failed to fetch". The other one M11's gate recorded — the CSP blocking
  Vercel's feedback script on every preview page — was **not** "no app impact",
  and is fixed rather than documented; see the next section.

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
`VERCEL_AUTOMATION_BYPASS_SECRET` repo secret. Until then the only route in is
an MCP-minted `_vercel_share` link, which expires in 23 hours and suits an
interactive session, not a scheduled job. Treat the secret like `FLAGS_SECRET`:
it unlocks every protected deployment this project has.

**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Next action

**Open M18's remaining surfaces** — `docs/milestones/M18-stop-kind.md`, PR 2+:
the Calendar transit split and `N to book`, the home-hero tile, `act.badge`,
and the tag chips plus filter row. PR 1's contract fields are merged and inert,
and M11's gate close (2026-08-28) removed the only thing in front of them.
Read that milestone file's own preflight first: per
`docs/milestones/README.md`, the next milestone's plan re-checks the gate-close
checklist, and M11's close is the one being re-checked.

**Two things from M11's gate that will bite the next session if unread**, both
now in `docs/known-issues.md`, which is authoritative:

- **KI-76 — fixed 2026-08-29**, along with KI-72, KI-57, KI-69 and KI-68 (one
  PR, one theme: the test lane reporting what it actually ran). `pnpm check`
  no longer exits 0 while running zero integration tests where `pg_isready` is
  absent. Two things worth carrying forward: the integration suites no longer
  truncate whole shared tables, so `pnpm test:int` stops destroying local dev
  data — and `pnpm --filter web db:reset` now clears all ten tables, derived
  from the schema, rather than a stale list of three. What is **not** fixed is
  concurrency: `test:int` is still an exclusive resource, and two agents
  running it at once still corrupt each other (KI-77, caught doing exactly
  that on 2026-08-29).
- **KI-75** — the diagnostic rule this repo teaches is a failure whose
  *location* wanders. M11's gate hit one whose location was fixed and whose
  *value* wandered, and it was the same thing: a sampling race, not a defect.
  Read the whole failure for movement.

**Approved and unplaced, neither of them "next":** M17 (re-scope it first) and
**M11b Playbooks**, carved out of M11's gate by Mitchell on 2026-08-28 — it
needs its own scope and exit gate written before it opens.

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
