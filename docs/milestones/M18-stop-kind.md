# M18 — A stop knows what kind of thing it is

**Status:** Approved 2026-08-26, **scheduled 2026-08-26**, not started. Phase 2,
after M10's Wave-2 gate and **before M16**.
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

- [ ] A stop's kind is a real field, set by a command, visible in the projection.
- [ ] A stop's **tags** are a real field on the same terms (KI-47), landing in
      the same contract change rather than a second one.
- [ ] Calendar splits a travel day at the last `transit` stop, with the
      departing city as a strip carrying that stop's **start** time.
- [ ] `N to book` counts stops whose kind is neither `booked` nor `transit`, and
      renders only when > 0.
- [ ] No surface reads a kind out of `notes`, and the seed stops folding it in.
- [ ] Contracts changelog entry; projection-rebuild golden test still passes.
