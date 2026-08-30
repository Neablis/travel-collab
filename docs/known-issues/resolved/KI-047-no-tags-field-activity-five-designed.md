### KI-47 — No `tags` field on an activity, and five designed surfaces depend on one — RESOLVED
- **Resolved (2026-08-27)** by M18's contract PR. `ActivityTag`
  (`meal|lodging|ticketed|outdoors`) is a real field on `AddActivity`,
  `UpdateActivity`, both V1 event payloads and `ActivityView`, landing in the
  same contract change as `kind` exactly as the milestone intended — one
  `ActivityView` change, one command/event set, one projection, one changelog
  entry, and (as it turned out) **no migration at all**: the payload additions
  default, so every stored event replays as `planned` / `[]`.
- **Four values, not the handoff's six.** `considering` and `travel` are
  deliberately absent — `ActivityKind` already carries `idea` and `transit`,
  and two settable fields that can disagree about one fact is a bug generator.
  See the 2026-08-27 contracts changelog entry, and **KI-52** for the design
  delta this creates in the chip row. (This line said KI-50 until 2026-08-28 —
  KI-50 is the Google-sign-in preview redirect URI and has nothing to do with
  tags; KI-52 is *"The tag chip row ships four tags where the handoff designs
  six"*, and it cross-references back here.)
- **Where the tag data comes from:** the handoff export carries no tags on any
  of its 68 stops (its `enums` block lists only `stopStatus`), so the importer
  deliberately synthesises none — inferring them from title text is the prose
  parse the milestone disqualifies. `db-seed.ts` instead carries hand-authored
  tags on all 68 stops: 33 `meal`, 11 `outdoors`, 8 `ticketed`, 4 `lodging`,
  18 untagged.
- **One of the five surfaces below no longer exists — corrected 2026-08-29.**
  This entry was written against the 2026-08-24 handoff. **SPEC §11, dated
  2026-08-25, deleted the tag filter row**: *"The header filter row is **gone**.
  Tag chips on a stop are now the control: clicking 'Meal' on a stop dims
  everything not tagged Meal to 32% opacity across Timeline, Day columns,
  Calendar and Map… Single focus, one tag at a time — multi-select was the part
  that earned its keep least."* So `showTagFilter` / `tagFilters` / "Show
  everything" describe a control that was removed a day after this entry cited
  it, and **SPEC §10's "the filter row is the only way to thin a 402px column"
  is stale in the same way** — mobile thins a day with tag focus now. Nothing
  should be built against either sentence. What replaced the filter row is tag
  focus, which is **M18b**.
- **Status after M18b (2026-08-30):** chips on stop cards and the Add/Edit tag
  picker were built by M18's PR 2+; tag *focus* — the dimming behaviour that
  replaced the filter row — is **built by M18b** and the chips are now the
  control that drives it. M18b's gate has not closed (it needs a deployed walk;
  see that milestone file), but nothing about this entry is outstanding any
  more: the replacement for the deleted filter row exists. The Notebook
  repeater's `Only stops tagged …` filter (SPEC §7) belongs to **M14**, which
  owns the whole Notebook redesign by the 2026-08-23 routing, not to M18 or
  M18b.

- **Scheduled (2026-08-26):** this is now carried by **`docs/milestones/M18-stop-kind.md`**,
  which was widened on Mitchell's call — *"i dont want to do KIND and TAGS right
  now, but we can put it in a soon milestone"* — to land **both** missing
  activity fields in one contract change. `kind` and `tags` are the same piece
  of work (one `ActivityView` change, one command/event set, one projection, one
  migration-and-backfill decision, one changelog entry), and splitting them
  would pay that cost twice. This entry stays open as the detail on *tags*
  specifically; the schedule lives in the milestone.
- **Severity:** cleanup (a contract gap, not a defect — recorded so it stops
  being re-derived per surface)
- **Area:** `packages/contracts/src/activity.ts`
- **Symptom:** `Activity`/`ActivityView` carry no `tags`. The 2026-08-24 handoff
  builds five things on top of tags: chips on every stop card, ~~the tag filter
  row beside the TabStrip (`showTagFilter` / `tagFilters` / "Show everything")~~
  (**deleted by SPEC §11 the next day — see the correction at the top of this
  entry**), the Add-and-Edit-stop tag picker with its per-tag "power" hint, the
  Notebook repeater's `Only stops tagged …` filter (SPEC §7), and — most
  load-bearing — ~~SPEC §10's statement that on a 402px column the filter row is
  *the only way* to thin a day~~ (**stale for the same reason; mobile thins with
  tag focus**).
- **Why it belongs in the registry rather than here, eventually:** this is the
  same class as `rack-provenance` / `cost-estimate-state` / `budget-breakdown`
  in `preview-registry.ts` (designed, shelled, blocked on a missing field) — but
  unlike those, nothing in the build points at it, so it has no entry and no
  milestone. Give it one.
- **Adjacent, same shape:** the seed encodes per-stop `status`
  (`booked`/`hold`/`idea`/`transit`) and `who` **into the note text**
  (`db-seed.ts`), which is why cards read `(transit)` and
  `(idea) (Sam K + Jonah M)`. The design's `act.badge` (Booked/Hold/Idea) has
  no field behind it either, and the home hero's designed "7 not booked" tile
  is blocked on the same absence (see `NextTripHero.tsx:188-191`).
- **Escalated 2026-08-26 by design sync `fd2edd6` (SPEC §12).** The missing
  stop `kind` stopped being one cosmetic tile and became the mechanic of a
  whole lens: the new Calendar splits a travel day **at the last `transit`
  stop** (departing city gets a one-line strip, arriving city the full card)
  and flags `N to book` from "every stop whose kind is neither `booked` nor
  `transit`". Neither is computable while the kind lives inside note prose a
  user can edit — and parsing it back out would make a display concern depend
  on free text. The Japan seed has five travel days, so a Calendar built
  without it mis-renders a third of the trip rather than degrading quietly.
  **This wants a contract decision before any of SPEC §12's Calendar work is
  scheduled** — see `docs/design-feedback/2026-08-26-spec-12-calendar-city-view-review.md`.
- **First noted:** 2026-08-26 (design-sync UI audit, C4).
