# M18 — A stop knows what kind of thing it is

**Status:** Approved 2026-08-26, **in flight**. PR 1 (the contract change) is
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
fields gate the Calendar's travel-day split and `N to book`, the home hero's
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
| Calendar travel days | Split at the **LAST `transit` stop** — departing city becomes a one-line strip, arriving city the full card | SPEC §12 |
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
- Then, and only then: Calendar's transit split and `N to book`, the home hero
  tile, and `act.badge`.

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
- [ ] Calendar groups a day by **city alone** — one equal full card per city,
      no strips — plus a single untitled bucket card for stops with no city.
- [ ] A day's label reads `<yesterday's last placed city> → <today's last
      placed city>` when they differ, and just the city when they don't.
- [ ] `N to book` counts stops whose kind is neither `booked` nor `transit`,
      per card, and renders only when > 0.
- [ ] `act.badge` renders from `kind` — Booked / Holding / Idea / Travel — and
      renders **nothing** for `planned`, per the handoff's own map
      (`dc.html:3740`, which falls through to an empty string).
- [ ] Tag chips render on stop cards, four values not the handoff's six (KI-52).
- [ ] **A kind and a tag can be set from the stop editor, on a trip you created
      yourself** — not only on seeded data.
- [ ] The home hero's "not booked" tile replaces "days planning", counted off
      the live `TripDetail` the hero already fetches.
- [ ] No surface reads a kind out of `notes`, and the seed stops folding it in.
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
