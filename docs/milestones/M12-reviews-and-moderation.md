# M12 — Reviews and moderation

**Status:** Scoped 2026-09-01. Placed **after M9** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until
now — it was a row in `docs/milestones/README.md`'s table and nothing else,
against that file's own rule that each milestone gets a file "with an exit
checklist before work on it begins."

**Retitled from "Community" 2026-09-01.** The public gallery and discovery that
name promised **shipped in M11b**. What is left is the half Mitchell drew the
scope line around on 2026-08-30: *"M11b takes everything in §15 except reviews;
M12 keeps reviews, ratings and moderation."*

**It needs one migration** — a `saved_day_reviews` table, plus the derived
counters M11b left off `saved_days`. Merging does not apply it; dispatch with
`gh workflow run migrate-production.yml -f confirm=migrate` from `main`, and say
so in the PR body.

## Why this exists

M11b shipped the library. Every rating in it is a lie.

`SPEC.md` §15 closes with the line this milestone exists to delete: **"Until the
reviews table exists, every rating here is fixture data."** That is still true
in `main`. `saved_days` carries `cities`, `visibility`, `adds`, `published_at`
and `source_trip_*` — and **no `rating`, no `review_count`, and no reviews
table anywhere in `schema.ts`.**

Three things follow, all live in shipped code:

1. **The shared day's rating rail has nothing behind it.** §15 specifies the
   rating, a 5→1 histogram and a review list on route `day`. The route shipped;
   the rail's numbers do not come from reviews because there are none.
2. **Discover ships two sorts, not four, and no rating floor.**
   `DiscoverScreen.tsx:32` says so in a comment, and
   `api/playbooks/route.ts:25-27` deliberately answers `?sort=highest-rated`
   with the default rather than a 400 — *"a link written against §15's four
   sorts or a link from the future"*. **That comment is a promise this
   milestone keeps.** Both deltas were recorded by M11b rather than left to be
   rediscovered; do not "fix" them anywhere else.
3. **Nothing can be reported.** M11b publishes user-authored text — day names,
   per-stop notes — to a public library, and the only thing standing between
   that and a moderation problem is M11a's invite gate. That was Mitchell's
   explicit reasoning on 2026-08-30 (*"we will gate on who we invite to
   platform... we need a community before its a issue"*), and it is a
   deliberate deferral with a named end date: **this milestone.**

## Scope

Seven links. Links 1-2 are contract-and-migration work; 3-6 stand on them. **Link 7 was added 2026-09-09 on Mitchell's request** and is independent of the other six — it is Discover's search box, not trust and safety. See the note under *Deliberately not here*, which it amends.

1. **The reviews table.** `saved_day_reviews` keyed on (saved day, reviewer) —
   one review per person per day, so a re-post is an update, not a second row.
   Stars 1-5 required, note optional and **capped at 140 characters** (§15).
   Reviews are **not** trip state: like M17's preferences they are not
   versioned, not undoable and not part of any trip's history, so they are an
   ordinary table and **must not enter the event log** (the same reasoning
   ADR-029 applied to saved days).
2. **Derived counters on `saved_days`.** `rating` and `review_count`, maintained
   on write, so Discover can sort and filter without a join per card — the same
   shape as `adds`, which M11b already denormalises. **A test must fail if a
   counter drifts from the rows it summarises**; that is the KI-1/KI-14 defect
   class this repo has named twice, and `budgetPerPerson` (M19) is the current
   example of it going unnoticed.
3. **Posting a review, with §15's three states.** Anyone signed in, no gate.
   Posting recomputes the average **live**. Empty (*"nobody has rated this
   yet"*), offline (held on device, badged *Queued*) and conflict (*"Mei changed
   this day two days ago"*) all ship — they are named states in the design, not
   edge cases to add later.
4. **The shared day's rating rail.** The average, the 5→1 histogram, the review
   list. Replaces the fixture data the route renders today.
5. **Discover's two missing sorts and the rating floor.** `highest-rated` and
   `most-reviewed` become real, and the rating-floor filter appears — restoring
   §15's four sorts and four filters. The profile's average and "reviews
   received" land with them, since both read the same counters.
6. **Reporting and moderation.** A report action on a shared day and on a
   review; a state a day can be put into that removes it from Discover, the
   board and profiles without deleting the author's copy; and one place an
   operator can act. **This is the trust-and-safety scope quarantined here since
   2026-07-28** — it does not get spread across earlier milestones.

7. **Search by country as well as city, one box, either selectable.** Mitchell,
   2026-09-09. Discover's search asks one question today — *which city* — and
   `GET /api/cities?q=` answers with city names only. A person who wants
   "anywhere in Japan" has to know which Japanese cities the library happens to
   hold. This link makes the box return **both kinds**, labelled, and lets the
   searcher pick either.

   **The collision is real, not hypothetical, and it is why "labelled" is in the
   sentence above.** The content library contains the cities **Mexico City** and
   **Monaco**; the countries **Mexico** and **Monaco** both have days. Typing
   `Mexic` must offer the country and the city as two distinguishable things —
   a flat list of bare names cannot express which one a click selected.

   Five pieces:

   * **`countriesOfStops` in the domain**, beside `citiesOfStops`
     (`packages/domain/src/trip/cities.ts`), reading `location.countryCode` with
     the same dedupe rule. **One implementation, shared** — the argument
     `citiesOfStops` already makes for itself, and the reason a profile's
     numbers cannot contradict Discover's.
   * **`saved_days.countries`**, a `text[]` snapshot with a GIN index, a
     migration and a backfill. A column and not a per-query derivation for
     ADR-029's reason: `stops` is a jsonb value that is never queried into.
     `savedDayCities.ts` is the existing bridge a maintenance script may import
     without reaching into `packages/domain`; the country rule needs the same
     treatment, not a second path.
   * **The search endpoint returns a discriminated result** — `{ kind: "city" }`
     / `{ kind: "country" }`, each with its published-day count. `CityMatch`
     (`lib/cities.ts`) widens or gains a sibling; `/api/cities` is then misnamed
     and should say places.
   * **Discover filters on either.** The route reads a repeatable `?city=`
     today; `?country=` joins it, and `discoverDays` gains a
     `countries && ARRAY[...]` beside its `cities &&`.
   * **The result row distinguishes the two kinds**, per the collision above.

   **The one non-obvious constraint, and it decides the implementation:
   country NAMES do not exist in the database.** Only ISO-3166 alpha-2 codes do,
   and the code→name mapping is `Intl.DisplayNames`, which runs in JS and not in
   SQL. So `ILIKE 'Japan%'` has nothing to match. Two ways out:

   * store the display name alongside the code — **rejected**: it is
     locale-dependent, and a stored English label is a fact that goes stale the
     day anyone wants another language;
   * **select the distinct codes and their counts** (at most ~200 rows, and far
     fewer in practice), map them through `Intl.DisplayNames`, and prefix-filter
     in JS. **Recommended.** The code stays the stored truth and the name stays
     derived.

   `countryName` already exists at `apps/web/src/lib/place.ts:74` and is
   **private**; it needs exporting or a shared home rather than a second copy.

   **Ranking needs one decision.** §15's rule is *matched-city count first, then
   the chosen sort*. A day matching a selected country and a day matching a
   selected city are not comparable on that scale, and the rule as written does
   not say which wins. Decide it before building, not during.

## Exit gate

- [ ] A signed-in person rates a shared day with stars and an optional note, the
      average recomputes **live** without a reload, and both survive a sign-out,
      a sign-in and a server restart.
- [ ] A second review from the same person **updates** their review rather than
      adding a row, and the average moves accordingly.
- [ ] A note longer than 140 characters is refused at the contract boundary, not
      truncated silently in the UI.
- [ ] **`saved_days.rating` and `review_count` cannot drift from
      `saved_day_reviews`** — a test fails if they do. Naming a counter is not
      evidence it is right; this repo has been caught by that three times
      (KI-1, KI-14, and `budgetPerPerson`).
- [ ] Discover offers **all four sorts and all four filters** from §15, and
      `?sort=highest-rated` returns highest-rated results rather than the
      default — the promise `api/playbooks/route.ts` currently records as a
      link "from the future".
- [ ] All three review states from §15 are reachable and walked: empty, offline
      (badged *Queued*), and the conflict banner.
- [ ] A reported day is removed from Discover, the board **and** profiles by one
      action, the author still has their copy, and the operator path is walked
      end to end.
- [ ] **The reviews migration is written, applied locally, and its production
      dispatch is called out in the PR body.** An undispatched migration is
      schema drift.
- [ ] **Typing `Mexic` returns the country *Mexico* and the city *Mexico City*
      as two distinguishable results**, and selecting each one filters Discover
      **differently** — the country's set contains days the city's does not.
      Walked, not asserted from a unit test: the point of the feature is that a
      person can tell which one they clicked.
- [ ] **A country's day count equals the published days that touch it**, counted
      once per day however many of that country's cities the day visits — the
      same "count days, not city-hits" rule `searchCities` already follows. A
      test fails if a multi-city day double-counts.
- [ ] **The `countries` backfill's coverage is measured and written down**, and
      the filter is not shipped over a column that is empty for most of the
      library. See the prerequisite below — this box exists because the library
      carries **zero** country codes today.
- [ ] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
- [ ] Retro appended at gate close.

## Deliberately not here

- **Voting.** The 2026-07-28 scope line said "voting"; §15's board **ranks on
  real-trip adds only**, and states in copy why. M11b built that ledger. Adding
  a second popularity signal would give the board two answers.
- **Follows, bios, avatars.** §15 is explicit: a profile is *derived, never
  authored*, and *"a public user record is not needed."*
- **Anything that changes what M11b ships — with one amendment, 2026-09-09.**
  The two sorts and the missing filter are this milestone's to add; the rest of
  Discover was done. **Link 7 is the exception, added on Mitchell's request**:
  country search does change what M11b shipped — the search box, the endpoint
  and the day query. It is recorded here rather than smoothed in, because this
  bullet said the opposite the day before, and because it widens M12 past the
  trust-and-safety scope the milestone was quarantined to hold.

  **The alternative, if that widening is unwanted:** carve link 7 out as its own
  small milestone, the way M11b was carved out of M11. The argument for keeping
  it here is that M12 is the only milestone that reopens Discover's filter row
  and its search components, and doing this separately means two passes over the
  same files and two migrations instead of one.

## Prerequisites

**M11b, and it is closed** (gate closed 2026-08-31). This milestone reads
`saved_days`, `saved_day_adds` and the four routes M11b built, and adds to them.

**M11a, and it is closed** — the invite gate is the standing argument for why
moderation could be deferred this long. If the gate is ever removed, this
milestone becomes urgent rather than scheduled.

**Link 7 has a data prerequisite, and it is the thing most likely to be
discovered late.** Measured on `main`, 2026-09-09: the content library holds
**1,375 locations, 1,091 with coordinates, and `countryCode` on none of them**.
`countryCode` is something the geocoder populates (ADR-007), and the app's own
enrichment path does set it (`geocodeEnrichment.ts`) — but the content bundles
under `content/` were geocoded by `scripts/geocode-content.py`, which writes back
`lat`/`lng` only. So a `countries` column backfilled from today's library would
be **empty for all 148 imported days**, and the filter would silently omit them.
That is precisely the trap M11b named when it refused to ship a `region` field:
*"a field nothing can populate would be null in every demo, preview and
screenshot."*

**The fix is small, which is the good news.** The script already knows the
answer: `learned_countries()` computes city→ISO2 by majority vote over the
`country_code` column of its own `places` cache, and uses it internally to
disambiguate same-named towns. It simply never persists it. Writing
`countryCode` back alongside `lat`/`lng` is the prerequisite, and
`scripts/geocode-test/replay.py` — the fake-provider harness that exists because
this script failed four times in ways that all looked like the API's fault — is
how it gets verified without a network round trip. Then re-import
(`docs/guidelines/content-bundles.md`).

**Not blocked on M9, M13, M14 or M17.** Nothing here reads a preference, a
realtime transport or a macro. It is placed after M9 because M9 is smaller and
unblocks a shipped-but-dark feature — not because of a dependency.
