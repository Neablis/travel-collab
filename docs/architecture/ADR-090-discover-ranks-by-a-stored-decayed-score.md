# ADR-090: Discover ranks by a stored, decayed score, recomputed hourly and cached under its own tag

**Status:** **Accepted — 2026-11-11.** Mitchell answered M61's decisions 1–10 in session, all as
recommended.
**Deciders:** Mitchell (product); Claude — drafted
Related: M61 (`docs/milestones/M61-discover-ranks-what-is-worth-borrowing.md`), ADR-059 and
ADR-063 (the signed-out library cache), ADR-087 (length pages over the place lattice), M59
decision 8 (crons are Coolify scheduled tasks, never an in-app timer).

## Context

Discover's four sorts each rank by one signal: lifetime adds, mean rating, review count, or
publish date. None answers *"what should I look at first?"*, which mixes all four and weighs
recent interest above old interest. A lifetime counter buries every new day.

## Decision

1. **One score per public day:**
   `score = quality × (interest + newDayLift)`, where
   - `interest = 3·Σ adds·0.5^(age/14d) + 2·Σ comments·0.5^(age/30d)`;
   - an add counts **distinct people**, each at their latest add; the author is already excluded
     by the adds ledger;
   - a comment is a **visible review with a non-empty note**, aged from its `updated_at`;
   - `quality = clamp(bayes / libraryMean, 0.7, 1.3)`, with `bayes = (5·m + Σstars) / (5 + n)`
     over visible reviews, and 1.0 for an unrated day;
   - `newDayLift = 4 × 0.5^(dayAge/7d)`.
   The constants are one exported object in `server/discoverRank.ts`; changing one is a one-line
   change with a test.
2. **The score is stored** in `saved_day_ranks`, a derived, rebuildable projection (score plus its
   components and `computed_at`). It holds no history and stays out of the event log. It is
   written by one `insert … select … on conflict do update`, for every public day or for one id.
3. **Recomputed hourly** by a Coolify scheduled task calling `/api/cron/discover-rank` at `:17`,
   behind `CRON_SECRET`; and for one day, in the same request, on publish and re-publish.
   Unpublish, delete and moderation write nothing: the read joins through `matchPredicate`.
4. **Signed-out Discover is cached under the tag `discover-rank`**, which only the cron clears.
   `LIBRARY_TAG` is not cleared hourly. Signed-in reads are live.
5. **A day with no row ranks after every scored day**, by `adds desc, created_at desc`. Discover
   works on an empty table.
6. **`top` is Discover's default** for Everyone, and the order of place, tag and length pages and
   of the assistant's library read. The public API and MCP gain `sort=top` additively; their
   default stays `most-added`.

## Consequences

- Keyset paging over `top` is stable between recomputes; a day can be seen twice only across the
  hourly boundary.
- Gaming is bounded by the ledgers' existing rules (no own adds or reviews, one review per
  person, distinct adders, hidden reviews and moderated days excluded). Nothing more is built
  until the operator *Discover rank* tab shows a need.
- Tuning is judged on production data in the operator tab, not guessed.

## Rejected

- **Gravity on the day's own age** (`/(age+2)^1.8`): on a library of ~180 days with a few adds a
  week it collapses into *newest*.
- **Every 15 minutes**: interest decays over weeks; an hour's staleness is invisible and fewer
  cache busts keep the signed-out page warm.
- **Redis for the score**: Postgres holds it next to the rows it filters, and the page cache is
  already paid for.
- **Clearing `LIBRARY_TAG` hourly**: it would throw away every place, tag and day page the score
  does not change.
