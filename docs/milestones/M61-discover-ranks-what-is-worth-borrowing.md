# M61 — Discover ranks what's worth borrowing now

**Status (2026-11-12): built, merged and live; gate open only on Mitchell's walk.** Minted by Mitchell on 2026-11-09: *"Create a new
milestone going after the current in program one M60, That makes the discover page have a better
way of showing relevant pages. There should be a ranking algorithm based on age, how often its
added, how many stars it has, has many comments, and have it recalculating and caching on a
reasonable interval."* **Placed directly after M60**, so the order is M59 → M60 → M61 → M53, with
M48 parked. **Scoped 2026-11-11:** Mitchell answered decisions 1–10, every one as recommended,
and asked for the stack to be built while he tests M60. The rule is ADR-090
(`docs/architecture/ADR-090-discover-ranks-by-a-stored-decayed-score.md`); the plan, deleted at the gate close, was
`docs/plans/2026-11-11-M61-discover-ranks.md`.

## Why this exists

Discover (`/playbooks`) ranks a day by one signal at a time. The four sorts are a `Record` in
`orderBy` (`apps/web/src/server/playbooks.ts:358`) and its keyset twin `rankKeys` (`:669`):

| Sort | Order | What it gets wrong |
|---|---|---|
| `most-added` (the default, `discoverUrl.ts:67`) | `adds desc, created_at desc` | A lifetime counter. A day that was added a lot in August stays above a day half the library added this week. A new day starts at 0 and goes to the bottom, so it can't collect adds. |
| `highest-rated` | `rating desc nulls last, review_count desc` | A single 5-star review beats twenty reviews that average 4.8. |
| `most-reviewed` | `review_count desc, rating …` | Counts one-star reviews as votes for the day. |
| `newest` | `published_at desc` | Ignores whether anyone wanted the day. |

None of them answers *"what should I look at first?"* That question mixes all four signals, and
weighs recent interest above old interest.

### What already exists, and is reused

| Piece | Where | Reused for |
|---|---|---|
| The adds ledger, one row per (day, trip), with `created_at` and `added_by` | `saved_day_adds`, `server/db/schema.ts:1332` | "how often it's added", weighted by when (decision 2) |
| Reviews, one per (day, reviewer), with `stars`, a `note` of up to 140 characters and `hidden_at` | `saved_day_reviews`, `schema.ts:1365` | stars (decision 3) and comments (decision 4) |
| An author can't add or review their own day | `putReview`'s `own-day` refusal, `server/reviews.ts:170`; the adds ledger's D2 | the author can't push their own day up |
| `published_at`, `created_at` | `saved_days` | age (decision 1) |
| The predicates every library read shares (`notDeleted`, `notModerated`, public visibility) | `matchPredicate`, `playbooks.ts` | which days get a score |
| Coolify scheduled tasks, each a `curl` with `CRON_SECRET` | `docs/ops/coolify-vps.md` *Crons*, `server/cronAuth.ts`; M59 decision 8: never an in-app timer | the recompute (decision 5) |
| The signed-out library cache, a day long, tag-invalidated | `libraryCached`, `server/libraryCache.ts` (ADR-063) | caching the ranked page (decision 6) |
| Keyset paging over `rankKeys`, held to `orderBy` by `public-api/discover.int.test.ts` | `discoverPage`, `playbooks.ts` | paging the new sort |

## Decisions

### Answered 2026-11-11 — all ten as recommended

1. **What "relevant" means, as one number.** *Recommendation:* a **score per public day**, made
   of two parts.
   - **Interest**: recent adds, plus recent comments, each weighted by how long ago it happened
     (decisions 2 and 4).
   - **Quality**: a multiplier from stars (decision 3).

   **Age** enters twice. Every add and comment decays with its own age. The day itself also gets a
   *new-day lift* that fades over its first 14 days, so a day published today is seen before it
   has had any chance to be added:

   ```
   score = quality × (interest + newDayLift)
   interest    = 3·Σ adds 0.5^(age/14d) + 2·Σ comments 0.5^(age/30d)
   newDayLift  = 4 × 0.5^(dayAge/7d)
   quality     = clamp(bayesianStars / libraryMean, 0.7, 1.3)   (1.0 with no reviews)
   ```

   No gravity on the day's own age beyond the lift. A Hacker News style `/(age+2)^1.8` would turn
   a library of about 180 days, with a few adds a week, into *newest* by another name. Decay on
   the *events* means that a day nobody touches drifts down, and a day people still add stays up,
   whatever its age. The weights and half-lives are constants in one module, so tuning them is a
   one-line change with a test. They are starting values. Decision 8's operator view is how
   they're checked against production.

2. **"How often it's added": what counts.** *Recommendation:* **distinct people, decayed**. One
   person adding the same day to three trips counts once, at their latest add. The author is
   already excluded by the ledger. Deleted trips' adds still count, as the counter counts them
   today. `saved_days.adds` stays the lifetime number shown on the card. The score doesn't change
   what the card says.

3. **Stars: a Bayesian average, not the raw mean.** *Recommendation:*
   `(C·m + Σstars) / (C + n)`, with `m` the library's mean rating and `C = 5`. Hidden reviews
   don't count, the same as `rating` today. Divided by `m` and clamped to 0.7 to 1.3, so stars
   move a day but can't bury one or carry one by themselves. An unrated day is 1.0, neutral, not
   penalised. That's `rating`'s *null is a state* rule (`schema.ts:1191`).

4. **"Comments": there is no comment on a day today.** The only text people leave on a day is a
   review's `note`. *Recommendation:* **a comment is a visible review with a non-empty `note`**,
   decayed from its `updated_at` with a 30-day half-life. A star-only review counts toward
   quality and not toward comments. That keeps "says something about it" apart from "rated it".
   A real comment thread on days is a separate feature and is out of scope. If Mitchell meant one,
   this decision becomes a milestone of its own before this one.

5. **The interval.** *Recommendation:* **hourly**, as a third Coolify scheduled task,
   `/api/cron/discover-rank` at `:17` past each hour (off the hour, and away from the 04:00 and
   04:30 jobs). The recompute is one `insert … select … on conflict do update` over the public
   days, a few hundred rows today, so it takes milliseconds and costs nothing worth budgeting.
   Two writes don't wait for the hour:
   - **Publish** (and re-publish) computes that one day's row in the same request, so a new day
     appears in its place at once. It uses the same SQL, filtered to one id: one implementation.
   - **Unpublish, delete and moderation** need nothing. The read joins through `matchPredicate`,
     so a day that has left the library is never listed, whatever its stored score.

   Every 15 minutes was considered. Interest decays over weeks, so an hour of staleness is not
   visible, and fewer cache busts keep the signed-out page warm (decision 6).

6. **Where the score is stored, and what is cached.** *Recommendation:* a table
   **`saved_day_ranks`** (`saved_day_id` primary key, `score`, the components `adds_recent`,
   `comments_recent`, `quality`, `new_day_lift` as columns, `computed_at`). It's a derived,
   rebuildable projection and holds no history. It's CRUD and stays out of the event log, on
   `saved_day_reviews`' terms. Discover reads it with a `left join`.
   - **Signed out**, the ranked page is held in the existing data cache under a new tag,
     **`discover-rank`**. The cron clears that tag after each write, and only that tag. Clearing
     `LIBRARY_TAG` every hour would also throw away every place, tag and day page's cache, which
     the score doesn't change.
   - **Signed in** reads are live, as today, and see the newest scores.
   - **A day with no row yet** (a fresh database, a test lane, a cron that hasn't run) ranks after
     every scored day, by `adds desc, created_at desc`. Discover works on an empty table. The
     e2e and integration lanes call the recompute directly.
   - Redis was considered and isn't needed. Postgres holds the score next to the rows it filters,
     and the page cache is already paid for (ADR-059, ADR-063).

7. **Where the ranking shows.** *Recommendation:*
   - **Discover**: a new sort, **`top`**, labelled *Top*, becomes the **default** for the
     Everyone scope. The other four sorts stay. *Yours* and *Saved* keep `newest`. The heading
     for `top` reads *"Worth borrowing right now"* (Mitchell approves the words on the preview).
     A `?sort=most-added` link, today the implicit default, now has to be spelled out, and
     `DISCOVER_URL_DEFAULTS` moves so the canonical rule in `placeCanonical` still holds.
   - **Place, tag and length pages** (`publishedDaysPage`, *most-added first* today) switch to
     `top`.
   - **The public API and MCP** (`GET /v1/discover/playbooks`, `list_discover_playbooks`) gain
     `sort=top` as an **additive** contract change, with a `docs/contracts/CHANGELOG.md` entry.
     The API's default stays `most-added`, so no client's results change under it.
   - **The assistant's** library read (`server/assistant/tools/read.ts`) defaults to `top`.
   - **Not the landing.** M51's sea of cards is chosen by its own rules, and isn't part of this.
   - Keyset paging gets steadier. A score holds still between recomputes, so the *"a day whose
     adds move between two requests may be seen twice"* caveat on `discoverPage` only applies at
     the hour.

8. **Seeing why a day ranks where it does.** *Recommendation:* a **Discover rank** tab in the
   operator console. It lists the top 50 with each component, `computed_at`, and the constants in
   force, so a tuning change can be judged on production data rather than guessed. Operator-only,
   on the console's existing guard. It is how the gate's *[walk]* checks the order makes sense.

9. **Gaming.** *Recommendation:* nothing new beyond what the ledgers already enforce: no own
   adds, no own reviews, one review per person, distinct adders (decision 2), hidden reviews
   excluded, moderated days excluded. A burst of adds from new accounts is a candidate if it ever
   shows up in decision 8's view. It isn't built speculatively.

10. **Placement.** Asked: *"going after the current in program one M60"*. **Directly after M60,
    ahead of M53.** Nothing here depends on M60. It could run before it if Mitchell reorders.

### Answered during the build

11. **The new-day lift ages from the first publish** (Mitchell, 2026-11-11, on part 1's review).
    Unpublishing and republishing, or a content re-import without `keptOn`, resets `published_at`,
    so a lift aged from it could be re-earned at will, against decision 9. `saved_days` gains
    `first_published_at`, set once on the first publish and never overwritten, back-filled from
    `published_at`; the lift reads it.

12. **Top is the default on every scope, and Newest is always one choice away** (Mitchell,
    2026-11-11, on part 3's review: *"Can we do the new ranking algorithm as the default but also
    make sure you can sort on newest to?"*). Decision 7's "*Yours* and *Saved* keep `newest`"
    misdescribed `main`, where every scope defaulted to `most-added`. Discover has one default
    sort, `top`, for Everyone, Yours and Saved; *Newest* stays in the sort menu on every scope.
    Under `top`, a reader's private days (which have no score) list after their public ones, by
    `adds desc, created_at desc`; *Newest* is the answer for "my latest first".

### The ADR

Decisions 1, 5 and 6 make one rule: *Discover's default order is a stored score, recomputed
hourly from decayed adds and comments, Bayesian stars and a new-day lift, and read through a
cache cleared only by its own tag.* It is **ADR-090** (M60's part 0 claims ADR-089).

## Scope

Five parts, as one stack, once scoped. The files go in the plan.

1. **The score** (decisions 1 to 4, 6): the `saved_day_ranks` migration; `server/discoverRank.ts`
   with the constants and the one recompute statement (all days, or one id); integration tests
   that hold the score's properties.
2. **The interval** (decisions 5 and 6): `/api/cron/discover-rank` behind `cronAuth`, clearing
   the `discover-rank` tag; publish computes its day's row; the Coolify scheduled task and its row
   in `docs/ops/coolify-vps.md`'s *Crons* table.
3. **Discover reads it** (decision 7): `top` in `DiscoverSort`, `orderBy` and `rankKeys`; the
   new default and `DISCOVER_URL_DEFAULTS`; the sort menu and heading; place, tag and length
   pages ordered by `top`; the signed-out cache under `discover-rank`.
4. **The API, MCP and the assistant** (decision 7): `sort=top` on `/v1/discover/playbooks` and
   in the OpenAPI document, `list_discover_playbooks`, the assistant's read tool, and the
   contract change log.
5. **The operator view** (decision 8): the *Discover rank* tab.
0. **The gate**: ADR-090, the evidence and the retro.

## Out of scope

- A comment thread on days, separate from reviews (decision 4).
- Personalised ranking: a reader's own trips, places or tags changing their order.
- Views, clicks or dwell time as signals. Nothing records them per day today, and Plausible's
  numbers are aggregate.
- The landing page's choice of cards.
- Anti-abuse beyond the ledgers' rules (decision 9).

## Exit gate

- [x] **Each signal moves a day the right way:** with everything else equal, a day with more
  recent adds, more recent comments or better stars ranks higher; the same adds a month older
  rank lower; one person adding a day to three trips counts as one; a hidden review counts for
  nothing (integration tests, each seen red by changing the constant or the clause it protects).
  Evidence: `apps/web/src/server/discoverRank.int.test.ts:92-212` (*each signal moves a day the right way*), each seen red by the part 1 reviews (21 mutants red, PR 722 tracker); CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **Stars can't carry a day alone:** one 5-star review ranks below twenty reviews averaging
  4.6 with the same adds, and an unrated day ranks the same as a day rated exactly the library
  mean.
  Evidence: `apps/web/src/server/discoverRank.int.test.ts:235-279`; CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **New days are seen:** a day published now, with no adds, appears on Discover's first page
  of an otherwise-settled library without waiting for the cron, and has dropped below a steadily
  added day after 14 days (integration, with the clock moved).
  Evidence: `apps/web/src/server/discoverRank.int.test.ts:281-345` (lift, 14-day crossover with `now` moved, publish computes its own row); CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **The interval:** `/api/cron/discover-rank` answers 401 without `CRON_SECRET`, rewrites
  every public day's row with it, and clears only the `discover-rank` tag (a test on the tags it
  revalidates). The scheduled task is in Coolify and in the runbook's *Crons* table, and its
  execution log shows a success in production.
  Evidence: `apps/web/src/app/api/cron/discover-rank/route.test.ts:34-61` (401, every row rewritten, only the `discover-rank` tag revalidated); CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green). Runbook row in `docs/ops/coolify-vps.md`. Coolify task `discover-rank` (`17 * * * *`, uuid ikinihbvonqrcc3lyhx1p49b, created 2026-11-12 07:11 UTC) shows `success`, `200 {"ok":true}`, at 07:17, 08:17 and 09:17 UTC (executions API, re-read 2026-11-12).
- [x] **No row, no failure:** on a database with an empty `saved_day_ranks`, Discover lists every
  day in `adds desc, created_at desc` order.
  Evidence: `apps/web/src/server/playbooks.places.int.test.ts:128` (an empty table lists most-added) and the unscored days walked in `apps/web/src/server/public-api/discover.int.test.ts:193-218`; CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **Left the library, left the list:** after unpublish or moderation, the day is gone from
  Discover's next signed-in request and from the next signed-out request after the tag clears,
  whatever its stored score.
  Evidence: `apps/web/src/server/discoverRank.int.test.ts:390` (`topDiscoverRanks` leaves out deleted, moderated and private days), `playbooks.places.int.test.ts:48`; CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **Paging:** the `top` sort's keyset pages and `orderBy` agree on the same order
  (`public-api/discover.int.test.ts` extended to `top`).
  Evidence: `apps/web/src/server/public-api/discover.int.test.ts:193-218` (keyset pages equal `orderBy` for `top`); CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **Surfaces:** Discover defaults to *Top* for Everyone, `?sort=most-added` still works,
  place, tag and length pages list by `top`, `GET /v1/discover/playbooks?sort=top` answers and
  its default is unchanged, and the contract change log has the entry.
  Evidence: `discover.int.test.ts:168` (`sort=top` answers, default unchanged), `components/playbooks/discoverUrl.test.ts`, `docs/contracts/CHANGELOG.md:16` (the 2026-11-11 entry); CI on PR 727 @ f04c8c3, run 43128734860 (lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` all green).
- [x] **[walk]** Mitchell opens Discover on production on his phone signed out, then signed in,
  and judges the first page against the *Discover rank* tab: the order makes sense and he can see
  why each day is where it is.
  **WAIVED, not walked.** On 2026-11-14 Mitchell told the orchestrator *"Let's close out the gate
  and merge"* without saying he had walked production; the orchestrator took that as a waiver. No
  browser walk of preview or production was recorded, by him or by any session.

## Retro — written 2026-11-12 (8 of 9 boxes ticked)

### What went well
- The stack landed whole: PR 727 merged as 678a90d on 2026-11-12 at 04:28 UTC with parts 1 to 5
  (PRs 723 to 726 had been merged into the stack at 19d7bd7). Full CI on its head f04c8c3 was green
  (run 43128734860: lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok`).
- The red first CI (3c25e34) was two mechanical misses, the docstring wall and two baselines
  (`exposure.test.ts`, `contextBudget.test.ts`). Each was fixed on the lowest part it touched and
  merged up, never re-run.
- Part 1's tests were checked by breaking the code: 21 mutants went red over three review rounds
  (PR 722 tracker).
- A fresh part-reviewer pass over 321b473..f04c8c3, and over part 3 after 750a16f, found no blocker
  and no should-fix. Four nits were left on purpose, because a push to the top re-runs full CI (they
  are in PR 722's tracker). `pnpm arch`'s 9 cycle warnings are identical on `main`.
- `migrate-production` applied `0076_saved_day_ranks` from 678a90d at 04:36 UTC (run 43155805732),
  and the Coolify task `discover-rank` has succeeded `200 {"ok":true}` at 07:17, 08:17 and 09:17 UTC.

### What could be better
- **The gate closed without a walk.** The *[walk]* box is ticked as a waiver (2026-11-14, Mitchell:
  *"Let's close out the gate and merge"*), not as evidence: nobody opened Discover on production, so
  the order's sense, the `first_published_at` back-fill and the constants are unchecked by eye.
- **Production was down for about 8 minutes after the merge.** The new code deployed before `0076`
  was applied, so queries on `saved_day_ranks` and `first_published_at` failed until
  `migrate-production` finished. This is inferred from the timing (merge 04:28, migration done
  04:36), not traced in logs. `grep -ril "migrat" docs/known-issues/open/ | xargs grep -il deploy`
  turned up no entry about deploy-before-migrate ordering (the hits are about other things), so
  none exists. Follow-up for Mitchell: file one through the known-issues process, and consider
  running the migration before the deploy, or making the new reads tolerate a missing table. It is
  not filed here, because this close does not run that process.
- **The `0076` back-fill of `first_published_at` checked against production, 2026-11-14 05:14 UTC (read-only, SELECT only, Neon `production` branch): correct.** Of 239 `saved_days` rows with `published_at` set (243 in all), `first_published_at` is NULL on 0, is set on 0 unpublished rows, and equals `published_at` on all 239 (0 later, 0 earlier); 2 days published after the migration also match. Query: `SELECT count(*) FILTER (...)` over `saved_days` comparing `first_published_at` with `published_at`. Not checked by eye on Discover: the *[walk]* is still waived.
- **The orchestrator's share target (under 15%) was missed in every session that has a figure:**
  27.9% in session 1, 37.6% in session 2, and 83.9% in session 3, where the work was a re-review, a
  merge, a migration dispatch and a cron setup, which is orchestration by nature and had no
  builder to share it with. Summed, it is 37.8%. Sessions 2 and 3 are what lifted it. Splitting a
  close into three sessions made the orchestrator's re-orientation the biggest cost of each.
- The gate close needed a fourth session. Its own spend is not in the block below.

### Leftovers
- **The *[walk]* box**: Mitchell's call. Production, signed out and signed in, against the
  *Discover rank* tab. Nobody has opened preview or production in a browser.
- **Deploy-before-migrate ordering**: a known issue to file (see above); no id yet.
- **Four review nits** (PR 722's tracker): the `rankKeys` JSDoc in `playbooks.ts` still says the
  API does not offer `top`; a double blank line in `discoverRank.ts`; the `0076` back-fill lacks a
  redundant `first_published_at IS NULL`; `topDiscoverRanks` breaks score ties differently from
  Discover's Top (operator view only). None is filed; Mitchell's call whether any is worth a PR.
- **Tuning the constants** (decision 1) waits on the walk. They are starting values.

## Spend

Four sessions worked on M61; the first three are summed here. Their transcripts went with their
containers, so this block is the three sessions' figures as carried in their hand-offs, added by
hand, not output from `session-metrics`. Session 4, this gate close, is not included.

<!-- session-metrics:milestone v1 -->

30 agents, 849 API calls, 10.07M units (session 1, build: 24 agents, 692 calls, 7.39M; session 2,
close step 1 and CI fix: 4 agents, 71 calls, 1.09M; session 3, re-review, merge, migrate and cron:
2 agents, 86 calls, 1.59M). One unit is input + 1.25 x cache write + 0.1 x cache read (output
excluded, transcripts understate it).

**By agent type**

| Who | Agents | Units | Share |
|---|---|---|---|
| `phase-implementer` | 16 | 3.80M | 37.8% |
| `orchestrator` | 3 | 3.80M | 37.8% |
| `part-reviewer` | 8 | 1.70M | 16.8% |
| `general-purpose` | 2 | 573k | 5.7% |
| `Explore` | 1 | 196k | 1.9% |

**By session**

| Session | Agents | Calls | Units | Orchestrator's share |
|---|---|---|---|---|
| 1, build | 24 | 692 | 7.39M | 2.06M (27.9%) |
| 2, close step 1 and CI fix | 4 | 71 | 1.09M | 411k (37.6%) |
| 3, re-review, merge, migrate, cron | 2 | 86 | 1.59M | 1.33M (83.9%) |

Not measured, because the transcripts are gone and no figure was carried: average and peak
context, orchestrator turns by trigger, cache re-writes, guard denials, dollars, lines added.

### Spend against the last milestone
- **Dollars per 1,000 lines added (under 20):** not measurable. No cost and no lines-added figure
  was carried out of the build sessions.
- **Orchestrator's share of the spend (under 15%):** 37.8%, **missed**. It was over 15% in all
  three sessions (27.9%, 37.6%, 83.9%); see *What could be better*. The last milestone's figure
  is not in this file.
- **A builder's average context, GitHub wakes, cache re-writes:** not measured.
