### KI-2026-08-31 — A Discover sibling chip's count ignores the budget band, so it can promise more days than the banded page returns — RESOLVED
- **Severity:** cosmetic-to-misleading. Nothing is wrong in the database and no write path is involved; a number on screen overstates what a tap will produce.
- **Area:** `apps/web/src/server/playbooks.ts` — `siblingCities()` and `discoverDays()`; `apps/web/src/components/playbooks/DiscoverScreen.tsx` (the chip row).
- **What is wrong:** the sibling chips are a SQL `group by` over `matchPredicate(query)`, which carries the scope, the cities, the season and the author. It does **not** carry the budget band, because a day's total cost is a sum over its priced stops (`savedDayFacts`) and cannot be a SQL predicate without querying into the `stops` jsonb that ADR-029 calls a value. The band is therefore applied in application code, after the rows come back — so with `Under $200` selected, a chip may read `Osaka · 9` while the page it describes holds two cards.

  *Three details in that sentence were restated on pull request 104 and none of them changes the defect.* The month filter became a season filter; `savedDayFacts.budgetPerPerson` became `totalCost` (it was never per person — nothing divided it, see `M19-cost-model.md` §1); and the bands moved from $50/$150 to $200/$500/$1,000, so the example band is spelled differently. The mechanism — a predicate the SQL cannot carry, applied afterwards in application code — is untouched, and so is every ranked fix below.
- **Reproduction:** publish nine days touching both `A` and `B` where only two of them price under $5,000 minor units; search `city=A` with `budget=under`. The `siblings` entry for `B` reports 9; `days` holds 2.
- **Why not fixed with the `truncated` bug it was found beside:** the two look alike and are not. `truncated` was a flag that stated something false about its own page and had a one-line honest value. This is a design question with at least three defensible answers — compute the chips in application code over the budget-filtered candidates (exact while `truncated` is false, and a narrower promise than "the whole matched set", which `siblingCities`' own comment records as a deliberate choice); recompute nothing and label the chips as unfiltered; or drop the chip counts while a band is active. `AGENTS.md` asks for a pause before a plan-deviating design decision, and PR 102 is a review round on routes, not the place to make one quietly.
- **Worth knowing before picking one:** the chip's count is already not "how many days tapping it would add". City matching is containment (`d.cities && ARRAY[...]`), so adding a city WIDENS the result set; the count is "days in the current match that also touch this city". Whatever fixes the band mismatch should settle that wording at the same time, or the number will still not mean what the row implies.
- **Cross-reference:** CodeRabbit on PR 102 (raised alongside the `truncated` under-report, which IS fixed there); ADR-029 (a saved day is a value, never queried into); `docs/plans/2026-08-30-M11a-M11b.md` (M11b PR3).
- **First noted:** 2026-08-31, addressing PR 102's review.

- **RESOLVED 2026-09-02, by the first of the three ranked fixes above: the chips are counted in application code over the budget-filtered candidates.**

  **Reproduced before anything was changed**, as an integration test in
  `apps/web/src/app/api/playbooks/route.int.test.ts` — three published days each
  touching `A` and `B`, one priced under $200 and two over $1,000, read as
  `city=A&budget=under200`:

  ```
   FAIL  src/app/api/playbooks/route.int.test.ts > GET /api/playbooks >
     counts a sibling chip inside the budget band, not across the whole match
  AssertionError: expected { city: 'bb1bf282b3', days: 3 } to deeply equal { city: 'bb1bf282b3', days: 1 }
  -   "days": 1,
  +   "days": 3,
  ```

  One card on the page, a chip above it promising three — the entry's
  reproduction at a smaller scale.

  **The fix.** `siblingCities()` in `apps/web/src/server/playbooks.ts` was a
  second `db.execute` — a `group by` over `unnest(d.cities)` and
  `matchPredicate(query)` — and `matchPredicate` structurally cannot carry the
  band, for the reason this entry states. It is now a pure function over
  `DiscoverDay[]`, called with `filtered`: the same in-band array `days` is
  sliced out of. One array feeds the cards and the chips, so the two cannot
  disagree again. The `db` round trip per Discover read goes with it.

  The deliberate choice the old comment recorded is kept — the chips are counted
  over every in-band candidate, not over the 24 that fit on the page. What
  bounds them now is `CANDIDATE_LIMIT`, the same window the band already runs
  over, and `truncated` is already the response's word for "that window was
  full". The `order by days desc, city asc` tiebreak became a codepoint
  comparison rather than `localeCompare`, so the row no longer depends on a
  database collation.

  **The wording is settled too**, as the entry asked. The count is *"days in
  these results that also touch this city"*, never *"days tapping it would
  add"*; containment means adding a city widens the match, so a tap returns at
  least this many and never fewer. `DiscoverScreen`'s visible label was already
  right ("Also in these results") — the lie lived in the three doc comments,
  which now say what the number is and warn against "improving" the label into
  the false version.

  **Proven by:** the reproduction above passing, then
  `pnpm --filter web test:int` — **39 files, 446 tests, all passing**, including
  the "busy right now" empty-query chip test and the public-profile tests that
  share `discoverDays`. Plus `pnpm --filter web typecheck` and `eslint` on the
  four touched files. The reproduction stays in the suite as the regression
  test.

  **Files:** `apps/web/src/server/playbooks.ts`,
  `apps/web/src/lib/playbooks.ts` (the `siblings` doc on `DiscoverResponse`),
  `apps/web/src/components/playbooks/DiscoverScreen.tsx` (the chip row's
  comment), `apps/web/src/app/api/playbooks/route.int.test.ts`.

  **One consequence worth stating:** the counts are honest now, so on the seeded
  demo data — where every day is under $200 — three of the four bands show an
  empty page *and* an empty chip row rather than an empty page under chips
  promising days. That is the thin seed data Mitchell's open Vercel-toolbar
  question about the band edges is about, made more visible; the bands were
  deliberately not widened here.
