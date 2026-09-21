# STATUS archive — 2026-09-21

The `## DONE 2026-09-20 — the shared day's map panel (M26 link 4b)` handoff,
moved here verbatim and in order. It was **43,702 B, 69% of `docs/STATUS.md`**,
describing work that shipped in PR #197.

This is the third time this file has had this treatment and the reason has not
changed: `STATUS.md` is the file `CLAUDE.md` tells every session to read first,
and its own header records what goes wrong when it grows — *"the stale section
was the defect, length only the symptom"*. Its stated signal is ~300 lines; it
was at 969.

**What was still live was promoted, not archived.** The two blockers — the
geocoder-blocked coordinates (`KI-2026-09-20-d`) and the preview database that
has never had `content:import` run — are now under STATUS's own
`## Blocking / broken right now`, where something actually looks for a blocker.
The two unfinished pieces of link 4b stay in the DONE summary.

Earlier archives: `docs/retros/2026-08-28-status-archive.md`,
`docs/retros/2026-09-11-status-archive.md`.

---


**Branch `claude/beautiful-feynman-b86spm`, PR #196, `ci` green on every pushed
head** — run 889 on `691f804` has `static-and-unit` and `integration-e2e` both
green. `Vercel Preview Comments` is the one red check and it is red *on
purpose*: it fails while any Toolbar thread is unresolved, and decision 1 below
is deliberately left open. That is why GitHub says `unstable` rather than
`clean`; there is no conflict and no failing test.

The PR is finished. This is NEW work and does **not** belong on it — a feature
added there re-opens a 163-file review and re-pays the full suite.

**Where to branch from depends on whether #196 has merged. CHECK IT, do not
assume** (`mcp__github__pull_request_read`, or the GitHub UI; `gh` is not
available in a cloud session).

- **#196 merged** → branch off `main`. The clean case, and the one the earlier
  wording of this line assumed without saying so.
- **#196 still open** → branch off `claude/beautiful-feynman-b86spm`. The panel
  builds directly on `SharedDayMap.tsx`, `sharedDayGeometry.ts` and the three
  fixture coordinates, and **none of those exist on `main`** — branching off
  `main` while #196 is open starts the work on a tree missing its own
  foundation. The cost of the other choice is that CodeRabbit's pending
  re-trigger may force changes on #196 which then have to be merged down before
  this work can land.

### What the walk found, and it is not the map

`/playbooks/day/[savedDayId]` → `isDay` · **line 2677** of
`.design-sync/handoff/design/Trip Planner Redesign.dc.html` (the route→artboard
index in `.design-sync/handoff/README.md:229` points straight at it). The
design's map panel is **mostly derived TEXT**, and only the canvas is built:

| design field | renders | built |
|---|---|---|
| canvas, numbered pins, route line, gapped legs | — | **yes** (`SharedDayMap.tsx`) |
| `day.mapTitle` | the day's cities — `Kyoto → Osaka`, or the single city | no |
| `day.mapFacts` | up to 3 k/v rows: `On foot` / `2.4 km · 32 min`, `By train or taxi` / `18 km · 25 min`, `Widest point to point` / `4.1 km` | no |
| `day.mapNote` | one of four sentences on the day's SHAPE — *"One clean line. It never doubles back on itself."*, *"A loop — it ends near where it started."*, *"It criss-crosses. Expect to cover the same ground twice."*, *"Mostly transit — about N of the day is spent moving."* | no |
| `gaps[idx].label` | a line **between stops in the list**: `12 min walk · 0.9 km` | no |
| legend `On foot` / `By train or taxi` | — | honestly shelled, `map-legend-modes` → `unplaced`. A legend names a mode PER LEG and still has no field; the walk-vs-ride split needs none (link 5c). |

The derivations are all in `dc.html:7495-7527`. Read them there rather than
re-deriving: thresholds (`km > 1.6` → ride; `wander < 1.5 / < 2.6` → which
note; `transitShare > 0.8 && rideMins > 90` → the transit note) and the
walking/riding speed constants are decisions, not arithmetic.

### REUSE, and this is a constraint rather than a preference (Mitchell, 2026-09-20)

**Reuse as much of the existing components as possible — the page especially.**
Named, so nobody re-derives what exists:

* **`lib/geo.ts` → `haversineKm(a, b)`** — the distance. Do not write a second one.
* **`lib/units.ts` → `kmLabel(km, unit)`** — the `2.4 km` / `1.5 mi` formatting,
  and it already honours the account's distance preference. `MapHoverCard.tsx`
  and `MapDayStrip.tsx` are the two call sites to copy the idiom from.
* **`lenses/mapRailData.ts` → `longestLeg()`, `routeLegs()`** — the trip Map
  lens ALREADY derives longest-leg and a travel/rest split. `MapHoverCard`
  already renders "Longest hop N km — A to B". The shared day wants the same
  shapes; extend or lift, do not fork.
* **`playbooks/sharedDayGeometry.ts`** — extend it. It has the points, the legs
  and `contiguous`; it has no distances. That is the one honest gap.
* **The page itself**: `SharedDayScreen.tsx`'s existing layout, `Card`, `Text`,
  `DataText`, and the rail it already renders. The panel is a new block INSIDE
  that page, not a new page.

### Still blocked, and by what

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

### Also worth doing, unblocked

**Make a seeded Playbook genuinely multi-day.** Every day in both fixtures is
one day (`dayIndex` is `0` everywhere), so 9 of 10 Discover cards show no tabs
and no dividers — which is what "the Playbooks look the same" actually was.
`dayIndex` is in the contract with `.default(0)`; the fixtures are TypeScript.
`packages/fixtures/src/savedDayCoordinates.test.ts` is the pattern for holding
a claim about CONTENT rather than code.

**THE WIDGET CONTAINER — DONE, WALKED AND ACCEPTED, 2026-09-20.** PR #198,
green on every check on `8bece7e`. Mitchell after walking the preview: *"I
walked, and it looks good."*

**"The widget container" means the INSERT RAIL**, and it is worth one line here
because the first reading of those words went somewhere else and cost a commit:
he had to say it twice. The two boxes are separate and both are filed:

* **The insert rail — `KI-2026-09-20-h`.** Now §26's right column, open for as
  long as Editing is, with the four-up icon kind control, rows as cards, a
  pinned header and a count line. **The popover is superseded — do not restore
  it from git history**; the entry records why, in his words.
* **The block card — `KI-2026-09-20-g`.** The box a rendered widget draws
  itself in. Found on the way to the rail, real, unowned; one of four fixed.

**The two things that made this milestone-shaped rather than a styling errand,
both in `-h`:**

1. **A browser walk found a defect every other layer passed.** The selected kind
   icons painted their faded cells in the same token as their own ground, so
   Inline and List were unreadable in the one state they exist to confirm —
   while unit tests, lint, typecheck, both walls, e2e and CI were all green.
   The design has the same collision. **On a surface whose changes are paint, a
   walk is the instrument, not a formality.**
2. **CodeRabbit's two findings were both real** — a `role="radio"` group with no
   arrow keys and four tab stops, and no coverage at the widths where the rail
   newly costs the document 320px. Both fixed, both threads resolved by it.

**What is left is recorded, not pending:** `-h` carries four cosmetic items and
one product call (`--color-brand-pressed` at 11px for the takes-line), `-g`
carries the other three containers and the 8px-vs-10px radius question,
`KI-2026-09-20-i` carries the docstring gate, and `KI-2026-09-20-j` carries a
unit test that failed once and has not reproduced.

---

**LINK 5c IS CLOSED, AND IT WAS NEVER ACTUALLY BLOCKED.** It was carried all
milestone as "needs Mitchell's answer on whether `routeLegs()`'s
`kind === "transit"` proxy may stand in for per-leg transport mode". The
design file answers it and always did — `Trip Planner Redesign.dc.html:7497`
derives the walk-vs-ride split as `km > 1.6 || pts[j].transit ||
pts[j + 1].transit`. **Distance is the discriminator; the transit flag is a
modifier.** So "on foot" is a claim about DISTANCE, which the coordinates
already state, not a claim over a missing field. **The question was answerable
by reading the file the milestone is built from, at a line the route→artboard
index points straight at** — parking it on a person was the error, and the fix
was to do the walk link 0 built the index for.

**M26 IS BUILT END TO END AS OF 2026-09-20 — every link in both waves**, and
**the preview has now been walked.** The Definition of Done ran at Tier 3 again
after the walk's fixes: `pnpm check` EXIT 0 (typecheck, lint, walls, every
package's unit tests and the scripts suite, 789 integration tests across 62
files against a real Postgres), `test:e2e:ci-like` **150 passed exit 0**,
`seed:verify` EXIT 0.

**THE WALK FOUND THREE DEFECTS AND TWO UNWALKABLE BOXES, AND THE BIG ONE WAS
IN THE SEED.** `docs/milestones/M26-design-parity.md` opens with the record;
the two things a later session should not re-derive:

1. **A feature can be built, tested, reviewed and still invisible, because the
   demo data cannot reach it.** §16's shared-day map rendered `canvas=0` on
   every shared day on the preview — `SharedDayMap` was right, and **not one
   saved-day stop in the repository carried a `lat`.** Both seed fixtures'
   `stop()` helpers built `location` as `{ name, city }` and dropped the rest,
   so `worthDrawing`'s two-point floor was unreachable by construction. This is
   the same thing Mitchell reported from the preview on 2026-09-19 (*"a playbook
   activity doesn't even have a map"*), answered the first time by building a
   component when half the answer was data. Three reviewed coordinates from
   `coordinates.json` now make one day draw and one degrade;
   `KI-2026-09-20-d` carries the other ~44 and why they were not typed from
   memory. **The test that would have caught it is about CONTENT, not code**,
   and lives in `packages/fixtures` — every unit test of the component passed,
   because each supplies its own located fixture. The COMPONENT half is now
   held separately, in a real browser: `e2e/m26-shared-day-map.spec.ts` asserts
   a `canvas.maplibregl-canvas`, pins numbered as the list numbers them, and
   `watchMapWorker`'s `loaded`. Two assertions, deliberately not one — the e2e
   lane migrates a fresh database and never runs `db:seed`, so neither can
   cover for the other. **Its degrade half was the seventh test in this
   milestone to assert nothing**, and the first found by breaking the code
   rather than by reading it: `toHaveCount(0)` on a canvas is satisfied by
   "not yet", because MapLibre creates it in an effect.
2. **"Not walkable" is a finding, not a blank.** Two boxes turned out to need
   account state the seed does not produce — a `premium` account for the
   *Chosen trips* token scope, and an account WITHOUT `ai.ask` for the
   new-trip free fork, where every account here holds it by grant (`alice`) or
   by trial (`demo`). Read off `GET /api/account/plan` rather than guessed,
   and recorded on each box with the evidence, so the next attempt starts from
   what is missing instead of from the same dead end.

The two smaller defects were the kind only a renderer shows: Discover's results
sentence was missing its `·`, and the phone Account **clipped** the signed-in
email mid-character, because §34.5's 170px label column is a desktop rule that
was being applied at 411px.

**TWO GATE BOXES FOUND WORK THAT REVIEW DID NOT, and both were measurements.**
Link 13's box asked for the phone's text-column width as a NUMBER and got
141px-of-241px — the card was narrow because `DAY_COLUMN_WIDTH_PX` is a desktop
constant at every width, not because a phone is. Wave 2's box asked for KI-046's
44px census and got **48 of 91 controls under the floor (53%)**, on a wave whose
link 14 had already claimed that pass. Both are fixed and both now have a spec
that keeps counting: 215px-of-315px, and 4 of 91 (all four MapLibre's own
required attribution). **The lesson is narrow and repeatable: a box that asks
for a figure catches what a box that asks for a claim cannot.**

**SIX TESTS IN THIS MILESTONE ASSERTED NOTHING**, every one found by CLAUDE.md
rule 3 and none by reading the diff. Three shapes, all likely to recur: asserting
a rendered artefact the broken code never produces either; two overlapping
guards so neither is load-bearing; and a fixture whose default happens to match
the assertion. The wave retros in `M26-design-parity.md` have the instances.

**LINK 7 CHANGED WHAT A BLANK MAP MEANS, and that is the part worth carrying
forward.** §3b's region-by-region loading is built on Home, Overview and the
Notebook index (a `Skeleton` primitive, outlines only, plus a per-region
`RegionError` that retries in place). The Map lens took the milestone's "or its
different answer is recorded" branch instead: `TripProvider` has the whole
`TripDetail` before the lens mounts, so there is no seam to stage over and
faking one would be inventing a wait. What it got is the **style-load recovery
ladder** — a rebuild at 3.5s, another at 7.5s, the offline panel at 11s.

That ladder exists for a failure nothing in this repo could see. `failed` is set
only by an `error` event, and MapLibre's worst failure emits none: `map.on(
"load")` simply never fires, nothing throws, and the reader gets a
paper-coloured rectangle forever. **That is why KI-49 could say the tiles "have
never been confirmed to paint, in any environment"** — a blank canvas was
indistinguishable from tiles-blocked, from style-never-parsed, from a container
measured at 0×0. It now means one thing: every rung ran and the map still did
not load. KI-49 is not closed by this; it is diagnosable, which is the honest
claim.

Five deliberate differences from the artboard are recorded in `DRIFT.md` §3b
rather than left for the design side to find, `homePb` (a region whose build
counterpart was deleted in M11b) among them.

**LINK 4 WAS "HALF DONE" IN A WAY WORTH NAMING, because the shape recurs.**
`sharedDayGeometry.ts` — the pure half: which points exist, which legs join
them, no leg across a night — shipped in link 12 with a full unit test and **no
production consumer at all.** A shared Playbook day rendered a 675-line list and
no map. Every test passed the whole time, because **not one fixture in the repo
had coordinates on a stop**, so the drawing code was never reached by anything.
Mitchell found it by opening the preview (2026-09-20); no suite was ever going
to. `SharedDayMap.tsx` is the consumer, and the fixtures now include located
stops.

The lesson is narrower than "walk the preview": **a pure module with no caller
is not half a feature, it is zero of one**, and it reads as progress on a status
page in a way that a missing screen does not.

**THE E2E LANE HAS NOW BEEN RUN ON THIS BRANCH (2026-09-20): 143/144.** The
one failure is `m10-map-rail`, and it is KI-49 — the cloud session's egress
proxy blocks the tile host from the browser, so the Map lens reaches its
`failed` state and the offline panel covers the rail. **It passes in CI**,
where the tiles load. Running it found three real defects that the unit suite
could not see, all from the same gap — this milestone had only ever been run
against `vitest.unit.config.ts`:

- the season cut never reached `route.int.test.ts` (integration lane);
- `m26-phone-surfaces.spec.ts` was running in the `[desktop]` project too,
  because its spec name went into the phone `testMatch` and not the desktop
  `testIgnore` (the two are now one list, `PHONE_ONLY_SPECS`);
- `responsive.spec.ts` still drove Discover's scope as `role="radio"` after
  link 2a made it `role="tab"`.

Two further failures were NOT defects, and both are worth knowing before the
next session re-derives them.

`m22-api-tokens` failed on an **empty** value for `API_TOKEN_PEPPER` in
`.env.local`: the key was present, so every "is it set?" grep passed. This is
an environment trap, not a known issue — it is written up in
`docs/guidelines/cloud-agent-sessions.md`, which is where a thing you can fix
in your own container belongs.

Separately, the WAY `m10-map-rail` fails exposed a genuine product issue: the
Map lens's offline panel leaves enabled controls underneath it. That one is
KI-2026-09-20-c.

**The phone is the only part of this that has been opened in a browser**, and it
is green: `e2e/m26-phone-surfaces.spec.ts`, 8 tests at 411×852 against a
production build (the `ci-like` lane). Everything Wave 1 built is still
unwalked — its `[walk]` boxes are open and the desktop e2e lane has not been run
on this branch. The unit suite is green at 3215 tests across 231 files, and a
green unit suite is not a walked screen.

**Two things the phone walk is worth reading for.** It found two defects in its
own first run (specs that never navigated, so they sat at `about:blank`) — the
product was fine, but nothing had been opened at all before that. And the lint
wall refused three attempts to assert a phone class swap in jsdom, which is the
rule working: *a paint claim belongs at 411px, not in a unit test.* Those three
are now covered in the phone lane.

- **Link 1** — `/account` is a route with three tabs (`?tab=`), Profile · Plan &
  usage · API tokens. `AccountSettingsSheet` is deleted. Tokens gained trip
  scope (DRIFT D12 — the gap was one hardcoded `null`), a lifetime of three
  choices, and a gate that names the lapsed case. `KI-2026-09-17-a` resolved.
- **Link 2** — Discover is re-sorted by kind of decision: scope is underlined
  tabs, filters are chips from one `FILTER_DEFS` list, sort rides a results
  sentence that did not exist. Season is cut as a filter (the concept stays —
  `content:verify` still prints occupancy). §33.3's tag-focus move rides with it.
- **Link 3** — a Playbook's days are a scope: `All days · Day 1 · Day 2`, merged
  rather than concatenated, continuous numbering, per-day dividers, and a CTA
  that says how many days it moves.
- **Link 4** — geometry only. The map is NOT built; see the milestone file for
  exactly what remains and why it needs a browser.
- **Wave 2** — `/account` and `/plans` are tasks the phone tab bar steps aside
  for (`taskOwnsScreen` in `PhoneTabBar.tsx`, which links 14 and 15 reuse);
  Playbooks has one filter sheet instead of a stack of popovers; the 44px floor
  is a design-system primitive (`PHONE_TOUCH`) rather than a string exported by
  a wizard, and it now releases at 767px like every other phone rule rather than
  at 640px; the Map tab has the offline state §13 designed and it had none of any
  kind. **Link 15 still owes its `Cancel · New trip · Empty` header** — doing it
  properly means lifting *Create empty* out of `NewTripConversation` rather than
  duplicating it, and the milestone says which.

**Two useful things it produced beyond the links themselves:** `ui/underline-tabs.tsx`
and `ui/settings-card.tsx` are new primitives the later links consume, and the
token wall found two already-shipped defects on its first run (`bg-canvas` on
the shared-trip screen, `ring-primary` on the widget ring).

**M26 LINK 0 — THE PREFLIGHT — IS DONE (2026-09-19).** It was the one part of
the milestone that had to run before any screen work, and it has. What a later
session inherits from it:

- **Find a screen by looking it up, not by grepping.**
  `.design-sync/handoff/README.md` carries a generated **route → artboard →
  spec** table, and `SPEC.md` opens with a generated **section index**. Both
  have tests that fail when they drift. The order of operations is
  `docs/guidelines/building-from-the-design.md` — read it before building any
  M26 screen.
- **The design file has no artboards, only route gates.** A screen is an
  `<sc-if value="{{ isAdminRoute }}">` block, reached by driving `startScreen`
  and the nav. The table gives the line.
- **The colour wall now fails on an undefined token NAME**, not just a raw hex
  (`KI-2026-09-19-g`, resolved). **It found two live defects on its first run**
  — `bg-canvas` on the shared-trip screen, which made that page's ground render
  as nothing, and `ring-primary` on the selected-widget ring. Both fixed. The
  hole was wider than the KI estimated: it had already shipped.
- **`KI-2026-09-14-c` and `KI-2026-09-19-g` are both in `resolved/`.**
  `KI-2026-09-19-f` (an accent reaching MapLibre through `getComputedStyle`) is
  **still open** — it is link 8a, not link 0, and the gate box covering both
  halves stays unticked.

**Two things about M26 that change plans made from this page:**
`.design-sync/handoff/DRIFT.md` is stale in the build's favour in six places —
it lists eleven `<Preview>`-shelled surfaces and there are **six** — so do not
plan from its counts without opening `apps/web/src/lib/preview-registry.ts`; and
**nothing in M26 is blocked on a pending decision** — Mitchell answered both of
the ones that gated work on 2026-09-19, so the Map rail gets its hover card and
*"where does the phone edit"* is **sequenced last in Wave 2** rather than left
open.

**M13 — COLLABORATION — IS NEXT, NOT CURRENT.** It was current from M23's gate
closing until M26 was placed on the same day; nothing about its scope changed.
Scope and gate: `docs/milestones/M13-collaboration.md`. Near-real-time sync
(the transport ADR is a **prerequisite**, not a deliverable), concurrent-edit
conflicts as resolvable data, and **per-stop attribution** — which M19 link 3
depends on, so if M13 ships without it that link returns to M19.

**M13's OWN preflight is still owed, and it has been dropped once already.**
(Not M26 link 0, which is done — this is a different preflight.) The
activity-field descriptor refactor (`KI-20260905-o`) runs **once, before M13**:
21 non-test files hand-enumerate activity fields and nothing goes red when one
is missed. It is shared by M13 link 5 (`who`), M19 link 1 (cost kind) and M24.
It was scheduled on 2026-08-29 as *"one overnight batch"* and did not happen —
which is why M13's gate now carries a box for it rather than trusting anyone to
remember.

**M23 SHIPPED 2026-09-19** — gate 11 of 11, merged as `7763913` (#192),
migration dispatched, production verified at 25/25 the same session. A saved
day generalises into a saved **sequence** in the same row: flat `stops[]` with
a 0-based `dayIndex` defaulted to `0`, plus a stored `day_count`. **The
narrative is not here** — `docs/milestones/M23-multi-day-playbooks.md` carries
the gate evidence, the retro and the feedback round;
`docs/architecture/ADR-048-a-playbook-is-a-sequence-of-days.md` carries the
five decisions, two of them marked ✳ where they overrode a premise in the
milestone file; and `docs/milestones/README.md`'s *2026-09-19* note carries
what it leaves M12.

**Three things M23 leaves live**, which is why they are here rather than in its
retro:

- **The `saved_days` row will not change shape again for this reason.** That
  was the whole argument for running M23 before M12, and M12 can now key
  `saved_day_reviews` to it.
- **`SavedStop` carries a rule in its header**: every field added to it from
  2026-09-19 onwards carries `.default()`. `KI-2026-09-05-l` is **amended, not
  closed** — there is still no `{ v, stops }` wrapper, so the first genuinely
  non-additive change to that shape has nowhere to land.
- **Two quality gates cannot see a whole class of defect, and both were proven
  blind by this milestone.** The colour wall scans for raw hex, so an
  **undefined token NAME** passes it clean — a selected chip shipped with a
  transparent background. And no test layer can hold a layout claim (jsdom has
  no layout; the lint wall refuses `toHaveClass`), so a code comment asserting
  a label fit its cell was wrong by 10.19px for two commits until somebody
  measured it on a preview.

**The integration lane needs `API_TOKEN_PEPPER` set in the shell.**
`apps/web/.env.local` ships it EMPTY and vitest's `??=` does not override an
empty string, so a fresh container fails ~91 token tests that have nothing to
do with the change under test. That is `KI-2026-09-19-a`, and it cost a full
baseline run to confirm rather than assume.

**M25's GATE CLOSED 2026-09-19** — 14 of 14 boxes, `pnpm check` green (765
tests) and `test:e2e:ci-like` at **137 passed**. A trip downloads as a
`content-bundle/v1` file and uploads back, through two `v1` endpoints the
browser calls with its own cookie. **No migration, no contract change, no
entitlement, no plan version.** The narrative is **not here** —
`docs/milestones/M25-a-trip-is-a-file.md` carries the gate evidence and the
retro, including the three boxes ticked with a caveat named.

**Three things M25 leaves live**, which is why they are here rather than in its
retro:

- **The round trip is a tripwire now, not just a test.** M23, M24, M13 and M14
  each make a trip carry more; a field added to an activity and not to
  `toBundleStop` fails `fromTrip.test.ts` **in the diff that adds it**. That is
  what M25 was placed early to buy, and it is now real.
- **A derived reference can be FALSE rather than merely verbose.** M22's
  `openapi.json` cannot drift from the route declarations — which guarantees the
  doc matches the *declaration*, and says nothing about whether the declaration
  matches the endpoint. One endpoint's entry was 2,267 lines of recursive
  notebook AST for a section it never writes. **Check what a new endpoint
  publishes, not just that it publishes.**
- **The two doors into the bundle format stay different.** `content:import`
  DERIVES ids so a re-import updates its own rows; a user upload MINTS them so
  it can never land on somebody else's trip. Collapsing them is a
  plausible-looking simplification and is the one change that would make an
  upload dangerous.

**M22's and M21's gates closed 2026-09-19** — 19 of 19 and 17 of 17 — with the
last boxes ticked **on Mitchell's attestation** that he walked them and they
worked, not on agent-recorded evidence. Basis and caveats:
`docs/milestones/README.md`, *2026-09-19 — M21's and M22's gates closed*.
**The tail of that order changed 2026-09-18** — three milestones minted (**M23**
multi-day playbooks, **M24** travel legs, **M25** trip export/import) and **M13
moved ahead of M12**, all by Mitchell in a design conversation. The reasoning is
**not here**: `docs/milestones/README.md`'s *2026-09-18* note carries it, the
Phase 3 table carries each milestone's decisions, and each new file carries its
own scope and exit gate. Two things placed the same day are **not** milestones
and are easy to lose for that reason: the activity-field descriptor refactor
(`KI-20260905-o`) runs **once, before M13**, and is a gate box there; and a
generated, drift-checked architecture map is designed in
`docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md` and approved
in principle.
Scope and the gate — **19 of 19, closed 2026-09-19**, the last box on Mitchell's attestation — are in `docs/milestones/M22-public-api-and-tokens.md`; the fully decided
design behind it: `docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`.

**Post-gate follow-up, SHIPPED and live in production 2026-09-18** (#189, merged as
`c42be58`): a v1 caller can give a stop coordinates, a structured postal address, or just a
name, and the stop gets a pin — `Location.address` (the CLDR / libaddressinput model),
resolution on the stop writes reported through a `Geocode-Outcome` header, and
`GET /v1/trips/{tripId}/geocode` for looking coordinates up first. No new scope and no
migration, so nothing was owed after the merge. How to call it:
`docs/guidelines/using-the-api.md` → *Putting a stop on the map*; the decisions and task
breakdown: `docs/plans/2026-09-18-api-locations-address-geocode.md`.
**Not gate work** — M22's 19 boxes are unchanged by it.

**M21'S GATE CLOSED 2026-09-19 — 17 of 17**, the last six boxes **on Mitchell's attestation**
that he walked them and they worked; no agent walked them and no network log or Test Clock
evidence is recorded. Two carry a caveat in the milestone file (`KI-20260919-e`; box 2's
`premium@v1` clause). What follows is the state as recorded while it was paused
(2026-09-16 → 2026-09-19), kept rather than deleted.

**The reorder costs M21 nothing, and an earlier version of this file said otherwise.**
M22 needs an account holding `api.tokens`, not a sale — an admin grant pins
`livePlanVersion(planId)` (`api/admin/grants/route.ts:29`) and `resolveEntitlements` unions the
held plan with every grant's pinned version, which is what M20 built the grant path for.
Publishing `premium@v2` does mean a later Premium purchase verifies v2's Stripe Price rather
than v1's, leaving v1 — unsellable, unheld and ungrantable once superseded — with a Price that
was never created; `checkPriceConsistency` calls that `missing`, *"an ordinary state"*, not a
finding. **That is M21's footnote to settle on M21's schedule, not a gate on M22.**

**All four phases are written and merged** (#177, then #180 and #181) — the subscription
table and priced plan versions, hosted checkout and the webhook, the `plans` route with the
account sheet's billing surface, and the revenue half of the operator console.
**Eleven of seventeen gate boxes are ticked with evidence.**

**A real purchase and a real downgrade were walked in production on 2026-09-16**, and the
database is the evidence rather than the screen: four `billing_events` rows, every one with
`applied_at` set, in the order `customer.subscription.created` →
`checkout.session.completed` → `invoice.payment_succeeded` →
`customer.subscription.updated`; and one `subscriptions` row that after the downgrade reads
`status: active`, `cancel_at_period_end: true`, `current_period_end: 2026-10-16` — access
running to the end of the paid period rather than ending at the click. That closes the
hosted-checkout box, the Stripe-driven half of the cancel box, and the migration box, whose
dispatch was confirmed against the database (`subscriptions`, `billing_events.applied_at`
and `users.stripe_customer_id` all present) rather than against `TODO.md`.

**The walk was only possible because it found a defect first, and that is the part worth
keeping.** Every paid path — first checkout and plan change alike — answered 500 in
production: `findPriceByLookupKey` sent Stripe's `lookup_keys` ARRAY parameter as a scalar,
so Stripe refused with `400: Invalid array`. Nothing caught it because `prices.test.ts`
mocks that function wholesale, and `stripeApi.ts` — the module that builds every outbound
Stripe request — **had no test file at all**. The bug lived below the mock line. #181 fixes
the two brackets and adds `stripeApi.test.ts`, which stubs `fetch` and asserts the URL that
actually leaves the process. **A mock is a boundary, and the code on the far side of it is
untested until something asserts the wire.**

**What the gate still wanted** *(as of the pause; closed 2026-09-19 on attestation)* was the failure half: a `past_due` account through its
three-day grace window, and a lapse walking M20's collaborator cap. Neither costs money —
a Test Clock and card `4000 0000 0000 0341` walk both locally, per
`docs/guidelines/billing-without-spending-money.md`. Also open: one Premium purchase (to
resolve that version's Price the way the live `plus` purchase resolved its own), the
network-log observation for the no-card-data box, and the retro. The milestone file's *What was
built* has the five deviations from its own scope, each with its reason; **ADR-047** carries
the three decisions that are one-way doors.

**PR #177 collected three reviews and they found sixteen defects in code that passed every
local lane** — four of them expensive: an existing subscriber could be charged twice, a failed
webhook delivery lost its event permanently, the confirm step promised a payment it did not
collect, and the pending screen claimed a payment had happened on a forged URL. All fixed;
the milestone file's *What review found* has the list and the lesson. **The lesson in one
line: every one of the four had a passing test over it — asserting presence, or state, or a
substring, on the exact path where the defect lived.**

**Then a fourth review arrived, on the preview itself** (2026-09-15) — five Vercel toolbar
threads, a surface with its own mechanics that `docs/guidelines/working-a-review.md` covers
and that no GitHub check surfaces as a review. **Four were design decisions this build had
got wrong, not bugs**, and two of them reverse M20's §17.3 in the same words: a gated
affordance now STAYS on screen, disabled, under a CTA to `plans`, rather than not rendering
at all. M20's reasoning ("a control that can never work") was right when there was nowhere
to send anybody; §29 gave plans a route, so the premise expired. The assistant's gate also
moved EARLIER than the server's 402 — `useAiEntitled` asks the plan before anything is
typed. The fifth is a design question with a wrong premise, answered on the thread and filed
in `TODO.md` → *Candidate ideas* rather than guessed at. **The threads stay unresolved until
Mitchell resolves them** — that check is a human gate, and clearing it from this side would
be defeating a control rather than passing it.

**What is left is a walk against a real Stripe test-mode key**, which no lane in this repo
has — exactly what the milestone's *Why it is separate* predicted. **Nothing about it costs
money, and the recipe is `docs/guidelines/billing-without-spending-money.md`**: test cards,
`stripe listen`, and Test Clocks for walking the three-day grace window without waiting three
days. Read the one rule at the top of it before opening a Stripe dashboard.

**Migration `0021_subscriptions_and_billing` is written and applied locally, and is NOT
dispatched to production.** Merging does not apply it — see the standing rule below.

**Three things this work leaves live, all of them instruction rather than history:**

- **A lapse is a derivation, not a write** (ADR-047 decision 3). The subscription row keeps
  saying what Stripe last said and the resolver computes what it MEANS against the clock, so
  nothing runs on a schedule and there is no second downgrade path. The tempting change —
  writing `free` when a grace window closes — is the one that would need a scheduler, and it
  would break link 4's sole writer to get it.
- **The webhook is the only thing that writes `subscriptions` or `users.plan_id`**, and
  `soleWriter.test.ts` sweeps for a second. The second writer is never called "grant the plan
  from the redirect": it is a helpful success route that updates the row so the page has
  something to show.
- **`GRACE_WINDOW_DAYS = 3` has one definition and three readers** — the resolver, the copy a
  person reads, and the test. It is a guess that first contact with real declines will want to
  revise, which is the whole reason it is one constant.

**M20's gate closed 2026-09-14** — 32 of 32 live boxes, built as #174 and #175, migrations
0019 and 0020 dispatched to production (`migrate-production` run 20) and checked against the
database, the operator console walked on production and the account surfaces on a preview.
**The narrative is not here**: what it cost, the two findings a browser produced that no test
could, and the two boxes ticked with a caveat named are the retro in
`docs/milestones/M20-account-tiers-and-entitlements.md`.

**Four things M20 leaves live, which is why they are here rather than in its retro:**

- **A plan is a set, not a rank.** Code asks `can(ent, "ai.ask")` and nothing compares plans.
  `accessPolicy.ts:11`'s `RANK` is the right shape for roles inside a trip and the wrong shape
  here; copying it is the obvious move and it is a one-way door. The buyer's ladder is
  presentation only.
- **The console has no revenue half, and a test keeps it that way.** The four-number strip and
  the per-tier MRR and median-margin columns are M21 link 7's; `admin.console.test.ts` sweeps
  the admin files for that vocabulary. M21 link 7 also replaces one function body,
  `startPlanChange` in `PlanSection.tsx`. **A price string in M20's files means the split
  failed, in either direction.**
- **The first operator exists and the path is not obvious**: `ADMIN_USER_IDS` takes `users.id`
  verbatim (`google-<sub>`, never an email), comma-separated and not a JSON array, injected at
  deploy time so it needs a redeploy, and written to `users.is_admin` on that account's next
  sign-in. It fails closed on every one of those, which is why a mistake looks like silence.
  The `admin-console` flag is the same promotion with no deploy.
- **`ai_usage` is best-effort on the abort and error paths** — `KI-2026-09-14-b`. The ledger
  M21 prices against is complete for every turn that finishes and eventual for the rest.

**M9 IS NO LONGER PAUSED, AND MOST OF ITS REMAINING BUILD LANDED 2026-09-16** on
`claude/dreamy-meitner-4o27ml`, under `docs/plans/2026-09-16-M9-remainder.md` — which is
also where the four build-order items it deliberately did NOT touch are listed (the
theme pass, the draft trip, the paid fork; the transcript rebuild has since landed). It
keeps its place after M21 for the *gate*, which is what is left of it.

**IT WAS REVERTED AND RELANDED, AND THE HISTORY MATTERS MORE THAN THE DATES.** Both halves
(#184's server side, #186's UI) were merged, then reverted wholesale in `17ecd52` at
Mitchell's request — *"there was some bad ui problems, but i was struggling to get code
rabbit to review"*. Reverting content does **not** un-merge commits, so neither branch could
serve as a PR head again: git treats them as already merged and a PR from either shows an
empty or half diff. The work came back as fresh commits in **#188**, whose diff and merge
therefore agree, and that is what `90deaaa` squashed onto main on 2026-09-18. Two design
passes and three review rounds landed on it there:

- **`SPEC.md` §31** — the new-trip sheet reads as a conversation (two sides, the live
  question as the last message, one answer dock), and the empty Home renders that
  conversation instead of a numbered list describing it.
- **`SPEC.md` §32** — the dates turn split in two ("do you have a start date", then an
  optional day picker, then a length), so **the question list is derived and nothing states
  its length, including the copy**. A trip is a start date plus a length on this surface now,
  as it already was everywhere else.
- **Three CodeRabbit rounds, eighteen findings**, every one verified against the code before
  being believed; two push-backs accepted and filed as `KI-2026-09-17-b`/`-c`.
- **The preview found two defects no test layer could**, on Mitchell's own walk: the sheet
  *contained* a chat box rather than being one (`Sheet`'s scrollport is a block, so the
  conversation's `flex-1` transcript had nothing to fill and the composer scrolled off the
  fold), and the sheet was being closed under a reader who was typing into it. That is the
  argument for the walk, made by the walk.

`docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md` §3a–§3f carries all of it.
**No gate box moved**, which is the point of the next paragraph.

**Grounding** (`search_places` → `placeRef`, resolved server-side), **KI-93** (every door
into the vendor key charges the geocode quota), **KI-12**, **escalation + `certainty`**,
**conversation durability** (`localStorage`, no table) and **the replay harness**.
Resolved with them: **KI-81, KI-11, KI-2026-09-12-a**; KI-15 narrowed to its enrichment
residual. The milestone file's exit gate carries what each one did and did not close.

**Four things to know before touching it.**

1. **What is left of the gate is what a build cannot supply**: a live model call, the
   Rochester re-run that rests on one, and the browser walks. The replay lane is evidence
   about the code AROUND the model and is **not** the live-call box — its own header says
   so, and the five transcripts that ship declare `source: synthetic`.
2. **The harness found a defect on its first run** — `KI-2026-09-16-a`: a tool call whose
   arguments were truncated ends the WHOLE turn, losing the reads it had already paid for.
   Exactly the class KI-11 said CI could not see.
3. **`Location.precision` is server-written by construction now.** A model's claim is
   stripped before the server's is written, and `enrichCommandLocations` SKIPS a location
   that already carries it — so the field is load-bearing rather than descriptive, and
   that is what closes the gap `contracts/src/activity.ts` names in its own comment.
4. **A `withheld` turn is no longer a dead end.** It holds `request_change_tools` and
   re-enters with the write set via `prepareStep`. Every escalation is a labelled
   classifier miss on the `ai.ask` line, which is the eval corpus written by real use.

Phase 0 is below, unchanged, because it is what all of the above is built on.

**M9 PHASE 0 — THE ASSISTANT KERNEL — IS COMPLETE, 2026-09-11.** Two PRs, both merged:
P0-P5 as `bbc5bdb` (#162) and P6 as `845fc48` (#163). It closed **KI-2026-09-05-t** and
**KI-22**, and ticked **no gate box**, by design — it is what M9's three real pieces of work
are built on.

**The narrative is not here.** What landed phase by phase, what it cost, the squash-merge
hazard that cost the most, and the three open questions it raised for Mitchell are in
`docs/milestones/M9-ai-planning-partner.md` under "Phase 0". Decision and the five rules:
**ADR-043**. Design, corrections and measurements:
`docs/specs/2026-09-10-assistant-kernel-design.md`.

**The one-line version, because it is the thing to know before touching the assistant:**
`handleAskRequest()` went **455 -> 105 non-comment lines** while the comment record grew
**634 -> 996**; a tool is now a module with a required output schema and declared
dependencies, a scope is a grant of (domain, effect) pairs and the tool set is a *filter*,
admission is a nine-stage array whose order a test asserts, tool-returned user content is
fenced in `⟦…⟧` inside the system instruction, and a turn returns a `TurnLedger` shaped as
M20 link 9's `ai_usage` row — with **model identity and cost as variable inputs**.

**Four known issues were filed by doing the work** and are open: `KI-2026-09-11-a` (a
`userId` in Sentry breadcrumbs), `-b` (`simulatedModel`'s unchecked cast), `-c` (two
`modelSelection` tests read `serverConfig` at module load), `-d` (`TurnMeter.toolCalls()`
hands back its live array).

**Two fixture trips are still on the preview database** from #162's browser walk: `Kyoto
pass 162` and `Blank slate 162`. **M20's gate walk (2026-09-14) left three more things
there**: the account `dev-gatewalk314819` (created through `/signup` with a real referral
code, so it carries the signup trial), its trip `GateWalk Kyoto 9583`, and an unredeemed
referral code minted by `dev-alice`. None is load-bearing; all four dev accounts on preview
also carry `0019`'s permanent `founder` premium grant, which is why a preview account cannot
demonstrate the free tier's refusals — that negative belongs to the e2e lane, which controls
its own grant state.
