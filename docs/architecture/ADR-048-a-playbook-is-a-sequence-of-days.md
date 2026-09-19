# ADR-048 — A Playbook is a sequence of days, flat, indexed per stop

**Status:** **Accepted — 2026-09-19**, with M23 link 1, and **built the same
day** in links 2-4 (`docs/milestones/M23-multi-day-playbooks.md`'s 2026-09-19
note has what building it turned up). Two amendments are folded in below and
marked **[built]** where the implementation taught the ADR something.

**Depends on:** ADR-029 (a saved day is a personal, dateless fragment, and
`stops` is a jsonb VALUE that is never queried into), ADR-028 (snapshot
provenance), ADR-005/ADR-029 (one insert is one batch, one history entry, one
undo). **Owes forward to:** M12, which keys `saved_day_reviews` to whatever row
shape leaves M23.

**Two of the decisions below go against a premise stated in the milestone
file**, and they are marked ✳ where they do. Both corrections were made by
reading the tree rather than the prose, which is the same way the 2026-09-19
`API_TOKEN_PEPPER` correction was made. If Mitchell prefers the original
premise in either case, the decision is his and this ADR is the place to
overrule it.

## Context

The library holds exactly one unit: a day. `SavedDay`
(`packages/contracts/src/saved.ts:101`) is a name, an ordered `stops` array and
a provenance snapshot. `CreateSavedDayInput` (`:155`) takes one `tripId` and one
`dayId`. The server reads that single day through `stopsForDay`
(`apps/web/src/lib/savedStops.ts:27`), `saved_days.stops` is one flat jsonb
array (`apps/web/src/server/db/schema.ts:435`), `insertCommands`
(`apps/web/src/server/savedDays.ts:533`) mints exactly one `AddDay`, and the
adds ledger's primary key is `(saved_day_id, trip_id)` (`schema.ts:595`).

Nothing a person actually travels is one day. M23 generalises the saved day
into a saved **sequence**, in the same row, rather than adding a second
publishable object — the full argument for that, and the rejection of a
separate "collection" type, is in the milestone file and is not reopened here.

**What this ADR decides is the shape**, and the shape is constrained by one
fact about the existing rows: `saved_days.stops` is read through a strict
`SavedStop.array().safeParse` that **drops and logs** a row it cannot parse, in
**two** places —

* `fromRow`, `apps/web/src/server/savedDays.ts:83-90` (the parse at `:84`);
* `toDiscoverDay`, `apps/web/src/server/playbooks.ts:230-238` (at `:231`).

A third `SavedStop.array().safeParse` exists at `savedDays.ts:168`, and it is
**not** a read boundary — it is KI-71's write-path half, refusing to insert a
row it could not read back. That distinction is load-bearing in Decision 3 and
is the reason this ADR says "two read sites" where the milestone file says the
parse exists twice: both statements are true about *reads*, and the third site
is where an invariant can be enforced for free.

`SavedStop` (`saved.ts:23-32`) has eight fields and **none of them carries
`.default()`**. `KI-20260905-l` is precisely the observation that the first
*required* field added to it hides every existing Playbook from its owner's
library and from Discover. Any field this milestone adds to a stop is therefore
the first field to adopt that entry's proposed rule.

## Decision 1 — a flat `stops[]` with a 0-based `dayIndex`, defaulted to 0

The stored shape stays `SavedStop[]`. Each stop gains:

```ts
/** Which day of the sequence this stop is on. 0-based; see ADR-048. */
dayIndex: z.number().int().nonnegative().default(0),
```

**Flat rather than `SavedStop[][]`** — decided by Mitchell on 2026-09-18 and
recorded here with the check behind it. A flat array with a defaulted indicator
is **additive**: every row written before this migration still parses as
`SavedStop[]`, and every stop in it reads as `dayIndex: 0`. A nested
`SavedStop[][]` is not an array of `SavedStop` at all, so every pre-existing row
would fail both read parses and vanish from its owner's library and from
Discover — which would have forced a versioned read (a `{ v, stops }` wrapper
and a migration chain) into this milestone before anything else could be built.

**`.default()` is not decoration, it is the whole additive property**, and it
makes `dayIndex` the first `SavedStop` field to adopt `KI-20260905-l`'s rule.
The contract file's header gains that rule as prose in the same diff: *every
field added to `SavedStop` after today carries `.default()`*. A required field
here would reproduce, deliberately, the exact failure that entry was opened to
warn about.

**0-based, and named `dayIndex`, because that is already this codebase's
spelling for this concept.** `citiesOfDay(detail, dayIndex)`
(`packages/domain/src/trip/cities.ts:90`) indexes `detail.days` from zero, and
every surface that renders a day label already adds one —
`TripBoardScreen.tsx:686` (`Day ${askScope.dayIndex + 1}`), `DayChips.tsx:135`,
`KeepDayDialog.tsx:81`, `KeepDayFlag.tsx:151`, `SharedTripScreen.tsx:28`. A
1-based `dayIndex` sitting next to a 0-based one, both spelled `dayIndex`, is
how off-by-ones get written, and the saving — one `+ 1` at a label — is not
worth it.

**`dayIndex` is a relative offset inside the sequence, never an absolute trip
day** — confirmed by Mitchell on 2026-09-19, and written down because the name
invites the wrong reading. A three-day playbook stores `{0, 1, 2}` once.
Appended to a trip that already has five days it becomes days 6, 7 and 8; used
to start a new trip it becomes days 1, 2 and 3. Same stored value, different
base, and **the base belongs to the insert rather than to the playbook** — a
`dayIndex` that had absorbed its source trip's numbering would be a fragment
that only fits where it came from, which is the mistake ADR-029 already refused
when it dropped the day's calendar date. The stops of one day stay together on
one day, in stored order, with their times unchanged.

That framing also settles Decision 2 from the other end: *"a 3 day bundle
becomes days 6, 7, 8"* is a promise about a count, and a derived count breaks it
whenever the bundle's last day is empty — the insert would quietly produce days
6 and 7.

The cost is named rather than waved at: **0 is falsy**, so `stop.dayIndex || 1`
and `if (!stop.dayIndex)` are both silent bugs. The mitigation is that nothing
should ever read `dayIndex` ad hoc — Decision 4's fold and the grouping helper
are the only readers, and the ban on a second construction is already a gate box
in the milestone.

## Decision 2 ✳ — a GAP in the index is an empty day, and `dayCount` is stored only for the case a gap cannot reach

The milestone file states the problem as: *"A flat list cannot express an EMPTY
day. A three-day playbook whose middle day holds no stops has no representation
— there is no stop to carry the indicator `1`, so it round-trips as a two-day
playbook."*

**That is true only if indices are assigned by counting non-empty days, and
this ADR assigns them by position in the selected set instead.** Keep trip days
`[A, B, C]` where `B` is empty, and the stored indices are `{0, 2}` — `A`'s
stops at 0, `C`'s at 2, and nothing at 1. `max(dayIndex) + 1 = 3`. The interior
empty day is expressible, and it is expressible *because* the index is a
position rather than a rank. **A gap in the index is an empty day.** That is the
rule, it is one sentence, and it removes the central question's central case.

So indices are **dense over the days the user selected** and **not** dense over
the days that turned out to have stops. Those are two different normalisations
and only the first preserves what was kept. Selecting trip days 1, 3 and 5 of a
five-day trip produces a **three**-day playbook (`{0, 1, 2}`) — the source
trip's numbering is not the playbook's, because a playbook is a new sequence and
not a slice with holes punched in it.

**What a gap still cannot reach is a TRAILING empty day**, and a playbook with
no stops at all. `max(dayIndex) + 1` can never count a day after the last stop,
so a three-day keep whose final day is empty round-trips as two days.

**`dayCount` is therefore stored**, as a column beside `stops`:

```ts
/** How many days this sequence spans. >= max(stops[].dayIndex) + 1; see ADR-048. */
dayCount: z.number().int().min(1).default(1),
```

Three reasons, heaviest first:

1. **Asymmetry is worse than either uniform answer.** With gaps carrying
   interior emptiness and nothing carrying trailing emptiness, a user gets "my
   rest day survived" and "my departure day vanished" from the same feature, and
   has no way to predict which. The milestone's gate box asks that an empty day
   "does whatever the ADR decided, asserted against that decision" — a decision a
   user cannot state is not one.
2. **The insert primitive must append the number the surface promised.** Link 4's
   one substantive rule is that *a surface states the count it is acting on
   before it acts*. If the count is derived, "keep 3 days → add to trip →
   get 2 days" is a round-trip failure on the very number the dialog just
   showed. With the count stored, keep-N/insert-N holds unconditionally, which
   is the property link 3 and link 4 are both about.
3. **[built] Discover cannot filter on a length it has to derive.** Mitchell
   asked for a length filter ("1, 3, 5 or 7+ days") while this was being
   implemented, which settles the question from a direction this ADR had not
   used. A filter has to be a SQL predicate; only a COLUMN can be one. `stops`
   is the jsonb ADR-029 says is never queried into, so a derived count could be
   applied only in application code, over the already-truncated 200-row
   candidate window — which is precisely how the budget band's sibling chips
   came to count a different set from the page below them (KI-2026-08-31). The
   bands are **1 / 2-3 / 4-6 / 7+**, read as edges rather than overlapping
   thresholds for the reason `BudgetBand` gives, and confirmed.
4. **It is not a denormalisation, so the drift objection does not apply.** The
   obvious complaint is `saved_days.adds`, which is a cached `count(*)` over a
   ledger that is the authority (`schema.ts`' note: *"the ledger records what
   was added and `saved_days.adds` is derived from it, never the other way
   round"*). `dayCount` has no authority to drift from: it is the **only** home
   for the trailing-empty fact, and `stops` provably cannot hold it. A number
   that is the sole home of a fact is a column, not a cache.

What `stops` *does* constrain is a **floor**. `dayCount < max(dayIndex) + 1` is
a contradiction, and Decision 3 says what the read boundary does about it.

**Bounded at 366, reusing the number the repo already picked.**
`apps/web/src/app/api/v1/trips/import/route.ts:82` caps an imported trip at
`MAX_DAYS = 366`. A playbook is kept out of a trip, so a trip you are allowed to
import is a trip you should be allowed to keep days from, and inventing a second
smaller number here would only create a trip whose days cannot all be saved. The
bound lives on `CreateSavedDayInput` (a cheap refusal at the write path),
**not** on the read of a stored `dayCount` — amputating a stored value on read
is how a library empties itself, and that is the failure `KI-20260905-l` exists
to prevent.

**The migration is additive and metadata-only.** `day_count integer not null
default 1` adds no row rewrite in modern Postgres, and "1" is the truthful
backfill for every row written before today: each of them is one day. There is
no separate backfill step and no data migration to get wrong.

## Decision 3 ✳ — the WRITE path enforces the invariant; the READ boundary tolerates and repairs

The milestone poses this as a choice: *"must [the indicator] be monotonic
non-decreasing over the array, or is the array sorted on read? One of those is
an invariant the contract enforces and the other is a tolerance the read
boundary applies; they are not the same decision and the ADR picks one."*

**It picks both, at two different boundaries, and that is not a fudge — the two
boundaries have opposite consequences for a row already on disk.**

* **The write path enforces.** `savedDays.ts:168` already parses the stops it is
  about to insert, precisely so the failure mode is *"nothing was saved"* rather
  than *"an unreadable row is in your library"*. Monotonicity rides that
  existing parse: a non-monotonic write is a caller bug, caught before it
  becomes bytes, refused with the `invalid` error that site already returns.
* **The read boundary tolerates.** A read that *enforced* monotonicity would
  drop the row — and dropping a row whose stops are all individually valid,
  over an ordering, re-creates `KI-20260905-l`'s hazard on purpose. So reads
  **stably sort by `dayIndex`** and keep going. A stable sort is required, not
  incidental: within a day, stops are stored in the order the day ran
  (`stopsForDay` walks `day.activityIds`), **not** in clock order, so any
  unstable or key-widened sort would silently reorder a day's stops.

**The refinement must therefore NOT live on the stored-value schema.**
`SavedStop.array()` is used at all three sites; a `.superRefine` on it would
reach the two read sites and drop exactly the rows this decision is protecting.
The monotonic check lives on a separate schema used only by the write path —
`SavedDaySequence = SavedStop.array().superRefine(monotonic)` — and `fromRow`
and `toDiscoverDay` keep the plain array parse. **This is the single most
mis-implementable line in this ADR**: one `.superRefine` in the wrong file
converts a tolerance into a library-emptying enforcement, and it would pass
every test written against freshly-written rows.

**A repair that changed anything is logged**, with the row id — the same
drop-and-log discipline `fromRow` already applies, minus the drop. A read that
silently sorts is a write-path regression nobody will ever see; a read that
sorts and says so is one somebody can grep for.

**All of this lands in one helper, not two.** `F-F05` asks for a single
`parseSavedDayColumns(row)` covering the duplicated parse; `dayIndex` sorting,
the `dayCount` floor, and the existing `stops`/`visibility`/`author_kind` parses
are all the same function, called by both read sites. The helper is a
prerequisite of this ADR being implementable safely, not a tidy-up to do
afterwards, because **every decision here has to be true twice or it is not
true**.

The floor is repaired in the same place and in the same direction:
`dayCount = Math.max(stored, maxDayIndex + 1)`. It only ever grows to fit the
stops that are actually there, so no stop can be rendered into a day the count
says does not exist.

## Decision 4 — what a sequence does to Discover

Four derivations read the flat array today. The flat shape does not break them
loudly; it breaks three of them **quietly**, which is worse, and this decision
names each one and what it becomes.

**`cities` — folded per day, and this is a real bug the flat array introduces.**
`citiesOfStops` (`cities.ts:63`) collects the timed stops and sorts them
lexicographically by `start` **across the whole array it was given**. Hand it a
three-day sequence and day 3's 08:00 stop sorts ahead of day 1's 14:00 stop, so
the stored `cities` snapshot (`schema.ts:450`) comes out in an order that is not
the order the sequence runs. The fix keeps **one** rule rather than adding a
second: a `citiesOfSequence` that groups by `dayIndex`, folds `citiesOfStops`
over each day, concatenates in day order and collapses duplicates to their first
occurrence. That is exactly the relationship `citiesOfDay` already has to
`citiesOfStops` — the repo's standing argument against a second implementation
— and it leaves the single-day call byte-identical.

**`window` — null for a sequence, and the tag with it.** `savedDayFacts`
(`apps/web/src/lib/savedDayFacts.ts:63`) reports `window` as the first timed
stop's start to the last timed stop's end **in stored order**. Over a sequence
that is day 1's 09:00 to day 3's 22:00, which `dayLength` (`:141`) then buckets
as a **13-hour** span and labels "Long". The number is not large, it is
**false** — it is a clock range across three midnights read as a single day. So:
`window` is `null` when `dayCount > 1`, and `dayLength` therefore renders
nothing, which is the behaviour it already documents for a day with no times
(*"null in, null out"*). The card shows the day count in that space instead.

**`totalCost` and the budget band — unchanged, and the consequence is recorded
rather than fixed.** The band (`inBudgetBand`, `apps/web/src/lib/playbooks.ts:175`, over the edges at `:156`) is applied
to the sum over priced stops, and for a sequence that sum is the sequence's
total. A three-day playbook will land in "over $1,000" and be filtered out of
every narrower band. **That is the filter working, not failing**: a searcher who
picks "under $200" does not want a $1,400 three-day playbook. What is
deliberately *not* done is dividing by `dayCount` to make a comparable
per-day figure — this codebase already renamed `budgetPerPerson` to `totalCost`
because the number it banded was never per person (Mitchell, 2026-09-01), and
minting a per-day average here would re-introduce that exact class of defect: a
derived per-unit number whose name has to carry an assumption the computation
does not state. If per-day comparison is wanted it is a control, not a quiet
division, and it belongs to M19's cost model.

**`season` — no change, and recording that is the point.** The season filter
buckets `created_at`'s month (`apps/web/src/server/playbooks.ts:189-199`,
`seasonOfInstant` at `lib/playbooks.ts:107`) and is already a property of the
row, i.e. of the sequence. Nothing about a day inside it participates. This is
the one of the four that needed no decision, and it is written down so the next
reader does not spend an hour rediscovering that.

**`DiscoverDay` gains `dayCount`**, which is the gate box "the Discover card
states the day count". It is a local response shape rather than
`packages/contracts` (`lib/playbooks.ts:197`), so invariant 5's contract
protocol and the changelog do not apply — the same note the `budgetPerPerson`
rename already carries there.

## Decision 5 — the adds ledger keys on the SEQUENCE, and does not change at all

The milestone asks: *"does the ledger key on the sequence, or on a day within
it?"*

**On the sequence, and `saved_day_adds` needs no migration.** Its primary key is
already `(saved_day_id, trip_id)` (`schema.ts:595`), and once `saved_days.id`
names a sequence, that key already means *"this playbook was taken into this
trip once"* — which is what the leaderboard should rank and what "added once per
trip" should mean for a thing you take whole.

Keying on a day within a sequence is not merely a worse choice, it is not
available: **a day inside a sequence has no identity**. Stops are a jsonb value
(ADR-029), days are index positions, and nothing in there has an id. Minting
per-day ids inside that value to key a table on would be querying into the value
ADR-029 says is never queried into, and would put ids in a stream the KI-1
hazard is about.

So the gate box *"`saved_days.adds` unable to drift from `count(*)` over the
ledger"* is held by exactly the code that holds it today: `recordAdd` moves the
counter inside `executeTripCommandBatch`'s `alsoInSameTransaction` hook
(`savedDays.ts:586-605`), so the ledger row and the counter are one fact. **This
milestone must not touch that path**, and the gate box is a regression check on
it rather than new work.

One consequence worth stating out loud: adding a three-day playbook to a trip
counts as **one** add, not three. That is the intended reading — the person took
one playbook — and it means the leaderboard does not become a function of how
many days an author chose to bundle together, which is the gaming this ledger
was built to refuse.

## Consequences

* **`SavedStop` gains its first defaulted field**, and the rule that every
  subsequent field carries `.default()` becomes prose in
  `packages/contracts/src/saved.ts`. `KI-20260905-l` is *narrowed* by this, not
  closed: the `{ v, stops }` wrapper it proposes is still absent, and a
  non-additive change to `SavedStop` still has nowhere to land. The entry should
  be amended to say the rule now has one adopter, not deleted.
* **`F-F05`'s `parseSavedDayColumns(row)` helper becomes a prerequisite**, for
  the reason in Decision 3: three behaviours now have to be identical at two
  read sites, and "identical by copy-paste" is what produced the finding.
* **The content bundle is a third writer of this shape.**
  `BundlePlaybook.stops` (`packages/fixtures/src/bundle/schema.ts:185`) is a
  flat `BundleStop[]` with `.min(1)`, and `content:import` turns it into
  `saved_days.stops`. A multi-day playbook cannot be authored as a bundle until
  that schema can say where a day ends. **The M25 round-trip tripwire does not
  fire here**, and it is worth being exact about why rather than assuming
  either way: `fromTrip` emits `playbooks: z.tuple([]).default([])`
  (`packages/fixtures/src/bundle/fromTrip.ts:69`), so a trip export carries no
  playbooks and `fromTrip.test.ts` never sees a `SavedStop`. The tripwire guards
  `ActivityView → BundleStop`, which this ADR does not touch. Extending
  `BundlePlaybook` is M23 link 2 work with no test currently failing to prompt
  it — which is precisely why it is written down here.
* **[built] `z.infer` makes a defaulted field REQUIRED on the output type**, so
  every literal construction of a `SavedStop` in the tree had to supply
  `dayIndex`. That is worth stating because it looks like it contradicts "this
  change is additive": the additive property is about **parsing stored bytes**,
  not about TypeScript literals. The compile error is the half that makes the
  runtime half safe, and it is what walked the change through every fixture.
* **`stopsForDay` gains a sibling, not a rewrite.** It answers "the stops of one
  day" and still should; the sequence builder calls it once per selected day and
  stamps `dayIndex` from the selection position. That keeps the "what's
  included" summary the Keep dialog renders on the same function the server
  saves through, which is the reason that function is in `src/lib` at all.
* **`CreateSavedDayInput` takes days, and one day must not get harder.** The
  single-day call is the ordinary case (milestone link 2), so the input takes an
  ordered `dayIds` array bounded at 366 and a one-element array stays a
  one-element array — no separate endpoint, no optional second shape, no
  `dayId | dayIds` union for a caller to branch on.
* **M12 inherits a final row.** `saved_day_reviews` keys to `saved_days.id`,
  which after this milestone names a sequence and will not change shape again
  for this reason. That is the entire payoff of running M23 before M12, and it
  is now cashed rather than intended.

## What this ADR does not decide

* **Per-day labels.** `BundleDay.label` exists in the bundle and is explicitly
  *not stored* (`packages/fixtures/src/bundle/schema.ts:72-84`: "Trip Planning has no day title"). A playbook
  day gets no title here either; giving one to a sequence and not to a trip day
  would put the concept in the wrong half of the product.
* **Reviews, ratings, reporting, moderation.** M12's, and the milestone is
  explicit that a diff touching them has undone the ordering decision rather
  than used it.
* **The trip export format.** M25's. This ADR deliberately says nothing about
  serialising a sequence outside the database beyond naming the bundle
  consequence above.
* **Who a stop is for.** M13 link 5 lands per-stop attribution. A multi-day
  playbook does not need it and must not grow its own.
* **Whether a playbook's days can be reordered after it is saved.** Editing a
  Playbook in place is not in M23's scope; this ADR only makes the shape capable
  of it.

## Rejected alternatives

* **A separate "collection" object pointing at N `saved_days` rows.** Rejected
  by the milestone, for M12: a second publishable type either doubles M12's
  surface (a second reviews table or a polymorphic one, a second report target,
  a second moderation state, a second set of Discover sorts) or ships a library
  holding two classes of content with different trust properties, where a
  collection cannot be rated or reported but the days inside it can.
* **Nested `SavedStop[][]`.** Every row written before it fails both read
  parses. See Decision 1.
* **A `{ v, stops }` version wrapper, now.** It is `KI-20260905-l`'s own
  suggestion and it is the right eventual answer, but it converts an additive
  change into a versioned read plus a migration chain before any of M23 can be
  built — and this milestone's change *is* additive. Doing it here would pay a
  cost this change does not incur, for the benefit of the next change that does.
  The entry stays open, and the first genuinely non-additive `SavedStop` change
  is what should pay for it.
* **Deriving `dayCount` from `max(dayIndex) + 1`.** Loses trailing empty days
  while gaps preserve interior ones, which is an asymmetry no user can state.
  See Decision 2.
* **Enforcing monotonicity at the read boundary.** Drops rows whose stops are
  individually valid, which is `KI-20260905-l`'s hazard re-created deliberately.
  See Decision 3.
* **Dividing `totalCost` by `dayCount` for the budget band.** Re-introduces the
  `budgetPerPerson` defect class — a derived per-unit number carrying an
  assumption its name does not state. See Decision 4.
