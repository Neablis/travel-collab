# M12 — Reviews and moderation

**Status:** Scoped 2026-09-01. Placed **after M9** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until
now — it was a row in `docs/milestones/README.md`'s table and nothing else,
against that file's own rule that each milestone gets a file "with an exit
checklist before work on it begins."

**Two milestones moved in front of it, 2026-09-18, and one of them changes the
row this milestone is about.** Order from here:
`… → M22 → M25 → M23 → M13 → M12 → M24 → M14 → M19`.

- **M23 runs first, and that is deliberate.** It generalises a saved day into a
  saved *sequence* — a flat `stops[]` with a per-stop day indicator — so the
  `saved_days` row this milestone keys reviews, ratings, reporting and
  moderation to **changes shape before those are built**. Running M12 first
  would mean revisiting them. Read `M23-multi-day-playbooks.md` before scoping
  anything here, and note the question it hands forward: **what a review is
  attached to once a playbook can be three days** — the sequence, or a day
  inside it. M23 does not answer that; this milestone does, and it is the first
  thing to settle.
- **M13 also moved ahead**, for reasons that have nothing to do with this
  milestone — see `docs/milestones/README.md`'s 2026-09-18 note. It changes
  nothing here except the order.
- **Nothing about this milestone's scope, links or gate is amended by either.**

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

   **2026-09-23 — backend built; coverage measured; the data step is a person's.**
   Decided: places are OR'd (a day matches any selected city or country), and
   `matched_count` is matched cities plus matched countries — each selected
   place counts one. `GET /api/places?q=` returns `{ kind: "city", city, days }`
   or `{ kind: "country", countryCode, name, days }`, matched on the name's
   prefix only (never the code: `De` must not offer Germany), exact name first,
   then days, a tie going to the country. `/api/cities` is unchanged and marked
   superseded. `geocode-content.py --apply` now writes `countryCode`.

   **Coverage, measured 2026-09-23 on this branch:** the content bundles hold
   1,375 locations, 1,091 with coordinates and **0 with `countryCode`**; of 148
   playbook days (all public) **0** carry a country. The local dev database was
   empty (0 `saved_days` rows). So the gate box "the filter is not shipped over
   a column that is empty for most of the library" is **not yet met**, and
   cannot be from a cloud container: it has no egress to LocationIQ or
   Nominatim, no key, and no `content/.geocode-cache.sqlite`. Codes were not
   hand-written into `content/` instead — that would be exactly the invented
   data the geocoder exists to replace.

   **The run-book, on a machine with `LOCATIONIQ_API_KEY` in
   `apps/web/.env.local` and the geocode cache (or the patience to rebuild it):**

   1. `python3 scripts/geocode-content.py --status` — the cache is present and
      settled; if not, `python3 scripts/geocode-content.py` to work the queue
      (`--provider nominatim` if the daily quota is spent).
   2. `python3 scripts/geocode-content.py --apply --dry-run` — read the
      `countryCode(s)` count, the contested-city list and any conflict lines.
   3. `python3 scripts/geocode-content.py --apply` — writes the codes (and any
      newly-accepted coordinates).
   4. `pnpm content:verify` — the bundles still parse and lint.
   5. Re-import: locally `pnpm --filter web content:import` against a running
      `pnpm --filter web dev`; for production, the path in
      `docs/guidelines/content-bundles.md` → *Publishing to production*. The
      importer writes through `newSavedDayRow`, which now derives `countries`.
   6. `pnpm --filter web db:backfill-countries` against each database — for
      production, dispatch `backfill-countries-production` (`confirm: backfill`) (it is
      idempotent) — it prints `coverage (>= 1 country)` for all rows and for
      published rows. **Write those two numbers here**, then tick the box.

   **Steps 1–4 done 2026-09-23 (`claude/country-filter-data-setup-b08e1f`):
   1,375 of 1,375 locations now carry `countryCode`.** Neither LocationIQ nor a
   fresh run was needed: the main checkout's `content/.geocode-cache.sqlite`
   (2026-09-06) already held 1,333 of 1,345 places, so copying it into the
   worktree left one lookup, done via Nominatim. `--apply` wrote **1,261** codes
   and no coordinates. The other **114** stops sat in cities where no stop had
   ever resolved (all 23 of Koh Lanta, Watkins Glen, Forks, Öræfi…), so the
   geocoder had nothing to vote with. At Mitchell's call they were finished by
   hand: `countryCode` from a city→country table (every one unambiguous), and a
   Nominatim coordinate tried venue → area → town, stored with `precision` —
   15 `venue`, 51 `area`, 49 `city`. Every match was read. The first pass put
   Koh Lanta in Bangkok and Búðir in Garðabær, and those were re-pinned before
   commit. One pre-existing pin was also wrong: *Hotel pickup, La Fortuna
   centro* was in Colombia on `main`; it is now in Costa Rica. **Steps 5–6
   done in production the same day:** `import-content-production` wrote 148
   playbook days (run 35925887263); `backfill-countries-production`, its first
   run (35926175525), scanned 149, updated 1, already current 148 —
   **coverage all rows 149/149 (100.0%), published rows 149/149 (100.0%).**
   The four demo trips were not re-imported (create-if-absent), so their new
   pins are in `content/` but not in production; they are not `saved_days`
   and the filter does not read them.

## 2026-09-23 — the UI half (#212), walked at gate close

Branch `claude/youthful-hopper-zgjdkv`, on top of the backend (#206). No
migration: `0025` already carries every column this reads.

- **Links 3-4, the shared day.** `ReviewRail` heads the sticky rail (average,
  five fractional stars, the 5→1 histogram, or *Unrated so far*);
  `ReviewsSection` under the stops holds the form (stars, the one-line note
  with a code-point counter, Post), *Change it* (an update, never a second
  row), the list, and §15's three states — empty, offline (held in
  `localStorage` by `reviewQueue.ts`, badged *Queued*, flushed on `online`) and
  conflict (`ReviewConflictBanner`, *Post it anyway* / *Discard it*). A note
  over 140 disables Post and is never truncated. The author gets no form.
  **`GET /api/saved-days/:id` now returns `publishedAt`** on the envelope —
  without it the conflict state was unreachable from the real page.
- **Link 5, Discover and profiles.** All four sorts on the results sentence;
  the rating floor in the one *Filters* menu (counted, chipped, cleared, in the
  URL); `★ 4.6 · 12 reviews` or *No reviews yet* on cards; average and reviews
  received on the profile.
- **Link 6, reporting.** *Report this day* and *Report {name}'s review* open
  `ReportDialog` (five reasons, optional note). The operator's queue is a
  **Reports** panel on `/admin` — Open / Actioned / Dismissed, hide-with-note,
  dismiss, restore — first paint server-side after the admin gate, actions
  through the API.
- **Link 7, the box.** `CitySearch` became `PlaceSearch` over `/api/places`;
  every row and chip is tagged *City* or *Country*, and a country is
  `?country=XX` in the URL.

**Not drawn in `.design-sync/`, so decided in the build and open to Mitchell:**
the Report affordances and reasons, the whole operator panel, the conflict
banner's copy (the 409 does not say *what* changed, so the design's "the ferry
time and two stops" was dropped), and one ★ plus a number on cards rather than
five partial stars.

**Still open against the gate:** the three review states and the operator path
are walked in e2e specs (`m12-reviews`, `m12-moderation`, `m12-discover`), not
by a person; the `countries` data is done (#213-#215: production 149/149 days carry a country); a card
matched only by country shows no match line (`DiscoverDay` carries no
`matchedCountries`); a held review is keyed by day, not by person, so two
accounts on one browser share it.

## Exit gate

- [x] A signed-in person rates a shared day with stars and an optional note, the
      average recomputes **live** without a reload, and both survive a sign-out,
      a sign-in and a server restart.
      **Ticked 2026-09-23 (walked, by an agent — see the walk note below):** 4★ posted, rail went *Unrated so far* → *4.0 · 1 review* with 0 navigations; still 4.0 after sign-out/sign-in and after killing and restarting the server.
- [x] A second review from the same person **updates** their review rather than
      adding a row, and the average moves accordingly.
      **Ticked 2026-09-23 (walked + `reviews/route.int.test.ts`):** *Change it* 4★→2★, rail 4.0→2.0, still one row; `GET` returned one review with `isMine`.
- [x] A note longer than 140 characters is refused at the contract boundary, not
      truncated silently in the UI.
      **Ticked 2026-09-23:** contract test (`packages/contracts/test/review.test.ts`) and route test (`refuses a note one character over the cap` → 400); walked: at 141 characters the counter reads *1 over*, Post is disabled and nothing is sent, and a direct `PUT` with the reviewer's cookie answers `400 invalid-review`.
- [x] **`saved_days.rating` and `review_count` cannot drift from
      `saved_day_reviews`** — a test fails if they do. Naming a counter is not
      evidence it is right; this repo has been caught by that three times
      (KI-1, KI-14, and `budgetPerPerson`).
      **Ticked 2026-09-23:** `reviewCounterDrift` (an independent aggregate) is asserted empty after every write in `server/reviews.int.test.ts`; seen red at gate close by making the recompute write `review_count + 1` → `expected { rating: 5, reviewCount: 2 } to deeply equal { rating: 5, reviewCount: 1 }`.
- [x] Discover offers **all four sorts and all four filters** from §15, and
      `?sort=highest-rated` returns highest-rated results rather than the
      default — the promise `api/playbooks/route.ts` currently records as a
      link "from the future".
      **Ticked 2026-09-23 (walked):** sorts *Most added / Highest rated / Most reviewed / Newest*. **The four filters are read as §15's four as amended by §33.2/§35.5:** §15 listed rating floor, month, budget and sort; §33.2 cut the month (*Season*) and added *Length*, and moved sort onto the results sentence — so Rating, Budget, Length and Sort, all present. `/playbooks?sort=highest-rated` loaded directly ordered 5.0, 5.0, 4.5, 4.0 … then *No reviews yet*; the 4+ floor left only ≥4.0 days and survived as `?rating=4`.
- [x] All three review states from §15 are reachable and walked: empty, offline
      (badged *Queued*), and the conflict banner.
      **Ticked 2026-09-23 (walked):** empty — *Unrated so far* / *No one has rated this day yet*; offline — context offline, *You are offline — this will be held on your device…*, row *not sent · Queued*, 0 requests, then *Yours* on reconnect; conflict — a held review, the author unpublished and republished, reconnect → *Alice changed this day just now, after you wrote your review. Read it again — your 3-star review has not posted.*; *Post it anyway* and *Discard it* both walked.
- [x] A reported day is removed from Discover, the board **and** profiles by one
      action, the author still has their copy, and the operator path is walked
      end to end.
      **Ticked 2026-09-23 (walked):** a day with real adds (El Chaltén, 5 adds). *Report this day* → *Thanks — an operator will look at it.*; `/admin` → Reports → *Hide from the library* with a note. After: Discover 1 → 0 shared days, gone from the author's profile, board row 38 → 33 adds and 13 → 12 playbooks, its URL shows *This day is not in the library*; the author still has it in *Yours* and opens it directly.
- [x] **The reviews migration is written, applied locally, and its production
      dispatch is called out in the PR body.** An undispatched migration is
      schema drift.
      **Ticked 2026-09-23:** `0025_reviews_and_moderation` (#206), applied by every local int run; #206's *Migrations* section named the dispatch; `docs/STATUS.md` records production at all 26 migrations including `0025`.
- [x] **Typing `Mexic` returns the country *Mexico* and the city *Mexico City*
      as two distinguishable results**, and selecting each one filters Discover
      **differently** — the country's set contains days the city's does not.
      Walked, not asserted from a unit test: the point of the feature is that a
      person can tell which one they clicked.
      **Ticked 2026-09-23 (walked, real library data):** `Mexic` → *COUNTRY Mexico · 7* and *CITY Mexico City · 1*. The country gave 7 days (`?country=MX`), the city 1 (`?city=Mexico+City`); 6 of the country's days are not in the city's set. The walk also found one of the 7 was a Spanish day (Fuente De) mis-tagged `MX` by #213; corrected in the gate-close commit, so production reads *Mexico · 6* after the next content import.
- [x] **A country's day count equals the published days that touch it**, counted
      once per day however many of that country's cities the day visits — the
      same "count days, not city-hits" rule `searchCities` already follows. A
      test fails if a multi-city day double-counts.
      **Ticked 2026-09-23:** `places/route.int.test.ts` *counts a multi-city day once for its country*, seen red at gate close without the domain dedupe (`expected 3 to be 1`); walked by comparing the API with SQL — MX 7=7 (14 city-hits), IT 16=16 (34), ES 8=8, AR 2=2.
- [x] **The `countries` backfill's coverage is measured and written down**, and
      the filter is not shipped over a column that is empty for most of the
      library. See the prerequisite below — this box exists because the library
      carries **zero** country codes today. **Ticked 2026-09-23: production
      149/149 rows (100.0%), published 149/149 (100.0%)** — link 7's run-book.
- [x] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
      **Ticked 2026-09-23:** #212 — `pnpm check` green (web unit 3,703, int 899), `test:e2e:ci-like` 161/161 including the four M12 specs, CI green on every ready head through `049b16b`.
- [x] Retro appended at gate close. **Ticked 2026-09-23** — *Retro — M12* at the end of this file.

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

## 2026-09-19 — what M26 changes underneath this milestone

**M26 (design parity) rebuilds both surfaces M12 renders into**, and this note
exists so that ordering is a decision rather than a surprise. Scope:
`docs/milestones/M26-design-parity.md`, links 2 and 3.

- **Discover's header is re-sorted by kind of decision** (SPEC §33.2): scope
  becomes underlined tabs above the search, filters become chips with a *More
  filters* menu, and **sort moves onto a results sentence that does not exist
  today**. Link 5's two missing sorts (`highest-rated`, `most-reviewed`) and the
  **rating floor** therefore land as *a chip and two options on a control that
  already has the right shape*, rather than as two more `NativeSelect`s in a row
  the design has deleted. `Rating` is already `face: true` in the design's
  `FILTER_DEFS` — that is, **the design reserves an always-present chip for the
  data this milestone creates.**
- **The shared day gains a day scope and a map** (SPEC §33.1 / §16). Link 4's
  rating rail — the average, the 5→1 histogram, the review list — sits in a
  sidebar whose facts M26 re-cuts, because §33.1 moves stops, window and day
  count up into the title block so no number is stated twice.

**The ordering argument, and it is the same one M23 made for running before
M12.** If M26's links 2 and 3 land first, M12 adds rows and counters to a
finished layout. If they do not, M12 builds its rating rail and its filter into
a header and a sidebar that change underneath it, and the second pass re-does
the first. **Nothing in M12 is blocked by M26 and nothing in M26 is blocked by
M12** — this is about doing the work once.

**What M26 explicitly does not touch**, so it cannot drift into this milestone:
no rating control, no histogram, no review form, no rating floor and no
rating-dependent sort appears in M26's diff. Its own file says that building one
would break project rule 2 — a control over data that does not exist is a
control that does nothing — and `DiscoverScreen.tsx:36-41` already states the
same thing in code.

**One thing M26 hands this milestone for free.** Link 2 cuts the `Season`
filter, which currently occupies a slot in the same filter row. M12's rating
floor takes a `face: true` chip and does not have to argue for the space.

## Retro — M12, closed 2026-09-23

Thirteen boxes, seven links, two PRs of code (#206 backend, #212 UI) and three
of data and workflow (#213 country codes, #214 the production backfill
workflow, #215 its coverage). SPEC §15's line *"Until the reviews table exists,
every rating here is fixture data"* is no longer true: every rating on Discover,
the shared day and a profile is now an aggregate of real review rows, and a test
fails if the stored copy drifts from them.

### How it was worked

The backend landed first as API-only (#206), deliberately with no UI, so the UI
could be built after M26/M27 had settled the layouts it renders into — the
ordering argument this file made on 2026-09-19. The UI (#212) was one typed
client commit (every new endpoint in `apiClient.ts`, each in the never-rejects
table), then **three implementers in parallel worktrees** — shared day, Discover
and profile, the operator console — each confined to its own files and merged
back one at a time. The only merge friction was two files outside every scope
(the docstring baseline and an m11b e2e route glob), which the Discover
implementer named instead of touching.

### What only the orchestrator could see

**The conflict state was unreachable in the real app, and every test passed.**
The shared-day read returned the `SavedDay` contract, which has no
`publishedAt`, so the page could never tell a held review when it had read the
day, and the 409 banner could only fire in a hook test that passed the value in
by hand. The shared-day implementer found it because it was outside their scope
and they could not wire it — and said so rather than faking it. The fix was one
field on the read's envelope (beside `pinning`, not on the contract) and a
screen-level test that fails if the screen passes `undefined` again. **A state
that exists only in a component test is a state nobody has reached.**

### What only the walk found

All four M12 e2e specs, CodeRabbit and CI were green, and the gate walk still
found three things:

- **#213 tagged a Spanish day Mexican.** Fuente De's five stops carried `MX`,
  so *Mexico · 7* included a day in Cantabria; Dundee NY was `GB` and Voss was
  `US`. The counts matched SQL exactly, because the data was consistently wrong.
  Corrected in the gate-close commit. **It needs a content re-import to reach
  production** — `docs/guidelines/content-bundles.md` → *Publishing to
  production* — and then *Mexico* reads 6.
- **The reviews heading made a false claim.** The design's *"N from people who
  added this day"* sat above a review by someone who had added nothing — §15
  lets anyone signed in review. It now states the count.
- **The author is never told their day was hidden** (KI-2026-09-23-i), and
  Discover's results sentence states the page size rather than the match count
  (KI-2026-09-23-h, pre-existing). Both filed.

CodeRabbit found one real bug on #212 (Enter in the place search could add a
result from the previous query during the debounce); fixed with a test seen red.

### How the gate was closed, stated plainly

The walked boxes were walked **by an agent**, in headless Chromium against a
production build (`next start`, never `pnpm dev`) on a local database with the
whole content library imported, at Mitchell's request to "confirm all worked,
check the boxes and close out milestone". Each box records what was clicked and
the text on screen; screenshots were kept in the session scratchpad and not
committed. That is a real walk of real code, but it is not a person looking at
production. The design decisions #212 took without a drawing — where Report
sits and its five reasons, the operator panel, the conflict banner's copy, one
★ plus a number on cards — were merged by Mitchell but not separately
discussed.

The "four filters" box is read as §15's four as amended by §33.2 and §35.5
(Rating, Budget, Length and Sort). The wording of the box predates both
amendments.

### What it leaves

- The content re-import above, which the three corrected codes need.
- KI-2026-09-23-h and KI-2026-09-23-i.
- A review held offline is keyed by day, not by person, so two accounts on one
  browser share a held review (`reviewQueue.ts` says so).
- A card matched only by country shows no match line — `DiscoverDay` carries no
  `matchedCountries`.
- The operator's tab counts stop at the server's 200-row cap without saying so.
- `makeReportHandlers` (MSW) does not set `moderatedAt` / `hiddenAt` on a hide.
- `geocode-content.py --retract` does not retract `countryCode` (from #206).
