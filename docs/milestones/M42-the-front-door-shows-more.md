# M42 — The front door shows more than one trip, and what it costs

**Status:** **Scoped 2026-10-11 with Mitchell**: every decision below is answered. Proposed
2026-10-06 and minted from `docs/candidates.md` (see `docs/milestones/README.md`,
*2026-10-06 — proposed: M37 to M47*). On 2026-10-11 Mitchell widened it with **richer activity
tags** (D5–D11), because they feed the same front door: tag pages for search, and a description
that says what kind of trip each demo is. Build plan: `docs/plans/2026-10-11-M42-front-door-and-tags.md`.
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
   unchanged. Each trip in the picker shows its description (D8).
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
   screens and SPEC §29. Both in part 7.
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
   count name the trip ("Outdoorsy", "Beach & outdoors", "Food & drink"); none means *"A bit of
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

- [ ] **Decisions 1–11 are answered and recorded here.**
- [ ] **Every trip in `content/trips/` opens at `/demo/<slug>`**, and a test enumerates the
      bundles, so a new bundle cannot be left out.
- [ ] **The landing page shows the three plans and their prices, read from `planVersions.ts`**. A
      test fails if a price string is hard-coded in the landing component.
- [ ] **Discover paginates**, and the sitemap still lists every published day.
- [ ] **The contract has the thirteen tags of D5, and every tag has a label, a colour and a picker
      group**, enforced by the type system or a test that enumerates `ActivityTag.options`.
      `API_VERSION` is bumped minor and `docs/contracts/CHANGELOG.md` records the addition.
- [ ] **Bundled content is re-tagged**: every category tag appears in at least one bundle, and the
      Japan fixture still exercises every tag.
- [ ] **The description rule of D8 has unit tests at each threshold**, and the description shows
      on the demo picker, home trip cards, public day pages, Discover cards and the invite page.
- [ ] **Tag and city×tag pages render, and are indexed and in the sitemap only at 3 or more
      days**; Discover filters by tag.
- [ ] **The four widgets of D11 are in the widget catalogue**, and none counts Ticketed.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: signed out, open each demo
      trip, follow `#pricing`, and open a tag page.
- [ ] **[walk]** The PR preview is walked signed out at desktop and phone widths, and the tag
      picker and widgets signed in.
- [ ] A retro is appended at gate close.
