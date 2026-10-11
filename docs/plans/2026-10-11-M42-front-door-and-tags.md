# M42 — the front door and richer tags: build plan

Gate: `docs/milestones/M42-the-front-door-shows-more.md` § *Exit gate*. Decisions are numbered
there and cited here as D1–D11; the tag rules are ADR-070. Delete this file at M42's gate close
(`docs/plans/README.md`).

## The parts

Every part targets `main` and merges on its own when ready (`building-a-milestone.md`). A part
that needs another waits for it to merge, then branches from `main`. Part 0 is this branch
(`claude/dreamy-ritchie-kfnsa2`), prose only, a draft until the gate, and merges last.

| Part | Branch | Theme | Needs merged first |
|---|---|---|---|
| 1 | `claude/m42-part1-tag-vocabulary` | thirteen tags in the contract, labels, colours, the grouped picker, Japan re-tagged, API minor | — |
| 2 | `claude/m42-part2-retag-content` | the four trips, nineteen playbooks and starter days re-tagged | 1 |
| 3 | `claude/m42-part3-descriptions` | the description rule in `@tc/domain`; shown on home cards, invite page, day pages, Discover cards | 1 |
| 4 | `claude/m42-part4-tag-widgets` | four notebook widgets (D11) | 1, 3 |
| 5 | `claude/m42-part5-tag-pages` | tag and city×tag pages, the Discover tag filter and pagination, the sitemap | 2, 3 |
| 6 | `claude/m42-part6-demo-per-trip` | `/demo/<slug>`, the picker with descriptions, one landing snapshot per trip | 3 (and 2, so descriptions read right) |
| 7 | `claude/m42-part7-landing-pricing` | the `#pricing` section from a generated plan snapshot; Mitchell's walk: plan cards, notebook memory, solid phone header, no false votes/comments copy, landing art redrawn | — |
| 8 | `claude/m42-part8-paid-reviews` | leaving a playbook review needs Plus or Premium (`playbook.review`, ADR-071) | — |
| 9 | `claude/m42-part9-real-landing` | the landing's feature blocks and phone claims render real app components from the snapshot | 6, 7 (and 3, for descriptions on the Discover card) |

**Order.** Wave 1: parts 1 and 7 in parallel. Wave 2 (after 1 merges): parts 2 and 3 in
parallel. Wave 3: parts 4, 5 and 6 in parallel.

**The e2e spec** for the gate (signed out: each demo trip, `#pricing`, a tag page) is written by
the last of parts 5 and 6 to be built, extending whatever the other added.

**On the preview, what does a person click to see this?**
- Part 1: open any trip, open a stop's editor: the tag picker has two groups, *What it is* and
  *Needs*. Pick Nightlife and Ticketed; the chips show on the stop's card in the river and
  calendar. A notebook's *Spend by tag* chart has the new series.
- Part 2: nothing new to click. Open `/playbooks` and a few days: their stops show the new tags.
  The PR body carries the per-tag counts before and after.
- Part 3: home, signed in: each trip card says what kind of trip it is. An invite link: the
  invite page says it too. `/playbooks/day/<id>` and Discover cards: the day's description and
  tags.
- Part 4: open a notebook, add a widget: *Activities by tag*, *Trip description*, *Tags by day*,
  *Hours by tag*.
- Part 5: `/playbooks/tag/nightlife`, `/playbooks/city/<slug>/<tag>`; Discover's tag filter and
  its next page; `/sitemap.xml`.
- Part 6: signed out, `/demo`: a picker of five trips with descriptions; each opens at
  `/demo/<slug>`.
- Part 7: signed out, the landing page: scroll or follow `#pricing` to the three plans.

## What is true today

Surveyed 2026-10-11. Re-check line numbers before trusting them. The app is under `apps/web/src/`.

### Tags

- `ActivityTag = z.enum(["meal","lodging","ticketed","outdoors"])` at
  `packages/contracts/src/activity.ts:237`, closed on purpose (comment at :226-236). Multiple per
  stop (`AddActivity.tags` :400, `UpdateActivity.tags` replaces :444, `ActivityView.tags` :553).
  Kind is separate: `planned | pending | transit` (:191, ADR-054).
- **No column or migration.** Tags live in JSONB: `events.payload`, `trip_details.doc`,
  `saved_days.stops` (`server/db/schema.ts`). Events stay at version 1.
- Other copies of the enum: `SavedStop.tags` (`contracts/src/saved.ts:65`), `detail.ts:32`,
  `nearbyStops.ts:32`, `TripGlobalsTag` (`globals.ts:100-104`), `TagRef` (`pages.ts:42`).
- **Compile errors when the enum grows** (`Record<ActivityTag,…>`): `TAG_LABEL`
  (`packages/pages/src/enumLabels.ts:19`), `TAG_CHIP_CLASS` (`lib/activityTags.ts:23-28`),
  `SPEND_SERIES_COLOR` (`components/pages/blocks/spendColors.ts`), Japan
  `packages/fixtures/src/japan/expectations.ts:19`.
- **Silent lists that will not fail to compile**: `TAG_ORDER` (`lib/activityTags.ts:11`, the
  picker order), the spend-by-tag preset's keywords and description
  (`packages/pages/src/presets.ts:474-484`), `TOPIC_TAGS` regexes (`server/ai/simulatedModel.ts:819-824`),
  the four-tag assertion (`packages/contracts/test/m18-kind-tags.test.ts:19-26`).
- **The Japan fixture must exercise every tag** (`expectations.ts:246-247`, `verify.ts:226`), so
  part 1 re-tags Japan, not part 2.
- **Spend series** are `[...ActivityTag.options, "untagged"]`, a multi-tag stop under its first
  tag in contract order (`packages/pages/src/macros/primitives/spendSeries.ts:13-31`). D5 appends
  new keys; D6 drops Ticketed from the series (a Ticketed-only stop becomes untagged — say so in
  the CHANGELOG).
- **Equality is order-sensitive** (`packages/domain/src/trip/equality.ts:33`): `toggleTag` keeps
  contract order.
- Picker: `components/board/ActivityEditor.tsx:548-559`; chips `StopTagChips.tsx`; tag focus
  (M18b) through `FocusProvider` and `TagFocusLine.tsx`.
- Assistant: write tools pass contract schemas through (`server/assistant/tools/planning.ts:200`),
  `read_trip` counts per tag (`read.ts:282,418`), widgets hint from `ActivityTag.options`
  (`widgets.ts:63`).
- Public API: enum in `app/api/v1/openapi.json`; `API_VERSION = "1.12.0"` and the fingerprint
  test (`server/public-api/openapi.ts:36-43`). Adding values is minor.
- Bundles import `ActivityTag` (`packages/fixtures/src/bundle/schema.ts:71`). Tag counts today:
  trips 81 meal, 49 outdoors, 14 ticketed, 13 lodging, 62 untagged; playbooks 346 meal,
  330 outdoors, 245 ticketed, 15 lodging, 80 untagged.
- The new-trip chips (Food, Art, Hiking, Nightlife, Markets…, `components/home/newTripScript.ts:242-256`)
  are conversation only; align their words with the tag labels where it costs nothing.
- `docs/features/stop-kind-and-tags.md` is stale (five kinds); KI-052 is superseded by ADR-070.

### Front door

- `/demo` is one route (`app/(front)/demo/page.tsx` → `components/demo/DemoTripScreen.tsx`).
  `lib/demoTrip.ts:19-27` holds one `DEMO_TRIP_ID` and `isDemoTripId` by equality.
- `server/demoTrip.ts` folds Japan only (imports at :11-16; `buildDemo` ~:133; one `memo` ~:108;
  a hard-coded 4-person roster ~:79). `bundleTripCommandGroups` (`packages/fixtures/src/bundle/toCommands.ts:111`)
  already turns any bundle into command groups. Bundles are read with `fs` in tests and scripts;
  a runtime route needs static imports or a generated index.
- The landing snapshot generator is `apps/web/scripts/landing-demo.ts` → `lib/landingDemo.generated.json`,
  `pnpm landing:verify`; Japan only, with `RIVER_DAY_INDEX=6`, `NOTEBOOK_DAY_INDEX=4`.
- `PlanComparison({ catalogue })` is `components/plans/PlanComparison.tsx:114`, used by
  `PlansScreen.tsx:631`. `server/entitlements/planVersions.ts` is server-only (`PLAN_VERSIONS`
  :175, `livePlanVersion`); the catalogue is built in `server/entitlements/accountPlan.ts:196`.
- `LandingScreen.tsx` (mounted at `(front)/welcome/page.tsx`): phone front door, header, hero,
  feature blocks, closing CTA, footer. No pricing, no `#pricing`.
- Discover: `(app)/playbooks/page.tsx` → `discoverFor` (`server/publicLibrary.ts:99`) →
  `discoverDays` (`server/playbooks.ts:633`): 200 candidates, filtered in app, sliced to
  `DISCOVER_PAGE_SIZE = 24` (`lib/playbooks.ts:271`). A keyset `discoverPage` exists
  (`server/playbooks.ts:765`), used only by `/api/v1/discover/playbooks`.
- Sitemap `app/sitemap.ts`: static paths, every day from `sitemapDays()`, places passing
  `placeIndexable` (`MIN_INDEXED_PLACE_DAYS`, `lib/playbookUrls.ts:62-69`). Place pages through
  `server/placePage.ts`. Profiles and board already `NOINDEX_FOLLOW` (D4).
- Description surfaces: `TripCard.tsx:80` gets a `TripSummary` (`contracts/src/trip.ts:409`)
  with no tags; `contracts/src/invitePreview.ts` is `.strict()`; day pages render `dayJsonLd`.

### Widgets

- Registry `packages/pages/src/registry.ts:40-76`. Charts: `cost.chart` (`spend-by-day`) and
  `cost.breakdown` (`spend-breakdown`, `by: "kind"|"tag"`, `chartPayloads.ts:79,99`). Web renderer
  chosen in `components/pages/BlockView.tsx:88`. A new chart: register in `DEFS`, add a payload
  `kind`, a `BlockView` branch, a preset row. `count` already filters by tag (`single.ts:161-164`).
  Presets are the catalogue, not stored (ADR-039).

## Per part

### Part 1 — the tag vocabulary

- Contract: append `drinks, nightlife, museum, sight, beach, shopping, show, tour, wellness` to
  `ActivityTag`. Export the modifier set (`["ticketed"]`) and the category list from the
  contract, so every consumer reads one definition.
- Labels (`meal` → *Food*), chip colours for twelve categories (design tokens only: the colour
  wall), the grouped picker (*What it is* / *Needs*), `TAG_ORDER`.
- Spend series: categories only, appended order; colours for each.
- Japan fixture re-tagged so every tag is exercised; the M18 contract test, the preset text and
  the simulated model's regexes updated.
- `API_VERSION` 1.13.0, regenerated `openapi.json`, `docs/contracts/CHANGELOG.md` entry.
- `docs/features/stop-kind-and-tags.md` rewritten; KI-052 moved to resolved.
- **A test** that enumerates `ActivityTag.options` and fails if a tag lacks a label, a colour or a
  picker group.

### Part 2 — re-tag bundled content

- Edit `content/trips/*.json`, `content/playbooks/*.json` and `packages/fixtures/src/library/starterDays.ts`
  by judgement from each stop's title and notes: no live model call.
- Follow `docs/guidelines/content-bundles.md` (ADR-041) for how a bundle change reaches
  production, and say in the PR body what Mitchell runs.
- **A test** that every category tag appears in at least one bundle.
- PR body: per-tag counts before and after, per bundle set.

### Part 3 — descriptions

- `describeByTags(stops)` in `@tc/domain`, per ADR-070 §3, with the adjective/noun copy table
  beside it. Unit tests at each threshold (49/50% Food, 24/25% others, the minimum count, ties,
  Ticketed-only and Lodging-only stops).
- `TripSummary` gains the description; home `TripCard` shows it. `invitePreview` gains it. Day
  pages and Discover cards show the day's description and tags, each tag linking to its tag page
  (the link may land before part 5's routes exist only if part 5 merges first; otherwise render
  plain text and let part 5 add the links).
- **Interaction model**: none; read-only text.

### Part 4 — tag widgets

- *Activities by tag* (count, pie or bar, the same toggle as spend), *Trip description*,
  *Tags by day* (stacked bar per day), *Hours by tag* (untimed stops left out). Ticketed never
  counted. Presets with keywords; chart colours from part 1's tokens.

### Part 5 — tag pages and Discover

- `/playbooks/tag/[tag]` and `/playbooks/city/[slug]/[tag]`; membership by ADR-070 §4; indexed
  and in the sitemap only at ≥ `MIN_INDEXED_PLACE_DAYS`; metadata and JSON-LD like place pages.
- Discover: a tag filter in `discoverUrl.ts` and the filter bar, and pagination on the existing
  keyset `discoverPage`. The sitemap still lists every published day.
- If filtering by description needs a materialised column on `saved_days`, it is a migration
  (number picked when the part is built), recomputed on every write and backfilled; the domain
  function stays the only rule.

### Part 6 — the demo, per trip

- A slug per bundle plus `japan`; `isDemoTripId` accepts the set; one memo per slug; a roster per
  bundle (generated if the bundle has none).
- `/demo` shows a picker (five cards with name, description, length); `/demo/<slug>` opens each.
  Canonicals and the sitemap list each.
- `landing-demo.ts` writes one snapshot per trip; `landing:verify` checks them all.
- **A test** that enumerates `content/trips/` so a new bundle cannot be left out.

### Part 7 — landing pricing

- A generator writes a client-safe snapshot of the live plan catalogue from `planVersions.ts`,
  with a `--check` mode in CI like `landing:verify`.
- `LandingScreen.tsx` gains a `#pricing` section rendering `PlanComparison` from the snapshot.
- **A test** that fails if a price string is hard-coded in the landing component.

### Part 8 — reviews need Plus or Premium (added 2026-10-11)

- New entitlement `playbook.review` in `packages/contracts/src/entitlement.ts` (CHANGELOG; typecheck
  every package; public API/openapi if entitlements are exposed).
- Added in place to plus@v1, premium@v1, premium@v2 per ADR-071, with `noExtension` updated to
  assert the change is an added entitlement citing ADR-071.
- `accountCan(…, "playbook.review")` on PUT in `app/api/saved-days/[savedDayId]/reviews/route.ts`
  (402, matching `ai-not-entitled`); DELETE of your own review stays open; GET stays open.
- `ReviewsSection` / `ReviewRail`: a signed-in Free account sees "Reviews are for Plus and Premium"
  with a link to plans; `/plans` gains a "Review playbooks" row.
- Integration tests, red first: Free 402, Plus 200, plus@v1 holder 200, own-review delete for Free.
- Walk (ADR-047, no money): a Free account is refused; an operator-granted Plus account reviews.

### Part 9 — the landing shows the real app (added 2026-10-11)

- Mitchell's suggestion, half done by `docs/specs/2026-09-27-link-previews-and-real-hero-design.md`
  (only the hero's Timeline and Notebook views are real, via `LandingHeroPanels`).
- Together → the real `DayRiver` (read-only) from the snapshot's river (lazy-loaded like the hero:
  `RiverBlock` pulls in drag-and-drop). Playbooks → a real `DiscoverCard` from a bundled playbook
  day, with its tags and description (part 3). Notebook → real notebook blocks with resolved
  payloads (a memory-style text block plus trip strip; no cost table). Countdown → stays art unless
  `NextTripHero` can take its data and "now" as props cheaply (it fetches and reads `new Date()`).
- Phone claims render the same components at phone size.
- All data from the generated snapshot (`landing-demo.ts`; part 6 makes it per trip): the landing
  imports nothing from `@/server` or `@tc/domain` (lint wall), loads nothing live (SPEC §14), and
  the static art stays as the loading/error placeholder. `landing:verify` covers the new payloads.
- The hero's Map view stays a drawing (Mitchell, 2026-10-11).
- The `unbuiltSocial` sweep keeps running over the real components.
- Carried from part 7's last review (minor, left there because this part rewrites the same
  surfaces): assert no "Accept" on the desktop Countdown and hero Notebook art; widen
  `test-support/unbuiltSocial.ts` to `is (reading|moving|dragging|viewing|editing|typing)|\bonline\b|\bviewing\b`
  with `\btyping\b`; fix the stale "presence pill" comments and `LandingScreen.test.tsx:178-179`.
