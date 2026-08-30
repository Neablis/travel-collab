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

**M16's gate closed 2026-08-29. M18b is the current work**, and the order is
now `M18b → M17 → M12 → M13 → M14 → M9`.

**Mitchell placed M18b and M17 on 2026-08-29**, out of the three
approved-but-unplaced milestones, to run as one overnight batch together with
the activity-field descriptor refactor (project review §6.1). M17 needed a
re-scope to be placeable and got one in the same decision: its `users` table
and identity-decision scope are **removed**, because M11 link 1 shipped both
under ADR-025, leaving the preferences half (name, home airport, account-scope
distance units through one `kmLabel`, home-time-on-hover, `who` → display
name). It needs one migration — `users` carries no preference columns today.
**M11b Playbooks stays unplaced**: it has no scope and no exit gate written,
and authoring those is a product decision, not overnight work.

Two gates closed on 2026-08-29, M18 first and M16 second. M18's live warnings
are immediately below because they still bite; M16's close follows them.

M18 gave a stop two real fields and then made the app act on them: `act.badge`
(Booked / Holding / Idea / Travel, and nothing for `planned`), tag chips, a kind
picker and a tag picker in the stop editor, the home hero's "not booked" tile,
`N to book` on the Calendar, and the Calendar's city grouping. **The narrative,
the evidence and the retro are in `docs/milestones/M18-stop-kind.md`** — that is
their durable home and this is the pointer. Four things a future session is most
likely to need:

- **SPEC §12's travel-day transit split was built and removed the same day.**
  It fired on one of seven travel days and got that one wrong, because every
  stop on a travel day carries the DESTINATION city (KI-59) and five travel days
  open with the train. Mitchell: *"I don't think the shape of the fixture should
  drive functionality, that's how we get drift."* The Calendar now groups by
  city alone — equal cards, no strips, plus an untitled bucket for stops with no
  city — and the day-to-day transition is the day label's job, from yesterday's
  and today's **last** placed activity. Do not rebuild the split from SPEC §12
  without reading the milestone file first.
- **`cityFor` now reads a day's LAST city-bearing stop, not its first.** It
  drives day accents, the day chips and the hero sparkline.
- **A hand-enumerated field list dropped the editor's pickers on the floor.**
  `ActivityEditorSheet.handleSave` builds commands by listing fields, so the new
  ones went nowhere and TypeScript could not see it. Third occurrence this
  milestone — §6.1's activity-field descriptor refactor has earned its place,
  and `TripBoardScreen`'s two dead command builders sit in its path.
- **KI-76 is fixed (2026-08-29).** `pnpm check` used to exit 0 having run
  **zero** integration tests wherever `pg_isready` was absent — this laptop,
  with Postgres in Docker on :5433. The guard is now a real `pg` connect against
  `DATABASE_URL` (`apps/web/scripts/db-probe.mjs`), and it tells "no database"
  (skip, still green) from "the probe could not run" (fail loudly).
- **KI-66's CSP finding, from a cloud session the same day** — the CSP blocking
  Vercel's feedback script on every preview page **was a real defect and is
  fixed**, not a behaviour to tolerate: that script is the Vercel Toolbar, and
  the Toolbar is the Flags Explorer. A preview console should be clean now. The
  one preview-only behaviour that remains: a Deployment Protection re-challenge
  of an in-flight XHR reaches the app as a bare "Failed to fetch".

**Tag focus was carved out as M18b — now placed, and the current milestone** —
SPEC §11's cross-lens dimming, the behaviour behind the chips M18 made
settable.

**M16 shipped and closed, and the way it happened is the thing to know.** The
implementation landed overnight in **PR #88** (`5a362d3`) — a streaming,
multi-turn, tool-using agent on `POST /ask`, the rail docked per SPEC §9, an
intent classifier that cut step-1 input 73%, per-ask analytics, and **M9's write
tools behind propose → review → approve**, which is M9 scope shipped early on
Mitchell's request. That PR **deliberately flipped no status flag** because
everything in it ran simulated — correct under the gate-close checklist — and
the gate then closed on Mitchell's live confirmation on 2026-08-29.

**Ten of eleven boxes ticked; the eleventh moved rather than being waived.**
*"Recorded transcripts replay in CI without a live call"* is **M9's box now**,
by Mitchell's explicit decision: it was PR #88's Task 7 (the eval set and replay
harness), dropped rather than half-landed, and M9's gate already carried the
identical criterion. **KI-11 stays open and is now M9's to close.**

Two things `M16-assistant-read-agent.md` records rather than smooths over, both
worth reading before trusting the assistant's numbers:

- **The gate's evidence is one log line plus a human pass.** Vercel holds
  exactly **one** real-model `ai.ask` record across seven days, and it is a
  trip-scoped opener, not one of the four acceptance assertions — those were
  confirmed locally, where records go to the console and never reach Vercel.
  That is KI-11's shape one layer up, and the box that just moved to M9 is
  the fix.
- **Open question 1 is deliberately still open.** That one record shows
  `uncalledTools: ["read_day","find_free_time"]`. Deleting a tool on n=1 would
  be the same fixture-shaped reasoning Mitchell rejected at M18's gate. Both
  tools stay until `/ai-usage` has a real spread.

**Done:** M0-M8, the Phase 1 gate review, M10 (2026-08-27), M15 (2026-08-26),
M11 (2026-08-28), M18 and M16 (both 2026-08-29).

**One milestone is approved and unplaced, and it is not "next": M11b
Playbooks** — it needs its own scope and exit gate written first, which is a
product decision. M18b and M17 were placed 2026-08-29.

**`/demo` is the real board, read-only, 2026-08-28 (PR #79) — ADR-031, closes
KI-61.** The demo trip is the Japan fixture folded in memory and served through
the ordinary trip endpoints, rendered by the ordinary `TripBoardScreen`. One
seam does it: `requireTripAccess` answers the demo before `auth()`, as a viewer.
**It needs no database**, which makes it the cheapest way to walk a real trip in
a fresh worktree — M18's gate used it to catch the transit split.

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

**Open M18b — Tag focus** — `docs/milestones/M18b-tag-focus.md`. Six exit-gate
boxes, no migration, no live model, and `/demo` renders the tagged Japan
fixture with no database, so it can be walked end to end. Per
`docs/milestones/README.md` the next milestone's plan re-checks the gate-close
checklist, and **M16's close (2026-08-29) is the one being re-checked** — all
four flags plus this file were flipped in commit `c489397`.

**Then M17**, re-scoped 2026-08-29 (see above). **Its migration must not be
merged without a dispatch** — `gh workflow run migrate-production.yml -f
confirm=migrate` from `main`.

**Alongside them, the activity-field descriptor refactor** (project review
§6.1) is scheduled by the same 2026-08-29 decision, moving off the deferred
list below. Two facts it needs: its stated prerequisite is **already met** —
§1.6 / KI-54 is resolved and `equality.ts:55-56` compares `city` and
`countryCode` — and `AGENTS.md` reserves the contracts step as **its own
reviewed PR**, which Mitchell scheduled it knowing. Keep it a separate PR from
the two milestones.

**Three things from M18's gate that will bite the next session if unread:**

- **KI-76 is fixed, but `test:int` is still exclusive.** `pnpm check` now runs
  the integration suite instead of silently skipping it. The suites also stopped
  truncating whole shared tables, so `test:int` no longer destroys local dev
  data, and `db:reset` clears all ten tables derived from the schema rather than
  a stale list of three. What is **not** fixed is concurrency: two agents
  running `test:int` at once still corrupt each other — KI-89, caught doing
  exactly that on 2026-08-29.
- **Walk the thing in a browser before believing the suite.** M18's headline
  Calendar rule passed nine unit tests and was wrong, because the tests shared
  the implementation's assumption about the fixture. `/demo` needs no database
  and renders the real Japan trip, so this is cheap. Three gates running, the
  walk has found what no test could.
- **Adding a field means grepping for every place fields are enumerated by
  hand.** Not just the contract. M18 hit this three times; the sheet's version
  silently discarded a user's input with a green suite and a clean typecheck.

**Approved and unplaced: M11b Playbooks only**, now that M18b and M17 were
placed on 2026-08-29. It needs its own scope and exit gate written before it
opens, which is a product decision.

**Deliberately deferred, each recorded where it belongs rather than dropped:**

1. ~~**The activity-field descriptor refactor**~~ — **scheduled 2026-08-29**,
   see "Next action" above. Still its own reviewed PR.
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
