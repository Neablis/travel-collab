# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues/`.

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

**M18b's gate closed 2026-08-30. M17 is the current work**, and the order is
now `M17 → M11a → M11b → M12 → M13 → M14 → M9` — **M11b was scoped and placed
2026-08-30** off the new design handoff, and **M11a was created the same day and
placed in front of it**. See the next two paragraphs.

**M18b shipped tag focus in PR #91** — SPEC §11's behaviour behind the chips M18
made settable. Clicking a tag chip focuses that tag across all four lenses;
off-tag stops dim to 32% and are never hidden; the Calendar counts `N of M
match` per city card instead and dims a no-match card to 0.28; a line beside the
view tabs names the focus and clears it. **The narrative, the evidence and the
retro are in `docs/milestones/M18b-tag-focus.md`** — that is their durable home
and this is the pointer. Three things a future session is most likely to need:

- **The gate closed in two halves, and it will keep doing so.** Six boxes were
  proven on `test:e2e:ci-like` and then left unticked until Mitchell walked the
  preview, because the checklist's trigger is a *deployed* demo. An unattended
  session cannot produce one — see `VERCEL_AUTOMATION_BYPASS_SECRET` below, and
  read the two routes tried before assuming a share link will do. **Same shape
  as M16's close.**
- **The suite passed on every version of this milestone, including the two that
  shipped defects.** Second consecutive gate where that was true. The browser
  walk caught an accessibility defect no unit test could (a hover hint reused as
  the Clear control's accessible name — 34 controls, one name, on the Japan
  fixture), and CodeRabbit caught a real regression both missed: a tag focus
  re-centring the map, next to a comment asserting it never would. **A rationale
  comment is not evidence.**
- **Two test traps, both of which cost time here.** `fitBoundsMock` in
  `MapLens.test.tsx` is file-scoped and never reset, so it enters a test
  carrying nine earlier calls — clear first, then assert
  `toHaveBeenCalledTimes`. And a 150ms CSS transition makes a single style read
  a race (0.77, then 0.45, then 0.37 for the same assertion): poll for the
  settled value rather than deleting the transition.

**Mitchell placed M18b and M17 on 2026-08-29**, out of the three
approved-but-unplaced milestones, to run as one overnight batch together with
the activity-field descriptor refactor (project review §6.1). M17 needed a
re-scope to be placeable and got one in the same decision: its `users` table
and identity-decision scope are **removed**, because M11 link 1 shipped both
under ADR-025, leaving the preferences half (name, home airport, account-scope
distance units through one `kmLabel`, home-time-on-hover, `who` → display
name). It needs one migration — `users` carries no preference columns today.
**M11b Playbooks was the last unplaced milestone, and it was scoped and placed
2026-08-30** — see immediately below.

**A new design handoff merged 2026-08-30 (`a43a9a4`), and M11b is now scoped and
placed because of it.** The substantive addition is `SPEC.md` §15 / `DRIFT.md`
§2b — **Playbooks becomes a public library**: four routes, three of them new
(`day`, `board`, `profile`), server-side city search, publishing, an adds
ledger, reviews and derived public profiles. That was exactly the product
decision M11b had been waiting on. Scope, eight links and the exit gate are in
`docs/milestones/M11b-playbooks-public-library.md`. Four things a session
picking it up will need:

- **The scope line is not §15's line.** §15 spans M11b and M12. Mitchell's call
  on 2026-08-30: **M11b takes everything except reviews; M12 keeps reviews,
  ratings and moderation.** Two deltas follow from that and are recorded rather
  than left to be rediscovered — Discover ships **two sorts, not four**, and
  **no rating floor filter**, because both need data that does not exist until
  M12. Do not "fix" them back to the spec text.
- **Deferring moderation rests on a gate that is not built.** Mitchell:
  *"we will gate on who we invite to platform... we need a community before its
  a issue."* Sound — but **there was no gate on who signs up**: any Google
  account that reaches `/signin` gets one, and the landing page's "Early access"
  line is copy about *trip* invites, not signup. **That is now M11a**, scoped
  the same day and placed in front of M11b — see below.
- **The largest blocker is `cities: string[]`, not the routes.** Checked against
  the tree: `SavedDay` has none of the six things §2b says a build needs. And
  `saved_days.stops` is `jsonb` on purpose (ADR-029 — a saved day is a value,
  never queried into), so `cities` has to be its own derived column, not a query
  into the blob.
- **`DRIFT.md` is stale in four places** — it was read from the build on
  2026-08-26 and only §2b was refreshed. D1 (Caesura rename) is closed
  (`siteMetadata.ts:17`), D2/D8 (landing page) shipped as `(front)/welcome` in
  M15, and KI-47, KI-43, KI-44 and KI-45 are all resolved. §2b's own claim that
  the missing `cities[]` is *"bigger than the missing tags"* rests on KI-47
  still being open; it is not. Feed this back to design rather than editing
  their bundle — the folder is rewritten in place on their side.

**M11a — an invite gate — was scoped 2026-08-30 and placed between M17 and
M11b.** It exists because M11b's scope split defers moderation to M12 on the
grounds that the population is invited, and that gate did not exist. Mitchell
asked for it as placed work rather than an immediate build: *"Dont build it yet,
roll it as work to do before the playbook work from the designs."* Scope and
exit gate: `docs/milestones/M11a-invite-gate.md`. Three things about it:

- **Most of it is already built, which is why it is small.** `users`
  (M11 link 1, ADR-025) already records who has been here, so *"never been to
  the app"* is *"has no `users` row"* — no new concept. And the `signIn`
  callback already exists and is already fail-closed: `server/auth.ts` composes
  it from `server/users.ts`'s `recordSignIn`, which returns a boolean, and
  `false` lands on the designed `/signin?error=` screen with its existing copy
  map. **Do not go looking for this in `lib/authConfig.ts`** — it is composed in
  `server/auth.ts` on purpose, so the Edge instance the proxy builds never
  touches the database (ADR-024).
- **Three ways through, all Mitchell's calls on 2026-08-30.** A pending M11
  trip-invite token admits you with no code (otherwise M11's invite→accept flow
  breaks for exactly the new collaborators it exists to serve); a **reusable
  super code**; and **single-use codes** in a new `invite_codes` table. He asked
  for both code kinds, not one.
- **The one real engineering problem is that OAuth leaves the site.** A code
  cannot be collected inside the callback — the browser has already been to
  Google and back — so it rides a short-lived httpOnly cookie set before the
  redirect. `proxy.ts` fills the same cookie for `/invite/<token>`, storing
  without validating, because it runs in the Edge runtime with no database.

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

**Tag focus was carved out as M18b, and shipped 2026-08-30** — SPEC §11's
cross-lens dimming, the behaviour behind the chips M18 made settable. See the
top of this file.

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
M11 (2026-08-28), M18 and M16 (both 2026-08-29), M18b (2026-08-30).

**Nothing is approved-but-unplaced any more.** M11b Playbooks was the last one
and was scoped and placed 2026-08-30 off the new design handoff; M18b and M17
were placed 2026-08-29.

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

**Open M17 — Account customization** — `docs/milestones/M17-account-customization.md`,
re-scoped 2026-08-29 (see above). **Then M11a, then M11b**, both scoped and
placed 2026-08-30 — `docs/milestones/M11a-invite-gate.md` and
`docs/milestones/M11b-playbooks-public-library.md`. **All three carry a
migration, and a migration is dispatched, not merged.** **Its migration must not be merged without a
dispatch** — `gh workflow run migrate-production.yml -f confirm=migrate` from
`main`. That is the one thing about M17 most likely to be missed, because
merging no longer applies a migration and the PR body is the only place anyone
will look for it.

Per `docs/milestones/README.md` the next milestone's plan re-checks the
gate-close checklist, and **M18b's close (2026-08-30) is the one being
re-checked** — TODO tick, six exit-gate boxes, retro, Current milestone and
this file, all flipped in one commit on PR #91.

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
  and renders the real Japan trip, so this is cheap. **Four gates running, the
  walk has found what no test could** — M18b's was an accessibility defect
  (34 controls sharing one accessible name) that every unit test passed through.
- **Adding a field means grepping for every place fields are enumerated by
  hand.** Not just the contract. M18 hit this three times; the sheet's version
  silently discarded a user's input with a green suite and a clean typecheck.

~~**Approved and unplaced: M11b Playbooks only**~~ — **empty as of 2026-08-30**,
when the design handoff supplied M11b's scope and Mitchell placed it after M17.
`docs/milestones/M11b-playbooks-public-library.md`.

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
  `docs/known-issues/` KI-60.
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
| Which known issues are open, and which were closed when | `docs/known-issues/` — authoritative, and the only place that list should be kept |
