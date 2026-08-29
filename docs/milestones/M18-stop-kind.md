# M18 — A stop knows what kind of thing it is

**Status:** **Done, gate closed 2026-08-29.** PR 1 (the contract change) is
done — see "PR 1" below; PR 2+ carries the dependent surfaces. Phase 2, after
M10's Wave-2 gate and **before M16**.
**Opened by:** Mitchell, reviewing SPEC §12 — *"Keep Stop Kind as a future
milestone, lets just ship what we can for now."*
**Scheduled and widened by:** Mitchell, PR #55 retrospective — *"i dont want to
do KIND and TAGS right now, but we can put it in a soon milestone."*

## Two fields, one milestone

This milestone carries **both** of the activity fields the design assumes and
the contract lacks: **`kind`** (below) and **`tags`** (KI-47). They were filed
separately and are deliberately merged here, because they are the same piece of
work: one change to `ActivityView`, one set of commands and events, one
projection change, one migration-and-backfill decision, and one contracts
changelog entry. Doing them in two passes pays that cost twice and puts two
migrations through the event store where one would do.

Between them they are the largest single unblocker on the board — the two
fields gate the Calendar's `N to book`, the home hero's
"not booked" tile, `act.badge`, and design rules R4 and R5. **Everything below
about `kind` applies to `tags` in the same shape**; KI-47 holds the detail on
which five surfaces want tags and why a filter control cannot be built without
them.

## Why this exists

A stop has no `kind`. `ActivityView`
(`packages/contracts/src/detail.ts:7-15`) is `activityId`, `title`,
`timeWindow`, `location`, `notes`, `anchors`, `cost` — there is no
`booked`/`hold`/`idea`/`transit` on it, and no command sets one.

The seed knows and works around it, in its own words (`db-seed.ts:195-205`):

> Folds status/who metadata (**not modeled by the domain**) into the notes field
> instead of dropping it.

which is why cards read `(transit)` and `(idea) (Sam K + Jonah M)`. **The kind
exists only as free text inside a note a user can edit.**

## What it blocks

This began as one cosmetic tile and is now load-bearing in three places:

| Surface | Needs | Design |
|---|---|---|
| Calendar city cards | `N to book` — "every stop whose kind is neither `booked` nor `transit`" | SPEC §12 |
| ~~Calendar travel days~~ | ~~Split at the **LAST `transit` stop**~~ — **built and removed 2026-08-29**, see below | ~~SPEC §12~~ |
| Home hero | The "7 not booked" tile | `NextTripHero.tsx:188-191` |
| Stop cards | `act.badge` (Booked / Hold / Idea) | handoff |

M10's Calendar work (`docs/design-feedback/2026-08-26-spec-12-calendar-city-view-review.md`)
ships the city cards **without** the two SPEC §12 rules above, by Mitchell's
call. The cards group a day's stops by `location.city` instead — which is
correct for every day in the current seed, since the seed files a travel stop
under the city it travels *to*. When this milestone lands, the grouping helper
gains the transit rule and the unbooked flag; the presentation does not change.

## Why not parse it out of the note

Two reasons, both fatal:

1. It makes a **display concern depend on prose**. `(transit)` is text a person
   typed and can retype.
2. It breaks silently the first time someone edits a note, and the failure looks
   like a rendering bug rather than a data one.

## Scope

- A `kind` on the activity contract, and the commands that set it — including
  what a stop's kind is when nothing says (`planned`? absent?).
- Event and projection changes, plus a migration/backfill decision for stops
  whose kind currently lives in note text. Note the seed and the design's
  `japan-trip-seed.json` export both carry it as `(status)` prose; a backfill
  that parses those **once, at import** is legitimate in a way a render-time
  parse is not.
- Then, and only then: Calendar's `N to book`, the home hero tile, and
  `act.badge`. *(The transit split was in this list, built, and removed —
  see "The transit split, built and removed" below.)*

## Exit gate

**PR 1 (the contract change) is done — see below. PR 2+ carries the surfaces.**

**Amended 2026-08-29 by Mitchell** — three boxes to eight. The gate as written
measured only `kind`, while the milestone's own scope carries `tags` too, and
three of the surfaces in scope (`act.badge`, the tag chips, the home-hero tile)
had no box at all. Two scope calls made in the same decision, recorded here
because a gate definition changes only by explicit decision
(`docs/milestones/README.md`):

1. **Tag *focus* is out** — SPEC §11's click-a-chip-to-dim behaviour across
   Timeline, Day columns, Calendar and Map is carved out as **M18b, approved
   and unplaced**, the same treatment M11b Playbooks got at M11's gate the day
   before. Tag *chips* stay in: they render and are settable here.
2. **The stop editor gets a kind picker and a tag picker.** Without them every
   surface below renders only on seeded data and stays permanently empty on a
   trip a user creates — a fixture showcase rather than a product capability.
   The new box 7 is what tests that difference, deliberately phrased as "on a
   trip you created yourself".

- [x] A stop's kind is a real field, set by a command, visible in the projection.
- [x] A stop's **tags** are a real field on the same terms (KI-47), landing in
      the same contract change rather than a second one.
- [x] ~~Calendar splits a travel day at the last `transit` stop, with the
      departing city as a strip carrying that stop's **start** time.~~
      **Removed 2026-08-29 by Mitchell — replaced by the two boxes below.**
      It was built, walked, and withdrawn the same day; see "The transit split,
      built and removed" below for why.
- [x] Calendar groups a day by **city alone** — one equal full card per city,
      no strips — plus a single untitled bucket card for stops with no city.
- [x] A day's label reads `<yesterday's last placed city> → <today's last
      placed city>` when they differ, and just the city when they don't.
- [x] `N to book` counts stops whose kind is neither `booked` nor `transit`,
      per card, and renders only when > 0.
- [x] `act.badge` renders from `kind` — Booked / Holding / Idea / Travel — and
      renders **nothing** for `planned`, per the handoff's own map
      (`dc.html:3740`, which falls through to an empty string).
- [x] Tag chips render on stop cards, four values not the handoff's six (KI-52).
- [x] **A kind and a tag can be set from the stop editor, on a trip you created
      yourself** — not only on seeded data.
- [x] The home hero's "not booked" tile replaces "days planning", counted off
      the live `TripDetail` the hero already fetches.
- [x] No surface reads a kind out of `notes`, and the seed stops folding it in.
      *Seed half done in PR 1* — `buildNotes` no longer folds `(status)`, and a
      live reseed shows zero notes carrying one. The "no surface reads" half
      can only be asserted once PR 2 builds the surfaces that would have.
- [x] Contracts changelog entry; projection-rebuild golden test still passes.

## The transit split, built and removed (2026-08-29)

SPEC §12 specifies that a travel day splits at its **last `transit` stop**, the
departing city rendering as a one-line strip carrying that stop's start time.
It was implemented, walked against the canonical Japan fixture, and withdrawn
the same day. The reasoning is recorded here because the design still specifies
it, and because the next person to read SPEC §12 will otherwise rebuild it.

**What the walk showed.** Across the trip's seven travel days the rule produced
**one** departing strip, and that one was wrong — day 14 rendered `Tokyo →
Tokyo`. Two causes, both in the data rather than the rule:

- On days 4, 6, 7, 11 and 13 the transit stop is the day's **first** stop, so
  nothing precedes it to name where you left from. The implementation correctly
  declined to split rather than print a strip it could not label.
- Every stop on a travel day carries the **destination** city (**KI-59**),
  including the ones before you leave — day 14's Osaka hotel breakfast is
  tagged Tokyo. So the one day that did split named the wrong origin.

**Mitchell's call, and the principle behind it.** *"I don't think the shape of
the fixture should drive functionality, that's how we get drift."* The rule's
output depended on how the fixture happened to tag cities, which is precisely
that failure. And on what the view is for:

> I kinda always pictured the calendar page a zoomed out trip, what cities are
> on what days of the week, it doesn't really concern itself with the day of
> activities, which is what transit is about. Timeline view and map view is how
> I zoom in and see a specific day, how I get around.

**What replaced it.** The transition a travel day expresses is now the *day
label's* job, from a rule Mitchell specified directly: compare yesterday's last
placed activity's city with today's; if they differ show `A → B`, otherwise
show the city. No `kind`, no dependence on how any single stop is tagged. The
Calendar cell groups purely by city, every group an equal card, plus one bucket
for stops with no city.

**What this costs, accepted deliberately.** SPEC §12's strips existed to keep
cell heights even across a week; equal cards give that up, so a three-city day
is a visibly taller cell. Mitchell chose it on his own worked example — 3 Tokyo,
1 Kyoto, 1 unplaced, *"I would expect 3 cards"* — and the reason it is the right
trade at this zoom is that which cities a day touches **is** the information the
view exists to show.

**Recorded as a deliberate delta from the design**, the same way KI-52 records
the four-tags-not-six decision. KI-59 keeps the underlying data question.

## PR 1 — the contract change (2026-08-27)

Split out because `AGENTS.md:161` requires it: *"a contract change (schema +
changelog + all consumers) is its own reviewed step before dependent feature
work continues."* Nothing changes on screen when it merges.

Three decisions, Mitchell's calls on 2026-08-27:

1. **`kind` is non-nullable, five values, default `"planned"`.** `planned` was
   already the zero value in `db-seed.ts` and in `japanTripImporter.ts`'s
   `StopStatus`. Nothing on the board needs to tell "never set" from
   "explicitly planned".
2. **Four tags, not the handoff's six.** `considering` and `travel` restate
   `kind: idea` and `kind: transit`; two settable fields that can disagree about
   one fact is a bug generator. Recorded as a design delta in KI-52.
3. **Tags are hand-authored in `db-seed.ts`.** The export carries none, and the
   only "source" is the prototype's `inferTags()` regex over title text — the
   prose parse this milestone disqualifies, merely moved to import time.

**There is no migration.** The scope note above anticipated one; it turned out
not to be needed. Both fields were added to the **existing V1** payloads with
Zod `.default()`, the same mechanism M3 used for `anchors` and M4 for `cost`, so
every event already in the store replays as `planned` / `[]`. No V2 event, no
event rewrite, no backfill of stored data.

**Also not needed: a note-text parse, anywhere.** The scope note assumed the
kind would have to be recovered from `(transit)` prose. It doesn't: `db-seed.ts`
carried `status` as a typed field all along and merely folded it into notes on
the way out, and the handoff export has a typed `status` on every stop that
`japanTripImporter.ts` was explicitly dropping (*"no AddActivity field models a
workflow status"*). Both are field-to-field maps.

**The one real trap.** `equality.ts`, `diff.ts`, `hydrate.ts` and `detail.ts`
each hand-enumerate activity fields. Adding a contract field without touching
all four compiles cleanly and is wrong at runtime — and `decide.ts` gates
`UpdateActivity` on `okUnlessNoOp`, which calls `activityStatesEqual`, so a
kind-only update was rejected as a no-op until equality learned the field. The
shared property generator needed the fields too, or `diff.property.test.ts`
would have kept passing while never generating either (verified non-vacuous by
removing the diff change and watching the M2 round-trip property fail).

## Retro — what we learned, what changed (gate closed 2026-08-29)

**Evidence.** Full Definition of Done green: `pnpm typecheck` 0 errors across 7
packages; root `pnpm lint` clean including all four walls; `pnpm test` 1,211
passed in `apps/web` plus domain/fixtures/factories/contracts; **`pnpm --filter
web test:int` run directly** — 242 passed, 25 files, including the
projection-rebuild golden test this gate names; `pnpm --filter web
test:e2e:ci-like` **46/46** against a production build. The two flows only a
browser can prove were walked on a real trip created from scratch through the
UI: a stop saved with `kind: "hold"` and `tags: ["meal"]` came back from
`GET /api/trips/:id` carrying both, and its card rendered the **Holding** badge
and the **Meal** chip. The home hero showed **0 not booked** where "days
planning" used to be.

**KI-76 was live on this machine and is exactly as described.** `pg_isready` is
absent while Postgres runs in Docker on :5433, so `pnpm check` would have
reported success having run zero integration tests. Running `test:int` directly
is not a nicety here; it is the difference between 242 tests and none.

### The lesson worth keeping: a rule that reads the data's shape is not a rule

SPEC §12's travel-day split was built exactly as specified, and it was wrong —
not in its logic, which was correct and unit-tested nine ways, but in its
dependence on how the fixture happened to tag cities. It fired on **one** of
seven travel days and got that one wrong. The unit tests all passed, because
they encoded the same assumption the implementation did.

**What caught it was walking `/demo`, not the test suite.** This is the same
shape as M10's Wave-2 gate ("the walk found and fixed one defect the automated
suites are structurally blind to") and M11's. Three milestones running, the
browser walk has found something no test could. It is not a formality at the
end of a gate; it is the step that tests the assumptions the tests share with
the code.

Mitchell's framing when shown it: *"I don't think the shape of the fixture
should drive functionality, that's how we get drift."* The replacement rule —
compare yesterday's last placed city with today's — reads no `kind` and depends
on no tagging convention. Full account above in "The transit split, built and
removed"; the underlying data question stays open as **KI-59**, now escalated,
with the note that **KI-60 had already removed its stated reason for staying
open** the day before.

### A field enumerated by hand is a field that will be dropped

`ActivityEditorSheet.handleSave` builds its commands by listing fields, so the
editor's new pickers wrote to nothing: a user chose "Holding" and "Lodging",
hit Save, and the choice vanished. TypeScript cannot see it — an unread extra
property on the value object is not an error — and every test in that file
passed throughout.

That is the **third** time this milestone met the same shape: PR 1 hit it in
`equality.ts` / `diff.ts` / `hydrate.ts` / `detail.ts`, the 2026-08-28 project
review found it in `Location.city` (KI-54), and now the sheet. A fourth and
fifth enumeration exist and are currently harmless only because they are dead
(`TripBoardScreen.tsx`'s `updateActivity` and its inline `AddActivity`, wired to
`BoardCallbacks` props `Board` never invokes). **§6.1's activity-field
descriptor refactor is the standing fix and has now earned its place**; the
dead pair should be wired or deleted before it lands, because they sit directly
in its path.

The test that pins it asserts on the *dispatched command*, not on the form —
the only level at which the bug is visible.

### Two smaller things

**A test fixture that gives every stop its own city hides a real coupling.**
`MapLens.test.tsx` defaulted each stop's city to its own id, so a day's accent
depended on which stop `cityFor` happened to read. Invisible while the rule said
"first"; a failure the moment it said "last". Fixtures should look like the data
they stand in for — a day's stops share a city.

**A jsdom "bug" that was the guard working.** Interactions in the editor sheet
appeared to discard each other, which looked like user-visible data loss. It was
the `pending → loaded` key remount from PR #32 firing at the first `await`,
because the test rendered before the trip fetch resolved. In the app the sheet
renders below `TripBoardScreen`'s loading gate, so the branch is unreachable —
confirmed by the browser walk, where kind and tag both held. Worth recording
because the symptom was indistinguishable from a serious defect, and the
resolution came from instrumenting mount/unmount rather than from reasoning.

### What was carved out

**M18b Tag focus**, approved and unplaced — SPEC §11's cross-lens dimming, the
behaviour behind the chips this milestone made settable. Carved on the same
three grounds as M11b Playbooks the day before: it is the only part needing
shared state above the lens switch, its Calendar rule is a second design, and no
gate box measured it. Unlike M11b its scope and exit gate are written, so it
needs only a place.

Also corrected here: **KI-47 cited a tag filter row that SPEC §11 deleted** a
day after the handoff KI-47 was written against, and SPEC §10's mobile claim
rests on the same dead control. Four days of our own documentation pointing at
something that no longer existed — and it was in the plan, about to be built.
