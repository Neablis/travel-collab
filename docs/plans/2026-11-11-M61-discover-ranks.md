# M61 plan — Discover ranks what's worth borrowing now

Milestone: `docs/milestones/M61-discover-ranks-what-is-worth-borrowing.md` (decisions 1–10, all
answered as recommended 2026-11-11). ADR: `docs/architecture/ADR-090-discover-ranks-by-a-stored-decayed-score.md`.
Part 0 is the prose-only tracking PR on `ccr-229c0104-j14ya5`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `44eac29`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

## Order

The parts are one stack (`docs/guidelines/stacked-prs.md`). Part 1 branches from `main` and its
draft PR targets `main`; part K+1 branches from part K's head and its draft PR targets part K's
branch. Every PR lands through the top part's PR (part 5), which is retargeted to `main` and
marked ready for the milestone's one CI run.

| Part | Branch | Base |
|---|---|---|
| 1 The score | `claude/m61-part1-the-score` | `main` |
| 2 The interval | `claude/m61-part2-the-interval` | part 1 |
| 3 Discover reads it | `claude/m61-part3-discover-reads-it` | part 2 |
| 4 API, MCP and the assistant | `claude/m61-part4-api-mcp-assistant` | part 3 |
| 5 The operator view | `claude/m61-part5-operator-view` | part 4 |

Shared files: `server/libraryCache.ts` gains `DISCOVER_RANK_TAG` in part 2 and is read by part 3.
`server/discoverRank.ts` is created in part 1 and extended (one-day recompute, read for the
console) by parts 2 and 5.

Facts the parts share (the survey, 2026-11-11):
- The next migration is **`0076`** (`apps/web/drizzle/0075_agent_sessions.sql` is the newest,
  idx 75 in `apps/web/drizzle/meta/_journal.json`). Part 1 takes `0076_saved_day_ranks`.
- ADR-089 is M60's; this milestone's is **ADR-090**.
- The score's formula, constants and semantics are the milestone file's decisions 1–4, verbatim.
  The constants live in one exported object in `server/discoverRank.ts`.
- Crons are Coolify scheduled tasks that `curl` a route guarded by `isCronRequestAuthorized`
  (`server/cronAuth.ts:19`); never an in-app timer (M59 decision 8). Precedent:
  `app/api/cron/embed-days/route.ts` and `app/api/cron/tier-rollup/route.ts` with `route.test.ts`.
- `matchPredicate` (`server/playbooks.ts:278`) is the one rule for which days are listed; the
  rank read joins through it, so leaving the library needs no rank write.

## Part 1 — The score (~8 files)

**Theme.** Decisions 1–4 and 6's table: the `saved_day_ranks` projection and one recompute
statement (all public days, or one id). No route, no reader, no cache.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | near `savedDayReviews` :1375 | **New** table `savedDayRanks` (`saved_day_id` pk → `saved_days`, `score`, `adds_recent`, `comments_recent`, `quality`, `new_day_lift`, `computed_at`) | — |
| `apps/web/drizzle/0076_saved_day_ranks.sql` | **New** | the migration, plus `meta/_journal.json` | — |
| `server/discoverRank.ts` | **New** `RANK_CONSTANTS`, `recomputeDiscoverRanks({ savedDayId? , now? })` | one `insert … select … on conflict do update`; distinct adders at their latest add; comment = visible review with non-empty note, from `updated_at`; Bayesian stars with `C=5` over the library mean, clamped 0.7–1.3, 1.0 unrated; new-day lift | `server/discoverRank.int.test.ts` (**new**), `server/discoverRank.test.ts` (**new**, constants/pure math if any) |

Gate boxes this part carries, each seen red by changing the constant or clause it protects:
*Each signal moves a day the right way* and *Stars can't carry a day alone*; the score half of
*New days are seen* (the 14-day crossover, clock moved via `now`).

**Preview walk:** nothing on screen. Verify with the integration tests.

## Part 2 — The interval (~10 files)

**Theme.** Decision 5 and 6's cache tag: the hourly route, the publish-time recompute, the
runbook row. Discover does not read the score yet.

| File | Entry point | Change | Test |
|---|---|---|---|
| `app/api/cron/discover-rank/route.ts` | **New** `GET`/`POST` as the other crons | `isCronRequestAuthorized` → 401; `recomputeDiscoverRanks()`; `revalidateTag(DISCOVER_RANK_TAG)` only | `app/api/cron/discover-rank/route.test.ts` (**new**) |
| `server/libraryCache.ts` | `LIBRARY_TAG` :30, invalidate helpers :87–120 | **New** `DISCOVER_RANK_TAG = "discover-rank"` | `server/libraryCache.test.ts` |
| `server/savedDays.ts` | `setSavedDayVisibility` :708 | on publish/re-publish, `recomputeDiscoverRanks({ savedDayId })` | `app/api/saved-days/[savedDayId]/publish/route.int.test.ts` |
| `docs/ops/coolify-vps.md` | *Crons* table :191 | third row: `/api/cron/discover-rank`, `17 * * * *`; "Two" → "Three" | — |

Gate box: the code half of *The interval* (401, every row rewritten, only the `discover-rank` tag
cleared). The Coolify task itself is an ops step for Mitchell at close.

**Preview walk:** `curl` the preview's `/api/cron/discover-rank` without the secret → 401.

## Part 3 — Discover reads it (~14 files)

**Theme.** Decision 7 on the web: the `top` sort, its default, the heading, place/tag/length
pages, and the signed-out cache under `discover-rank`. Not the API, MCP or assistant.

| File | Entry point | Change | Test |
|---|---|---|---|
| `lib/playbooks.ts` | `DiscoverSort` :30, the zod enum :31 | add `top` | `lib/playbooks.season.test.ts` |
| `server/playbooks.ts` | `orderBy` :358, `rankKeys` :669, `discoverDays` :546, `discoverPage` :703, `publishedDaysPage` :1302 | `left join saved_day_ranks`; `top` = `score desc nulls last, adds desc, created_at desc` in both maps; place/tag/length pages order by `top` | `server/public-api/discover.int.test.ts` (extend to `top`), `server/playbooks.places.int.test.ts`, `server/playbooks.tags.int.test.ts`, `server/playbooks.lattice.int.test.ts` |
| `server/publicLibrary.ts` | `discoverFor` :102 (cache at :108), `publishedDaysPage` :173 | the ranked page cached under `DISCOVER_RANK_TAG` | `server/publicLibrary.int.test.ts` |
| `components/playbooks/discoverUrl.ts` | `DISCOVER_URL_DEFAULTS` :97 | default `top` for Everyone; *Yours*/*Saved* keep `newest`; `?sort=most-added` survives | `components/playbooks/discoverUrl.test.ts` |
| `app/playbooks/live/(discover)/page.tsx` | `placeCanonical` :25 | canonical rule holds with the new default | (covered by `discoverUrl.test.ts`) |
| `components/playbooks/DiscoverScreen.tsx` | `SORTS` ~:56, `collectionTitle` :68 | *Top* in the menu; heading *"Worth borrowing right now"* | `components/playbooks/DiscoverScreen.test.tsx` |

Gate boxes: *No row, no failure*, *Left the library, left the list*, *Paging*, and the web half of
*Surfaces*.

**Preview walk:** open `/playbooks` signed out → *Top* selected, heading reads *Worth borrowing
right now*; switch to *Most added* → URL carries `?sort=most-added`; open a place page → listed
by top.

## Part 4 — API, MCP and the assistant (~12 files)

**Theme.** Decision 7 off the web: `sort=top`, additive; API default unchanged; assistant reads
`top`.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/public-api/discover.ts` | `sort` :43, default :77, `discoverPlaybooksDef` :57 | accept `top`; default stays `most-added` | `server/public-api/discover.int.test.ts`, `server/public-api/conformance.test.ts` |
| `server/public-api/openapi.ts` | the discover `sort` enum | add `top`; regenerate `app/api/v1/openapi.json` | `server/public-api/openapi.test.ts` |
| `app/api/mcp/tools.ts` | `list_discover_playbooks` :79 (schema may be in `server/mcp/schemas.ts`) | accept `top` | `server/mcp/conformance.test.ts`, `app/api/mcp/route.int.test.ts` |
| `server/ai/assistantPorts.ts` | `discoverDays` call :75–76 | `sort: "top"` | `server/ai/assistantPorts.test.ts`, `server/ai/assistantPorts.int.test.ts` |
| `server/assistant/tools/read.ts` | `searchPlaybooksTool` :1405 | description mentions the top order if it names a sort | `server/assistant/tools/read.test.ts` |
| `docs/contracts/CHANGELOG.md` | top | additive entry: `sort=top` | — |

Gate box: the API half of *Surfaces*.

**Preview walk:** `GET /api/v1/discover/playbooks?sort=top` with a token answers; without `sort`
the order is unchanged.

## Part 5 — The operator view (~8 files)

**Theme.** Decision 8: an operator-only *Discover rank* console tab — top 50, each component,
`computed_at`, the constants in force.

| File | Entry point | Change | Test |
|---|---|---|---|
| `components/admin/consoleTab.ts` | `CONSOLE_TABS` :8 | add `discover-rank` | `components/admin/consoleTab.test.ts` |
| `app/admin/page.tsx` | tab imports :15–18, `resolveConsoleTab` :103 | render the tab behind `adminUserId` (:101) | `app/admin/admin.console.test.ts` |
| `components/admin/ConsoleTabs.tsx` | tab list | label *Discover rank* | `components/admin/ConsoleTabs.test.tsx` |
| `components/admin/DiscoverRankTab.tsx` | **New** | table of top 50 with components and constants | `components/admin/DiscoverRankTab.test.tsx` (**new**) |
| `server/discoverRank.ts` | **New** `topDiscoverRanks(limit)` | the read for the tab | `server/discoverRank.int.test.ts` |

Precedent: `components/admin/PersonasTab.tsx` / `LibraryTab.tsx` and their tests.

**Preview walk:** as an operator, `/admin?tab=discover-rank` → a table of 50 days with score,
adds, comments, quality, lift, computed-at and the constants. As a non-operator → 404.

## Gate

The milestone file's exit gate. Integration and unit boxes are ticked from CI on the top part's
head once it is retargeted to `main` and green. Ops: Mitchell adds the Coolify scheduled task
(`17 * * * *`, `/api/cron/discover-rank`) after the top merges and `migrate-production` applies
`0076`. The *[walk]* is Mitchell's, on production, against the *Discover rank* tab.
