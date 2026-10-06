# M42 — The front door shows more than one trip, and what it costs

**Status:** **Proposed 2026-10-06, placed after M41. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

## Why this exists

A signed-out visitor sees one demo trip (Japan) and no prices. `content/trips/` holds four more
trips (Dolomites, Iceland, Northern Spain, Thailand) that nothing public shows. Pricing was parked
on 2026-09-02 because no milestone could name a price. M21 closed on 2026-09-19 with prices set,
so that block is gone. The SEO pass shipped as #295–#299, and it left a short list behind. All of
this is what a stranger meets before signing up, and all of it is small. That matters more once
the goal is getting users.

Candidates absorbed (each deleted by this gate):
- *More than one demo trip: a picker on the front door and `/demo/<slug>`* (2026-09-27)
- *Pricing on the landing page* (2026-09-02; the requirement lives in M21's *An unowned surface*)
- *An SEO pass over the public library*: only the leftovers spec §7 deferred. That means
  paginating Discover, public pages for the sample trips, and whether profile and board pages
  are indexed.

## Decisions it needs (recommendations; none answered)

1. **Where the picker lives.** Mitchell kept it off the home page to keep that page simple.
   *Recommended:* on `/demo` itself, with `/demo/<slug>` per trip, and the landing page's CTA
   unchanged.
2. **One landing snapshot per trip**, from the generator in
   `docs/specs/2026-09-27-link-previews-and-real-hero-design.md` §3.2. `server/demoTrip.ts` then
   folds any bundle, not only the Japan fixture.
3. **Pricing reuses `PlanComparison`** from `/plans` (#177), as a section on `LandingScreen.tsx`
   with a `#pricing` anchor. The landing page gets no separate copy.
4. **Profiles and the board are not indexed.** *Recommended:* add `noindex` to both. Day, city and
   country pages carry the index.

## Scope

- `/demo/<slug>` for each bundled trip, and a picker on `/demo`.
- The pricing section on the landing page.
- Discover pagination, sample-trip public pages, and `noindex` where decision 4 lands.

## Out of scope

- Mitchell's dashboard tasks: the firewall bypass for crawlers and submitting the sitemap.

## Exit gate

- [ ] **Decisions 1–4 are answered and recorded here.**
- [ ] **Every trip in `content/trips/` opens at `/demo/<slug>`**, and a test enumerates the
      bundles, so a new bundle cannot be left out.
- [ ] **The landing page shows the three plans and their prices, read from `planVersions.ts`**. A
      test fails if a price string is hard-coded in the landing component.
- [ ] **Discover paginates**, and the sitemap still lists every published day.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: signed out, open each demo
      trip and follow `#pricing`.
- [ ] **[walk]** The PR preview is walked signed out at desktop and phone widths.
- [ ] A retro is appended at gate close.
