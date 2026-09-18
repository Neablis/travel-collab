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

- [ ] **The shape ADR is written, accepted, and answers all three open questions
      under link 1** — the empty day and whether `dayCount` is stored, the
      indicator's base and monotonicity, and the Discover/ledger consequences —
      naming what it rejected and why, including the collection object above.
- [ ] **The migration is written, applied locally, and its production dispatch
      is called out in the PR body** — `gh workflow run migrate-production.yml
      -f confirm=migrate` from `main`. Merging does not apply a migration; an
      undispatched one is schema drift.
- [ ] **Every saved day written before the migration still reads, unchanged,
      through BOTH parse sites** — `fromRow` (`savedDays.ts:84`) and
      `toDiscoverDay` (`playbooks.ts:231`) — with its stops in the same order and
      on one day. Proven by a test over rows in the pre-migration shape, not by
      inspecting a library by hand.
- [ ] A three-day playbook is kept, read back, and its **day boundaries are
      identical** to what was saved — and a day with no stops does whatever the
      ADR decided, asserted against that decision rather than against whatever
      the implementation happens to do.
- [ ] **The insert primitive has exactly one implementation**, called by all
      three callers in link 3. A test fails if a second construction of `AddDay`
      from saved stops appears anywhere in the tree.
- [ ] Adding an N-day playbook to an existing trip appends **N days**, as **one
      batch**, undone by **one undo** — the same property `insertCommands`
      already holds for one day's stops.
- [ ] Starting a new trip from an N-day playbook produces a trip with **N days**
      in the playbook's order, and starting one from a single-day playbook
      produces **one**. `TODO.md:802` is deleted in the same PR.
- [ ] **Publish → discover → add is walked in a real browser as two actors** for
      a multi-day playbook — one account publishes, a second finds it and takes
      it — the standard M11b's gate held itself to.
- [ ] The Discover card **states the day count**, `cities` covers stops on
      **every** day of the sequence, and the adds ledger counts a multi-day add
      per the ADR's key decision, with `saved_days.adds` unable to drift from
      `count(*)` over the ledger.
- [ ] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
- [ ] Retro appended at gate close.

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
