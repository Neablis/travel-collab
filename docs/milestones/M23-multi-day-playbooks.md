# M23 — A playbook can be more than one day

**Status:** Scoped 2026-09-18. **The number M23 was assigned in this session**
— it had no row, no file and no number before today. **Placement is Mitchell's
decision, made in conversation on 2026-09-18: this runs BEFORE M12**, which puts
it after M22 in the standing order (`… → M22 → M25 → M23 → M13 → M12 → M24 → M14 → M19`) — M25 is small and runs first, and M13 also moved ahead of M12 the same day, which changes nothing for this milestone: what matters here is that M23 precedes M12.

**The placement is the one structural decision here, and it is load-bearing.**
M12 builds `saved_day_reviews` keyed on a saved day, plus `rating` and
`review_count` denormalised onto `saved_days` — all of it against a row whose
shape this milestone changes. Running M12 first means M12's table, its counters,
its rating rail and its moderation state are all revisited by the next
milestone. Running this first means M12 keys its reviews to a row that is already
final.

**It needs an ADR before it opens**, and the ADR has real questions left in it —
they are listed under link 1 and they are open on purpose. **It needs one
migration**: merging does not apply a migration; dispatch with
`gh workflow run migrate-production.yml -f confirm=migrate` from `main`, and say
so in the PR body.

## Why this exists

The library holds exactly one unit: **a day**. `SavedDay`
(`packages/contracts/src/saved.ts:101-146`) is a name, an ordered `stops` array
and a provenance snapshot; `CreateSavedDayInput` (`:155-159`) takes one
`tripId` and one `dayId`, and the server reads that single day through
`stopsForDay` (`apps/web/src/lib/savedStops.ts:27`). Everything downstream
follows: `saved_days.stops` is one flat jsonb array (`schema.ts:435`),
`insertCommands` emits exactly one `AddDay` (`savedDays.ts:533-540`), and the
adds ledger's primary key is `(saved_day_id, trip_id)` (`schema.ts:595`).

**Nothing a person actually travels is one day.** A weekend in Kyoto, a
three-day loop, an arrival-day-plus-recovery-day pattern — none of them can be
kept, published or taken. The only way to express one today is to publish three
separate days and hope a reader finds all three and adds them in order, which
the library has no way to say and Discover has no way to rank.

**This milestone generalises the saved day into a saved SEQUENCE.** One day
stays the common case and the default; the object simply stops asserting that
one is the maximum.

### The rejected alternative: a separate "collection" object

The obvious design is a second object — a collection row pointing at N
saved-day rows — leaving `saved_days` untouched. **Rejected, and the reason is
M12.**

M12 adds reviews, ratings, reporting and moderation to **exactly one publishable
object**. A second object type either doubles M12's surface — a second reviews
table or a polymorphic one, a second report target, a second moderation state, a
second set of Discover sorts — or it ships a library containing **two classes of
content with different trust properties**, where a collection cannot be rated or
reported but the days inside it can. Neither is acceptable, and the cost is paid
in the milestone that comes immediately after this one.

So: **the same object, generalised.** A saved day is a saved sequence of length
one.

## Scope

Four links. Link 1 is an ADR and gates the rest.

1. **The shape ADR, and what is already decided in it.**

   **Decided, not open: the stored shape is a FLAT `stops[]` with a per-stop day
   indicator, NOT `days: SavedStop[][]`.** Mitchell, 2026-09-18. The reason is
   migration cost, and it is checkable rather than aesthetic. `saved_days.stops`
   is read through a strict `SavedStop.array().safeParse` that **drops and logs**
   a row it cannot parse — `fromRow` at `apps/web/src/server/savedDays.ts:83-90`
   (`:84`), and a **second copy** of the same parse in `toDiscoverDay` at
   `apps/web/src/server/playbooks.ts:230-238` (`:231`). A flat array with a
   defaulted indicator is an **additive** change: every existing row still parses
   as `SavedStop[]`, and every stop in it reads as day one. A nested
   `SavedStop[][]` is not an array of `SavedStop` at all, so every row written
   before it would fail both parses and **vanish from its owner's library and
   from Discover** — which would have forced a versioned read (a `{ v, stops }`
   wrapper and a migration chain) into this milestone before anything else could
   be built.

   **One correction to that claim, verified against the tree.** The additive
   property is not free today: `SavedStop` (`saved.ts:23-32`) has eight fields
   and **none of them carries `.default()`**, and the open entry
   **KI-2026-09-05-l** is precisely the observation that the first *required*
   field added to it hides every existing Playbook. The day indicator must
   therefore land **with a `.default()`**, which makes it the first field to
   adopt the event-payload rule that entry proposes. And because the parse exists
   **twice**, both sites are in the blast radius — F-F05's single
   `parseSavedDayColumns(row)` helper is the natural place for this to land.

   **Open in the ADR, to be settled when building begins** (Mitchell:
   the remaining questions get answered in the ADR):

   * **A flat list cannot express an EMPTY day.** A three-day playbook whose
     middle day holds no stops has no representation — there is no stop to carry
     the indicator `1`, so it round-trips as a two-day playbook. `dayCount`
     becomes **derived** (max indicator + 1) rather than stored, and a derived
     count cannot see a day nobody put anything in. **Storing `dayCount` beside
     `stops` is the cheap fix.** This is the ADR's central question.
   * **Is the indicator 0-based or 1-based**, and must it be **monotonic
     non-decreasing** over the array, or is the array **sorted on read**? One of
     those is an invariant the contract enforces and the other is a tolerance the
     read boundary applies; they are not the same decision and the ADR picks one.
   * **What a multi-day playbook does to Discover.** The card (one day's worth of
     summary today); the `cities` derivation, which is `citiesOfStops`
     (`packages/domain/src/trip/cities.ts:63`) over the whole array and is a
     stored `text[]` snapshot (`schema.ts:450`); the **season** filter, bucketed
     from `created_at`'s month (`playbooks.ts:62`, `:189-199`) and so a property
     of the sequence, not of a day in it; the **budget band**, a sum over priced
     stops (`savedDayFacts`, `apps/web/src/lib/savedDayFacts.ts:63`; bands at
     `apps/web/src/lib/playbooks.ts:118`); and **the adds ledger, keyed
     `(saved_day_id, trip_id)`** — *does the ledger key on the sequence, or on a
     day within it?* That one decides what "added once per trip" means for a
     sequence and therefore what the leaderboard ranks.

2. **The contract and the column.** The day indicator on `SavedStop`, defaulted;
   `SavedDay` carries whatever the ADR decides about `dayCount`; the migration
   and, if `dayCount` is stored, its backfill. `CreateSavedDayInput`
   (`saved.ts:155-159`) takes a set of days rather than a single `dayId` — and
   one day stays the ordinary case, so the single-day call must not become
   harder to make.

3. **One insert primitive, three callers.** `insertCommands`
   (`savedDays.ts:533-540`) mints one `AddDay` and maps stops onto it;
   `insertSavedDay` (`:586-605`) wraps it in `executeTripCommandBatch` so the
   whole insert is **one batch, one history entry and one undo** — M6's atomic
   command group, and ADR-029's *"half an inserted day is not a state anyone
   should be able to land in."* That property must hold over N days, not just
   over one day's stops.

   Three callers, one implementation:

   * **add a playbook to an existing trip** — today's path, widened;
   * **start a new trip from one day**;
   * **start a new trip from N days**.

   **This absorbs `TODO.md:802`, "Start a new trip from a saved day"** — raised
   by Mitchell on the PR 141 preview, Vercel toolbar thread `pkAYS2-v8FTr`, and
   unscheduled since. **It also answers that entry's one open question.** The
   entry asks *"whether it reuses the fork path or gets its own, and that is
   worth settling before anyone writes it"*. **The answer is neither-and-both:
   one shared primitive**, called three times. The entry names its own precedent
   — *"two implementations of 'materialise stops into a new trip' is exactly the
   shape of duplication `citiesOfDay` and `rollupCosts` exist to prevent
   elsewhere"* — and those two are the standing argument in this repo for
   refusing a second implementation: `citiesOfDay`
   (`packages/domain/src/trip/cities.ts:90`) folds `citiesOfStops` so a profile's
   cities cannot disagree with Discover's, and `rollupCosts`
   (`packages/domain/src/trip/costs.ts:6`) is read by both `detail.ts` and
   `conflicts.ts` rather than being summed twice. Delete the `TODO.md` entry when
   this link lands.

4. **The surfaces that show a day count.** Keeping N days, the Discover card, the
   shared-day route and the insert dialog all have to say how many days they are
   about to move. The one substantive rule: **a surface states the count it is
   acting on before it acts**, because "add to trip" appending three days when
   someone expected one is the failure this link exists to prevent.

## Exit gate

- [x] **The shape ADR is written, accepted, and answers all three open questions
      under link 1** — the empty day and whether `dayCount` is stored, the
      indicator's base and monotonicity, and the Discover/ledger consequences —
      naming what it rejected and why, including the collection object above.
      **ADR-048**, accepted 2026-09-19; the summary and the two places it
      contradicts this file are in the note below.
- [x] **The migration is written, applied locally, and its production dispatch
      is called out in the PR body** — `gh workflow run migrate-production.yml
      -f confirm=migrate` from `main`. Merging does not apply a migration; an
      undispatched one is schema drift.
- [x] **Every saved day written before the migration still reads, unchanged,
      through BOTH parse sites** — `fromRow` (`savedDays.ts:84`) and
      `toDiscoverDay` (`playbooks.ts:231`) — with its stops in the same order and
      on one day. Proven by a test over rows in the pre-migration shape, not by
      inspecting a library by hand.
- [x] A three-day playbook is kept, read back, and its **day boundaries are
      identical** to what was saved — and a day with no stops does whatever the
      ADR decided, asserted against that decision rather than against whatever
      the implementation happens to do.
- [x] **The insert primitive has exactly one implementation**, called by all
      three callers in link 3. A test fails if a second construction of `AddDay`
      from saved stops appears anywhere in the tree.
- [x] Adding an N-day playbook to an existing trip appends **N days**, as **one
      batch**, undone by **one undo** — the same property `insertCommands`
      already holds for one day's stops.
- [x] Starting a new trip from an N-day playbook produces a trip with **N days**
      in the playbook's order, and starting one from a single-day playbook
      produces **one**. `TODO.md:802` is deleted in the same PR.
- [x] **Publish → discover → add is walked in a real browser as two actors** for
      a multi-day playbook — one account publishes, a second finds it and takes
      it — the standard M11b's gate held itself to. **Walked 2026-09-19** on
      PR #192's preview with two fresh accounts (`m23alice`, `m23bob`) in
      separate browser contexts: a 3-day Playbook kept from trip days 1/3/5,
      published, found by the second account under *Everyone*, opened and
      added. `KI-2026-09-16-d`'s blocker class did not recur — the ADR-034
      bypass plus `AUTH_DEV_LOGIN` admitted both accounts.
- [x] The Discover card **states the day count**, `cities` covers stops on
      **every** day of the sequence, and the adds ledger counts a multi-day add
      per the ADR's key decision, with `saved_days.adds` unable to drift from
      `count(*)` over the ledger. **Walked 2026-09-19.** The card read
      `3 days · 14 stops · $86.00` with chips `Kyoto · Lisbon · Glencoe` — one
      city from each of the three days, so the per-day fold is real and not
      just tested — and the day count is correctly suppressed on one-day cards.
      Adding the same Playbook to one trip twice held at *"Added to 1 trip"*;
      adding it to a second gave *"Added to 2 trips"* — the ledger keys on the
      sequence (ADR-048 decision 5). **The `adds`-vs-`count(*)` half is not
      browser-visible** and rests on `savedDayAdds.int.test.ts`, which is said
      plainly rather than folded into the tick.
- [x] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`. **137 passed**,
      matching M25's baseline; `pnpm check` green (3,096 unit + 782
      integration). The lane found three e2e specs still posting the old
      single-`dayId` body to `POST /api/saved-days` — e2e is not in `pnpm
      check`, so CI caught what the local check could not, which is the whole
      argument for CLAUDE.md rule 1.
- [x] Retro appended at gate close. Below.

## 2026-09-19 — link 1 landed: ADR-048, and two of this file's premises corrected

`docs/architecture/ADR-048-a-playbook-is-a-sequence-of-days.md`. The five
decisions, shortest first:

1. **Flat `stops[]`, each stop carrying `dayIndex`, 0-based, `.default(0)`.**
   0-based because every day label in this app is already `index + 1`
   (`TripBoardScreen.tsx:686`, `DayChips.tsx:135`, `KeepDayFlag.tsx:151`,
   `SharedTripScreen.tsx:28`) and `citiesOfDay(detail, dayIndex)` is 0-based —
   two `dayIndex` spellings with different bases is how off-by-ones get written.
   The `.default()` is the whole additive property, and makes this the first
   `SavedStop` field to adopt `KI-20260905-l`'s rule.
2. ✳ **A GAP in the index IS an empty day, so this file's central case is
   representable without `dayCount`.** Indices are dense over the days the user
   *selected*, not over the days that turned out to have stops: keep `[A, B, C]`
   with `B` empty and the stored indices are `{0, 2}`, `max + 1 = 3`. This
   file said *"there is no stop to carry the indicator `1`, so it round-trips as
   a two-day playbook"* — true only under the other normalisation.
   **`dayCount` is still stored**, for the case a gap cannot reach — a
   *trailing* empty day — because "interior rest day survives, departure day
   vanishes" is an asymmetry no user can state, and because keep-N/insert-N is
   the number link 4's surfaces promise before they act.
3. ✳ **Both, at two boundaries** — this file asks the ADR to pick between a
   contract-enforced monotonic invariant and a sort-on-read tolerance. The write
   path enforces (on the parse already at `savedDays.ts:168`, KI-71's write-path
   half, which this file's "the parse exists twice" correctly does not count as
   a read site); the read boundary **stably** sorts and repairs. Enforcing at
   the read boundary would drop rows whose stops are individually valid — 
   `KI-20260905-l`'s hazard, re-created on purpose. The refinement therefore must
   **not** go on `SavedStop.array()`, which all three sites share.
4. **Discover:** `cities` must fold per day (`citiesOfStops` sorts timed stops
   across the whole array it is handed, so day 3's 08:00 currently outranks day
   1's 14:00); `window` goes null when `dayCount > 1`, because first-start to
   last-end across three midnights is read by `dayLength` as a 13-hour day and
   labelled "Long" — false, not merely imprecise; the budget band stays a total
   and is *not* divided by `dayCount` (that is the `budgetPerPerson` defect
   class); `season` needs no change and the ADR records that so it is not
   rediscovered.
5. **The adds ledger keys on the sequence and needs no migration.** A day inside
   a sequence has no identity to key on — stops are a jsonb value, days are index
   positions. A three-day add counts once.

**Two consequences that create work this file does not list.** `F-F05`'s
`parseSavedDayColumns(row)` helper is now a *prerequisite* rather than a
tidy-up: three behaviours have to be identical at both read sites. And
`BundlePlaybook.stops` (`packages/fixtures/src/bundle/schema.ts:185`) is a third
writer of this shape — the **M25 round-trip tripwire does not catch it**, because
`fromTrip` emits `playbooks: z.tuple([]).default([])`
(`packages/fixtures/src/bundle/fromTrip.ts:69`), so a trip export never carries a
`SavedStop`.

## 2026-09-19 — links 2, 3 and most of 4 landed

**Gate: 8 of 11.** What is left is the two-actor browser walk, the Discover
`cities`/ledger box's own walk, and the retro.

**The e2e lane went red on the first CI run and is green now.** Three specs
(`m11b-playbooks`, `m10-simulated-ai`, `responsive`) seed a Playbook by posting
`{ name, tripId, dayId }` straight at `POST /api/saved-days`, and link 2 changed
that body to `dayIds`. **`pnpm check` cannot see this** — e2e is not in it — so
a green local check was not a green CI, exactly as that script's own skip
message warns. Reproduced locally with `test:e2e:ci-like` (the same 5 failed /
132 passed CI reported), fixed, and re-run to 137 passed.

**The shape, as built.** Flat `stops[]`, each stop carrying a 0-based
`dayIndex` defaulted to 0; `saved_days.day_count` (migration
`0024_saved_day_day_count.sql`, applied locally, **production dispatch is
`gh workflow run migrate-production.yml -f confirm=migrate` from `main` and is
called out in the PR body**); `CreateSavedDayInput.dayIds`, an ordered array
bounded at 366.

**Three things found by building it that the scope did not predict:**

1. **Link 3's third caller already existed.** `AddToTripDialog` has had a
   "Start a new trip" option that creates the trip and then calls
   `insertSavedDay` — so the shared primitive was already shared, and all
   `insertCommands` needed was to learn N days. `TODO.md`'s *"Start a new trip
   from a saved day"* entry is deleted, and its open question ("reuse the fork
   path or get its own?") is answered by the code that was already there.
   `insertCommands.contract.test.ts` now fails if a second construction appears
   — and writing it turned up two false positives worth knowing about:
   `TripBoardScreen`'s ordinary "add a day" button, and `ai/writeTools`' use of
   `type: "AddDay"` as a `ProposedChange` LABEL. Neither is a second
   implementation; the assistant's insert is in fact a **fourth caller** of the
   one primitive.
2. **`savedDayFacts.window` was stating something false, not merely vague.**
   Over a sequence it is day 1's 09:00 to day 3's 22:00, which `dayLength`
   buckets as a thirteen-hour day and labels "Long". It is null above one day
   now, and the card shows the day count in that space.
3. **The length filter settles `dayCount` from a direction nobody had used.**
   Mitchell asked for "1, 3, 5 or 7+ days" while this was being built. A filter
   has to be a SQL predicate, and only a COLUMN can be one — `stops` is jsonb
   that ADR-029 says is never queried into, so a derived count could only be
   applied in application code over the truncated candidate window, which is
   exactly how the budget band's chip counts came to disagree with the page
   below them (KI-2026-08-31). Bands are **1 / 2-3 / 4-6 / 7+**, read as edges
   for `BudgetBand`'s reason and confirmed with him.

**Link 4's picker, as Mitchell specified it** (2026-09-19): the pennant is
unchanged and still opens on one day, already selected, so the one-day keep is
as cheap as it was. (**This sentence first said "still accept-and-Enter", and
that was wrong** — a bare Enter on open hits the Close button, because the name
field is never focused. Pre-existing, not M23's doing, and now
`KI-2026-09-19-d`; the claim was inherited from `KeepDayDialog.tsx`'s own
comment, which asserted the same thing and is corrected too. Repeating a
neighbouring comment's claim without checking it is how a false one survives
two years.) Under it is a strip of the trip's days as toggles —
**not a range**: *"I would really prefer they don't have to be sequential days
in your trip ... you aren't selecting a range."* Selection is held in TRIP
order rather than click order, because a calendar can show that a day is chosen
but not when it was chosen. The summary states the day count before the button
acts, and names an empty day as a rest day rather than hiding it inside a stop
total. A new `ToggleChip` primitive was written rather than the element wall
bypassed — the precedent `Checkbox` set in M22.

**`BundlePlaybook` grew `days:`**, the same `BundleDay` shape a bundle trip
already uses, so a multi-day playbook can be authored as content. The stored
form stays flat and indexed; the authored form does not have to be, and nothing
parses old bundle bytes out of a database. **The M25 round-trip tripwire does
not cover this** — `fromTrip` emits `playbooks: z.tuple([])` — which is why the
ADR wrote it down.

## 2026-09-19 (later) — the preview walk, and what it caught that no test did

Gate boxes 8 and 9 walked and ticked; `test:e2e:ci-like` green at 137. **The
walk also found five defects, and the first was shipped by this branch.** None
were visible to `pnpm check`, which is the part worth keeping.

- **F1 — `bg-brand-subtle` and `text-muted` are not tokens this app defines.**
  New in this branch, in `ToggleChip`, the picker's own control. `globals.css`
  has `--color-brand-tint` and `--color-slate`; Tailwind emits nothing for an
  unknown utility, so a **pressed day chip had a transparent background** and
  the selected state — the entire purpose of the control — was carried by a
  border alone. **The colour wall did not catch it because it scans for raw
  hex, and an undefined token NAME is not a hex literal.** That gap is worth
  knowing about independently of this fix.
- **F2 — a THIRD construction of the window fact.** `SavedDaysDialog`'s
  `spanOf()` computed `stops[0].start → stops[n].end` itself, so the library
  dialog stated `14 stops · 7:30 am – 3:30 pm` for a three-day Playbook: the
  exact falsehood ADR-048 decision 4 exists to refuse, on the surface whose
  button says *Add to trip*. It now folds `savedDayFacts`. This is the
  duplication `citiesOfDay` and `rollupCosts` are the standing argument
  against, and the ADR's own "one implementation" reasoning did not save it
  because nobody grepped for a third copy.
- **F3 — the shared-day route said nothing about days, and its Window row was
  false.** `WINDOW: No times set` on a Playbook every one of whose fourteen
  stops shows a time. It now reads *"Spans several days"* above one day, and
  the stop list carries `Day N` headings so the boundaries are visible rather
  than implied.
- **F4 — `AddToTripDialog` never stated N**, and `git diff` against main for
  that file was **empty**: the branch had not touched the one surface that
  actually performs the append. Its hint even read *"this day is day 1"* for a
  three-day Playbook. This is link 4's one substantive rule — *a surface states
  the count it is acting on before it acts* — unmet at the sharpest possible
  place.
- **F5 — `daysShared` counts playbooks, not days** (`KI-2026-09-19-c`), and
  Discover's header still promised *"One good day, saved on its own"*.

**The honest reading: link 4 was claimed complete when it was one surface of
four.** The Discover card and the Keep dialog were built; the library dialog,
the shared-day route and the insert dialog were not, and a gate box naming only
the card let that pass. Behaviour was right everywhere — the engine appended,
ordered and undid correctly in every case walked — but three of the four
surfaces were still speaking in the singular about it.

**Not walked, and it should be before the gate closes:** the four surfaces
changed in response to this walk are themselves unwalked. A second pass over
the library dialog, the shared-day route and the insert dialog is owed.

Also pre-existing and now recorded rather than fixed: the Keep dialog never
focuses its name field, so *"accept it and press Enter"* has never worked
(`KI-2026-09-19-d`). Two places asserted it did, including this file.

## Retro — M23, closed 2026-09-19

Eleven boxes, one day, three commits and two browser walks. The engine was
right almost immediately; everything that went wrong was about **what the
product said it was doing**, and none of it was visible to `pnpm check`.

### The decision that paid for itself

**A gap in `dayIndex` is an empty day.** This file said a flat list could not
express a three-day Playbook whose middle day is empty, and that was true only
under a normalisation nobody had picked yet. Assigning indices by position in
the *selected* set made the interior rest day representable for free, and left
exactly one case — the trailing empty day — needing a stored `dayCount`. Had
that not been noticed, the milestone would have either stored a column it did
not need or shipped an asymmetry no user could state.

`dayCount` then earned itself a second time, from a direction the ADR had not
used: Mitchell asked mid-build for a length filter, and **a filter has to be a
SQL predicate, which only a column can be**. A derived count could only have
been applied in application code over the truncated candidate window — exactly
how the budget band's sibling chips came to count a different set from the page
below them (KI-2026-08-31). The ADR was amended rather than quietly vindicated.

### Three things that were true before anyone built them

- **The read boundary must be MORE tolerant than the write path.** Enforcing
  `dayIndex` monotonicity at `fromRow` would have dropped rows whose stops were
  each valid — KI-2026-09-05-l's hazard, recreated deliberately. The refinement
  lives on `SavedDaySequence`, which only the write path uses, and the two read
  sites keep the plain array parse. This was the single most mis-implementable
  line in the milestone and it would have passed every test written against
  freshly-written rows.
- **Link 3's third caller already existed.** `AddToTripDialog`'s "Start a new
  trip" already called `insertSavedDay`. The milestone had budgeted for
  building it; the work was teaching `insertCommands` to mint N days.
  `TODO.md:802`'s open question — reuse the fork path or get its own — was
  answered by code already in the tree.
- **`fromTrip` emits `playbooks: z.tuple([])`**, so M25's round-trip tripwire
  does *not* guard `SavedStop`. Worth having checked rather than assumed in
  either direction: it meant `BundlePlaybook.days` had to be written
  deliberately, with no failing test to prompt it.

### What actually went wrong, and the pattern under it

Four defects reached a preview. Every one was a **claim that outran the code**:

1. `ToggleChip` used `bg-brand-subtle` and `text-muted`. Neither is a token
   this app defines. A *selected* day chip rendered transparent — the selected
   state, which is the control's whole purpose. **The colour wall scans for raw
   hex, so an undefined token NAME passes it.** Typecheck, lint, 3,099 unit
   tests and 782 integration tests all went green over it.
2. `SavedDaysDialog.spanOf()` was a **third** construction of the window fact,
   stating `7:30 am – 3:30 pm` across three days — the exact falsehood ADR-048
   decision 4 forbids, on the surface whose button says *Add to trip*. The
   ADR's own one-implementation reasoning did not save it, because nobody
   grepped for a third copy. `citiesOfStops` had two known callers and the
   milestone reasoned carefully about both; `savedDayFacts` had three and the
   milestone reasoned about two.
3. **Link 4 was reported complete when it was one surface of four.** The gate
   box named only the Discover card, and that let the library dialog, the
   shared-day route and the insert dialog through untouched — `git diff` for
   `AddToTripDialog` against main was *empty*. A gate box narrower than its own
   link is a gate box that certifies the wrong thing.
4. Two documents asserted that the Keep dialog focuses its name field, so
   "accept it and press Enter" works. It does not, and never has
   (`KI-2026-09-19-d`). This file made that claim by **repeating the
   component's comment without testing it** — which is how a false claim
   survives long enough to be quoted.

And a fifth, about method rather than product: **one of the three string fixes
silently failed to apply**, because a scripted replacement was written without
asserting that it matched. It took a *second* walk to catch a one-line
regression in a fix. The lesson is not "walk twice" — it is that a text
substitution that cannot fail loudly is a change you have not made. Every
edit in the final commit asserts, and the three strings now have a test
(`AddToTripDialog.test.tsx`) that would have caught it in seconds.

### What the two walks were worth

The behavioural gate boxes — two actors, N-day append, one undo, new trip from
N days, the length filter, the interior rest day — **passed on the first walk
and never regressed**. Not one of the four defects was a behaviour bug. The
walks paid for themselves entirely on what the screens *said*, which is the
half no test in this repo was asked to check.

### Left behind, deliberately

- `KI-2026-09-05-l` is **narrowed, not closed**: the `.default()` rule and
  F-F05's shared parse helper are real, but there is still no `{ v, stops }`
  wrapper, so the first non-additive `SavedStop` change still has nowhere to
  land — and should pay for it.
- `KI-2026-09-19-c` — `daysShared` counts playbooks, not days. Labels fixed;
  the field keeps its name rather than widening a PR carrying a migration.
- `KI-2026-09-19-d` — the Keep dialog's unfocused name field. Pre-existing.
- **Unwalked:** the four surfaces fixed after the first walk were re-walked and
  four of five confirmed; the `AddToTripDialog` hint fix and the rest-day line
  that followed the second walk are covered by tests rather than by a third
  walk. Said plainly rather than implied.
- **The colour wall does not catch undefined token names.** That is a gap in a
  quality gate, found by this milestone and not fixed by it.

### For M12, which runs next

It inherits a `saved_days` row that will not change shape again for this
reason, which was the whole point of the ordering. It also inherits the lesson
from defect 3: M12 adds reviews, ratings, reporting and moderation to **several
surfaces**, and if its gate boxes name one of them each, it will ship the same
way this milestone nearly did.

## 2026-09-19 (later still) — Mitchell's preview feedback on the Keep dialog

Three toolbar threads on #192, all on the one dialog link 4 built, all about
what the control *says* rather than what it does. Worth recording together
because they point the same way: the picker was built as the feature and
presented as the feature, and it is neither — it is an option on a dialog whose
ordinary answer is one day.

1. **"Make these a Table ... fit the longest text, but also all be aligned in
   height and width."** The strip was `flex-wrap` with each chip sized to its
   own label, so a row lined up on nothing. It is a two-column CSS grid now,
   with `ToggleChip` filling its cell.

   **It took two goes, and the second one is the lesson.** The first fix was
   `grid-cols-2 sm:grid-cols-3`, shipped with a comment asserting three columns
   "fits the longest label this can produce". Measured on the preview: a
   3-column cell has a 114.00px content box and the widest label a dated trip
   can render — `Day 3` over `Wed, Sep 16 · 10 stops` — is 124.19px, so 10 of
   12 chips ate all their right padding and the worst crossed the border by
   1.19px. **The alignment half of the ask was exact** (132.00px × 12, 42.38px
   × 12) **and the fit half was wrong**, which is why a walk that only asked
   "are they equal?" would have passed it.
   Two things worth keeping. First, **the probe that seemed obvious reports a
   false pass**: `scrollWidth <= clientWidth` on the label spans is clean
   everywhere, because a `nowrap` inline box grows to fit its own text by
   construction. The overflow is only visible by comparing the span's rect
   against the *chip's* content box. Second, **the date is what makes the label
   long** — a dateless trip renders `6 stops` and has 74px of slack, so every
   fixture used before this one looked fine. The defect needed a trip with a
   start date, two-digit day numbers and a two-digit stop count to appear at
   all. A grid rather than a real `<table>`: these are
   toggle buttons in a `role="group"`, and table semantics would tell a screen
   reader they are tabular data. The alignment is the ask; the roles stay
   honest.
2. **"Can we make selecting more days the extra experience? ... a button saying
   'Do you want to add more days?' and clicking it adds the calendar."** The
   picker is collapsed now and that button reveals it. Collapsed, the one-day
   keep is the dialog M11 shipped plus one line — which is the milestone's own
   rule (*"one day stays the ordinary case; the single-day call must not become
   harder"*) applied to the thing on screen rather than to the number of clicks.
   It is absent on a one-day trip, and re-collapses on every reopen: the dialog
   is mounted once and reused for every pennant.
3. **"Drop the 'Order and gaps kept, no dates'."** Inherited from the design
   shell's placeholder. It describes the storage model, not the day being kept —
   every Playbook keeps order and drops dates, so the sentence read identically
   on every keep anybody could ever make. What is left is only what varies: how
   many days, how many stops, the clock range when there is one, which days are
   rest days.

**The pattern across all three:** every one is the surface over-stating itself.
A grid that implied the chips were a table's worth of data, a picker that
implied multi-day was the point, and a sentence that implied it was telling you
something about *this* day. The defects the walk found (above) were surfaces
speaking in the singular about a sequence; these are a surface speaking loudly
about an option. Both are the same failure mode with the volume knob turned
different ways, and neither is a thing `pnpm check` can see.

## Deliberately not here

- **Reviews and ratings.** M12's, and the whole argument for running this first
  is that M12 should key them to a row that is already final. If this milestone's
  diff touches a rating, a review count or a reviews table, the ordering decision
  has been undone rather than used.
- **The trip export format.** Its own milestone. A sequence of days that can be
  taken into a trip is not a file format, and giving it one here would put an
  externally-visible serialisation on a shape whose ADR is still deciding whether
  `dayCount` is stored.
- **Anything about who a stop is for.** M13 link 5 lands per-stop attribution and
  M19 link 3 builds on that field. A multi-day playbook does not need it and must
  not add its own — that is the drift `AGENTS.md` invariant 5 exists to stop.

## Prerequisites

**M11b, and it is closed** (gate closed 2026-08-31). This milestone changes the
shape of the row M11b published, the cards that render it, the ledger that counts
it and the two parse sites that read it.

**M6, and it is closed.** The insert primitive in link 3 is an atomic command
group or it is nothing: N days appended half-way is exactly the state ADR-029
refused for one day.

**Not blocked on M22.** It is placed after M22 because M22 was already the
current milestone on 2026-09-16, not because anything here reads a token or an
API route. It is placed **before M12 on purpose**, and that is a dependency, not
a preference.

**One thing it owes forward:** M12 keys `saved_day_reviews` to whatever row shape
leaves this milestone. If this ships without link 2, M12 inherits the migration.
