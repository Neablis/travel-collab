# M42 — The front door shows more than one trip, and what it costs

**Status:** **Closed 2026-10-12 — gate 14 of 14.** Built 2026-10-11 as #405–#413, part 0 #404.
**Scoped 2026-10-11 with Mitchell**: every decision below is answered. Proposed
2026-10-06 and minted from `docs/candidates.md` (see `docs/milestones/README.md`,
*2026-10-06 — proposed: M37 to M47*). On 2026-10-11 Mitchell widened it with **richer activity
tags** (D5–D11), because they feed the same front door: tag pages for search, and a description
that says what kind of trip each demo is. Build plan: `docs/plans/2026-10-11-M42-front-door-and-tags.md` (deleted at close; in git history).
Decision record for the tags: **ADR-070**.

## Why this exists

A signed-out visitor sees one demo trip (Japan) and no prices. `content/trips/` holds four more
trips (Dolomites, Iceland, Northern Spain, Thailand) that nothing public shows. Pricing was parked
on 2026-09-02 because no milestone could name a price. M21 closed on 2026-09-19 with prices set,
so that block is gone. The SEO pass shipped as #295–#299, and it left a short list behind. All of
this is what a stranger meets before signing up, and all of it is small. That matters more once
the goal is getting users.

**The tags (added 2026-10-11).** A stop's tags say what it *is* (ADR-054), but there are four —
meal, lodging, ticketed, outdoors — and they cannot tell a nightlife weekend from a museum week.
Ticketed is not even a kind of activity: it is a modifier that a museum has and a market does not.
With a vocabulary that describes activities, the app can say what a trip is like ("an outdoorsy
trip"), search engines get pages like *nightlife in Tokyo*, and notebooks can chart the mix.

Candidates absorbed (each deleted by this gate):
- *More than one demo trip: a picker on the front door and `/demo/<slug>`* (2026-09-27)
- *Pricing on the landing page* (2026-09-02; the requirement lives in M21's *An unowned surface*)
- *An SEO pass over the public library*: only the leftovers spec §7 deferred. That means
  paginating Discover, public pages for the sample trips, and whether profile and board pages
  are indexed.

## Decisions (answered by Mitchell, 2026-10-11)

### The front door

1. **The picker lives on `/demo`**, with `/demo/<slug>` per trip. The landing page's CTA is
   unchanged. Each trip in the picker shows its description (D8). *Added 2026-10-11 (part 6):* a
   demo trip opens on **Plan**, not Overview, on desktop and phone; an explicit `?view=` still
   wins, and old `/demo?view=…` links redirect to `/demo/japan` with their view.
2. **One landing snapshot per trip**, from the generator in
   `docs/specs/2026-09-27-link-previews-and-real-hero-design.md` §3.2, which exists today as
   `apps/web/scripts/landing-demo.ts` for Japan only. `server/demoTrip.ts` folds any bundle, not
   only the Japan fixture, through `bundleTripCommandGroups` (`@tc/fixtures`).
3. **Pricing reuses `PlanComparison`** from `/plans` (#177), as a section on `LandingScreen.tsx`
   with a `#pricing` anchor. The landing page gets no separate copy. `planVersions.ts` is
   server-only, so the landing reads a **generated, checked snapshot** of it, the way it reads the
   demo (`landing:verify`).
   *From Mitchell's walk of part 7's preview (2026-10-11):* on phones the plans stack one card
   per plan (on `/plans` too); the phone section adds no "Sign up" of its own; the phone's sticky
   header turns solid once past the pinned map. And **"How you'll remember it" shows a notebook
   memory, not money**, on phone and desktop ("it should be more nostalgic than how much you spent
   on dinner"): the Day 6 cost card and table give way to a short journal entry, and SPEC §14 is
   amended to match.
   **D3 is overridden for the landing:** it shows three compact plan cards (name, price, one line
   each: Free — unlimited planned trips; Plus — AI tools to help plan; Premium — invite all your
   friends), with a link to `/plans` for the comparison. `/plans` keeps `PlanComparison` ("the
   specifics are for the payment page, tracking your tier, or comparing"). **Leaving a playbook
   review (stars and a note) needs Plus or Premium** ("the cost keeps spammers out"); reading stays
   open, Free accounts' existing reviews stay, and no paying account loses anything. Trip "votes
   and comments" never existed, so that claim leaves `/plans`, the account sheet, the invite
   screens and SPEC §29 (part 7). The review gate is **part 8**: existing paid versions gain the
   new `playbook.review` entitlement in place, under **ADR-071**, so no current subscriber loses
   reviewing. The landing art's trip replies and reactions, which don't exist, are redrawn around
   suggestions and playbook stars, and its live-presence pills ("4 here now", "Sam typing…"), which
   don't exist either, become true past-tense actions ("Priya moved stop 3") (part 7).
   **The landing shows the real app (part 9).** Mitchell's earlier suggestion, only half done by the
   2026-09-27 real-hero spec (Timeline and Notebook hero views): the feature blocks and the phone
   claims render the app's own components from the generated snapshot — the real river for
   Together, a real Discover card (with its tags and description) for Playbooks, real notebook
   blocks for Notebook; Countdown stays art unless its refactor is cheap. The hero's Map view stays
   a drawing. Part 7's corrected art merges first; part 9 replaces it.
   *Part 9 (2026-10-11):* the Playbooks block keeps its line and shows a bundled day as a real
   card (Mitchell: "present the day as real"); the landing river carries no prices, even for
   screen readers; Countdown stays art.
4. **Profiles and the board are not indexed.** *Already true when M42 was scoped*: the SEO pass
   (merge #344) set `NOINDEX_FOLLOW` on `/playbooks/board` and `/playbooks/profile/[userId]`, and
   `sitemap.ts` leaves both out. Recorded; no work.

### The tags (ADR-070)

5. **Twelve categories and one modifier.** *What it is*: Food, Drinks, Nightlife, Museum, Sight,
   Outdoors, Beach, Shopping, Show, Tour, Wellness, Lodging. *Needs*: Ticketed. Existing keys keep
   their names (`meal` is labelled *Food*); the nine new keys are appended to the enum after the
   existing four, so spend charts' first-tag rule moves no existing stop. Adding values is an
   additive public API change (minor bump).
6. **Ticketed is a modifier, not a category.** It stays a tag (no breaking change), sits in its own
   *Needs* group in the picker, and is left out of descriptions, tag pages and every tag chart.
7. **Only bundled content is re-tagged**: the four trips, the nineteen playbooks, the starter days
   and the Japan fixture, once, offline, reviewed as a JSON diff. Users' trips are untouched; they
   and the assistant tag new stops.
8. **A description is worked out from the share of stops, at read time, never stored.** Lodging
   and Ticketed are ignored. Food counts when at least half the tagged stops are Food; any other
   category counts when it is on at least a quarter of the stops that carry one. The top two that
   count name the trip ("Outdoorsy", "Beach & outdoors", "Food & drinks"); none means *"A bit of
   everything"*; too few tagged stops means no description. The same rule describes a day.
9. **Descriptions show on** the demo picker, home trip cards, public day pages and Discover cards
   (with the day's tags linking to tag pages), and the invite page.
10. **Tag pages are `/playbooks/tag/<tag>` and `/playbooks/city/<slug>/<tag>`**, plus a tag filter
    on Discover. A day belongs to a tag when that tag is in its description (D8). A tag page is
    indexed and in the sitemap only with at least 3 days, the rule city pages already follow
    (`MIN_INDEXED_PLACE_DAYS`).
11. **Four notebook widgets**: *Activities by tag* (count, pie or bar), *Trip description* (the
    description and its top tags with shares), *Tags by day* (a stacked bar per day), and *Hours
    by tag* (untimed stops left out). Ticketed is left out of all four.
    *Walk, 2026-10-11:* the *Trip description* chips stay ordered by stop count (as on day pages
    and Discover cards), not with the described tags first; and Discover's tag filter stays inside
    the Filters panel (part 5), with no separate row of one-tap tag chips.
    *Walk of part 4:* the breakdown chart takes most of the block with a compact key, and a
    chart-only variant ("Chart of activities by tag") shows its numbers on hover and to screen
    readers; a keyboard user who wants them picks the variant with the key (Mitchell, 2026-10-11).

## Scope

- `/demo/<slug>` for each bundled trip, and a picker on `/demo`.
- The pricing section on the landing page.
- Discover pagination, sample-trip public pages (the demo trips), and the indexing record (D4).
- The tag vocabulary and grouped picker; bundled content re-tagged; descriptions on four surfaces;
  tag and city×tag pages with a Discover filter; four widgets.

## Out of scope

- Mitchell's dashboard tasks: the firewall bypass for crawlers and submitting the sitemap.
- Re-tagging users' existing trips, or an assistant action that suggests tags for them (D7).
- Country×tag pages, and user-defined (free-text) tags.

## Exit gate

CI for every box below: the last part to merge, PR 413, was green on its head `97c4d9e` (run
[38184850349](https://github.com/Neablis/travel-collab/actions/runs/38184850349), attempt 2: lint,
typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok`). That head already contains the
merges of every other part (PR 406, 408, 409, 410, 412, 411, 405, 407), so the run covers all of
M42's code. Line numbers are on `main` at `7a52e22`.

- [x] **Decisions 1–11 are answered and recorded here.** *Ticked 2026-10-12: answered by Mitchell
      2026-10-11 and recorded under* Decisions *above, with the walk amendments to D1, D3 and D11;
      the tag rules in ADR-070, the review gate in ADR-071; scoped in `36a53d3` on PR 404.*
- [x] **Every trip in `content/trips/` opens at `/demo/<slug>`**, and a test enumerates the
      bundles, so a new bundle cannot be left out. *Ticked 2026-10-12: PR 411 (`9dbfed2`);
      `apps/web/src/server/demoTrip.test.ts:178-184` reads `content/trips/` with `readdirSync`
      ("has a slug for every trip in content/trips/, and none for a trip that is not there");
      the route is `apps/web/src/app/(front)/demo/[slug]/page.tsx`; `e2e/m42-demo-trips.spec.ts:48`
      opens each slug signed out.*
- [x] **The landing page shows the three plans and their prices, read from `planVersions.ts`**. A
      test fails if a price string is hard-coded in the landing component. *Ticked 2026-10-12:
      PR 405 (`00b98ca`), shown as three plan cards per D3's override.
      `apps/web/scripts/landing-plans.test.ts:11` holds `landingPlans.generated.json` to what the
      generator makes from `planVersions.ts` (`landing:plans:verify`);
      `apps/web/src/components/front/LandingScreen.pricing.test.tsx:49` swaps the snapshot's prices
      for ones nobody would type and fails, in both the desktop and phone trees, on any other
      price-shaped string or any live price; `LandingScreen.test.tsx:130` asserts the three cards
      at `#pricing`; `e2e/m42-demo-trips.spec.ts:79`.*
- [x] **Discover paginates**, and the sitemap still lists every published day. *Ticked 2026-10-12:
      PR 412 (`625568c`); `apps/web/src/components/playbooks/DiscoverScreen.test.tsx:523` ("links
      to the next page of the same search, and back to the first");
      `apps/web/src/server/playbooks.tags.int.test.ts:105`, `:146`, `:163`, `:175` (cursor pages,
      page edges, stale cursor, past the candidate window); `apps/web/src/app/sitemap.ts:34-37`
      maps every row of `sitemapDays()`, uncapped, and `playbooks.sitemap.int.test.ts:35` lists a
      published day; `e2e/m42-tag-pages.spec.ts:52` follows Discover's next page.*
- [x] **The contract has the thirteen tags of D5, and every tag has a label, a colour and a picker
      group**, enforced by the type system or a test that enumerates `ActivityTag.options`.
      `API_VERSION` is bumped minor and `docs/contracts/CHANGELOG.md` records the addition.
      *Ticked 2026-10-12: PR 406 (`f9daf94`); `packages/contracts/src/activity.ts:243-246`;
      `packages/contracts/test/m18-kind-tags.test.ts:21`; `apps/web/src/lib/activityTags.test.ts:19`
      (`it.each(ActivityTag.options)`: a label, a chip colour and exactly one picker group);
      `API_VERSION` 1.12.0 → 1.13.0 in PR 406 (later parts took it to 1.15.0,
      `apps/web/src/server/public-api/openapi.ts:43`); `docs/contracts/CHANGELOG.md:92`.*
- [x] **Bundled content is re-tagged**: every category tag appears in at least one bundle, and the
      Japan fixture still exercises every tag. *Ticked 2026-10-12: PR 408 (`1543e98`);
      `packages/fixtures/src/bundle/content.test.ts:156` ("uses every category tag somewhere");
      `packages/fixtures/src/japan/verify.test.ts:100-112` and `expectations.ts:249-250` (every
      `ActivityTag` on a Japan stop, re-tagged in PR 406).*
- [x] **The description rule of D8 has unit tests at each threshold**, and the description shows
      on the demo picker, home trip cards, public day pages, Discover cards and the invite page.
      *Ticked 2026-10-12: PR 409 (`feb12b6`); `packages/domain/test/tagDescription.test.ts:43`
      (minimum count), `:56` (Food at 50%, not 49%), `:64` (others at 25%, not 24%), `:78` (two
      stops), `:92` (ties), `:99` and `:114` (Lodging, Ticketed, transit). Surfaces:
      `server/demoTrip.test.ts:221` and `e2e/m42-demo-trips.spec.ts:29` (picker),
      `components/home/TripCard.test.tsx:293`, `components/playbooks/SharedDayScreen.test.tsx:1537`,
      `components/playbooks/DiscoverCard.test.tsx:224`,
      `components/access/InviteLandingScreen.test.tsx:128`.*
- [x] **Tag and city×tag pages render, and are indexed and in the sitemap only at 3 or more
      days**; Discover filters by tag. *Ticked 2026-10-12: PR 412 (`625568c`);
      `apps/web/src/server/playbooks.tags.int.test.ts:73` (city×tag) and `:93` (library-wide, none
      for Ticketed or Lodging); `apps/web/src/app/sitemap.test.ts:47` (in the sitemap only from
      three days); `apps/web/src/server/tagPage.ts:83` sets `NOINDEX_FOLLOW` below
      `placeIndexable`, whose threshold is `playbookUrls.test.ts:138-139`; Discover's filter at
      `playbooks.tags.int.test.ts:105`; `e2e/m42-tag-pages.spec.ts:52` renders both pages and the
      filter signed out.*
- [x] **The four widgets of D11 are in the widget catalogue**, and none counts Ticketed. *Ticked
      2026-10-12: PR 410 (`ddd8e83`); `packages/pages/src/presets.ts:495`, `:523`, `:535`, `:546`;
      `apps/web/src/server/tagWidgets.test.ts:59` finds all four in `presetCatalog()` and renders
      every preset on their primitives identically with Ticketed on every stop or none.*
- [x] **Leaving a playbook review needs Plus or Premium** (an integration test: Free gets refused,
      Plus and an existing plus@v1 holder succeed); reading stays open (ADR-071). *Ticked
      2026-10-12: PR 407 (`ca8d450`);
      `apps/web/src/app/api/saved-days/[savedDayId]/reviews/route.int.test.ts:303` — `:310` (Free
      402s, writes nothing), `:322` (plus@v1), `:328` (operator-granted Plus), `:336` (premium@v1
      and @v2), `:347` (a Free account's review still shows and can be withdrawn); reading signed
      out at `:155-160`.*
- [x] **The landing's feature blocks and phone claims render real app components** from the
      generated snapshot (Countdown excepted if it stays art), and the snapshot check covers them.
      *Ticked 2026-10-12: PR 413 (`7a52e22`); Countdown stays art (D3, part 9);
      `apps/web/src/components/front/LandingFeatureBlocks.test.tsx:46` (real river, Discover card
      and notebook page in place of the drawings), `PhoneFrontDoor.test.tsx:338`;
      `apps/web/scripts/landing-demo.test.ts:58` holds `landingFeatures.generated.json` to the
      generator, which `landing:verify` (`landing-demo.ts --check`) also checks;
      `e2e/m42-demo-trips.spec.ts:93`.*
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: signed out, open each demo
      trip, follow `#pricing`, and open a tag page. *Ticked 2026-10-12: two specs —
      `apps/web/e2e/m42-demo-trips.spec.ts` (each demo, `#pricing`, the real landing) and
      `apps/web/e2e/m42-tag-pages.spec.ts` (a tag page, a city×tag page, Discover's filter and next
      page). Both ran green in CI run 38184850349 attempt 2 on PR 413's head `97c4d9e` (attempt 1:
      an e2e shard could not pull the postgres image, ECR `toomanyrequests`). ci-like locally, per
      the PR bodies: m42-demo-trips 12 passed (PR 413), m42-tag-pages passed with no retries
      (PR 412).*
- [x] **[walk]** The PR preview is walked signed out at desktop and phone widths, and the tag
      picker and widgets signed in. *Ticked 2026-10-12 on Mitchell's word: "Walked and looked good",
      after every part had merged to `main`.*
- [x] A retro is appended at gate close. *Ticked 2026-10-12: below.*

## Retro — written 2026-10-12, before the walk (13 of 14 boxes ticked; the open one is Mitchell's walk)

**What shipped.** Part 0 (PR 404) and nine parts, all opened, reviewed and merged in one day
(2026-10-11, the last at 00:44 UTC on the 12th), in this order: part 1, thirteen tags, the
grouped picker, Japan re-tagged, API 1.13.0 (PR 406); part 7, `#pricing` from a generated plan
snapshot plus Mitchell's first walk (PR 405); part 2, the bundles re-tagged (PR 408); part 8,
reviews need Plus or Premium under ADR-071 (PR 407); part 3, the description rule and its five
surfaces (PR 409); part 6, `/demo/<slug>`, the picker and a snapshot per trip (PR 411); part 5,
tag pages, Discover's filter and pages (PR 412); part 4, four tag widgets (PR 410); part 9, the
landing renders the real app (PR 413). No migrations. 267 files, about 12,200 lines added.

**What held.**
- **Parallel parts against `main`.** Three waves, each part merging when ready, with no stack to
  rebase. The nine parts merged between 17:00 UTC on the 11th and 00:44 UTC on the 12th.
- **Generated snapshots kept the front door honest.** Plans, demo cards, per-trip landing data and
  the feature blocks are all generated, checked files (`landing:verify`, `landing:plans:verify`),
  so the landing imports nothing from the server and no price is typed by hand
  (`LandingScreen.pricing.test.tsx` plants prices nobody would type).
- **Red-first caught vacuous checks.** PR 413 dropped an e2e check on requests to
  `api.unsplash.com` that stayed green with the fetch planted, because the CSP refused it before
  Playwright saw it. It asserts the cover's `src` instead.
- **The Hanoi playbook** for the landing's Playbooks card was read once from the public API, with
  Mitchell's approval, and committed trimmed (`apps/web/scripts/landing-day.json`: stops without
  prices, the cover, the author's public name). Nothing at build or run time reaches production.
- **Part 6 folds the bundle files, not the imported trips.** The importer is create-if-absent, so
  production's copies keep their pre-M42 tags. The plan recorded this rather than widening the
  importer.

**What did not.**
- **The scope grew twice mid-build.** Mitchell widened M42 with tags (D5–D11) at scoping, and his
  walk of part 7's preview added parts 8 and 9. He also overrode D3: three compact plan cards,
  not `PlanComparison`. Each was the right call, and the plan, the decisions and ADR-071 were
  written before any code. Part 7 still paid for a second build, and part 9 replaced art that
  part 7 had only just corrected.
- **We misread Mitchell on card width.** "Cap the cards" was first built as capping the panels
  inside them (`ee8aa70`) and then corrected to cap the whole feature cards (`97c4d9e`). Lesson:
  repeat a layout instruction back as the element it names before building it.
- **Infra failures cost a re-run each.** Google Fonts not answering a production build
  (KI-20260927-a), and an e2e shard that could not pull the postgres image (ECR
  `toomanyrequests`, PR 413's run 38184850349, green on attempt 2). The ECR limit has no
  known-issue entry yet; it should get one if it happens again.
- **A usage limit killed agents mid-run.** They were resumed from their branches and PR bodies,
  and nothing was lost because each part pushed its work as it went.
- **Leftovers crossed parts.** PR 410 (part 4) carried a part 5 follow-up (`8fe07e5`: a hidden
  public day names no tag, and Discover's results list is named) because it merged after PR 412.
  That is harmless, but the tracker has to say so, or the follow-up looks lost.
- **ADR-070 changed during the build.** A non-Food category needs at least two stops
  (`ea8d9bb`), and a trip's description counts its backlog (`80e731d`). Both came from review of
  part 3 and reached the domain function before parts 4 to 6 read it.

**Process changes.**
- `review-a-part` now posts every review, and what became of each finding, as a PR comment
  (`b935edc`, Mitchell), so the record is on the PR and not only in the session.
- Filed: KI-20261011-a (the quota property's rolled floor can trip on a low draw),
  KI-20261011-b (signed-out `/plans` cannot load the catalogue) and KI-20261011-c
  (`suggestions.test` fails once under a full local web unit run). KI-052 is resolved by part 1.

**Cost.** The session cost $334, about twice M41 for the same amount of code. Where the tokens
went, and the process fixes for M43, are in `docs/retros/2026-10-12-m42-token-spend-retro.md`.
