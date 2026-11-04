# ADR-087: Length pages are Discover's length bands over the place lattice

**Status:** **Proposed — 2026-11-04.** Accepted when Mitchell merges the PR that adds them.
**Deciders:** Mitchell (product); Claude — drafted
Related: M23 (Discover's length filter, `LengthBand` in `apps/web/src/lib/playbooks.ts`), M42 D10
(the tag lattice and `MIN_INDEXED_PLACE_DAYS`), M53 (search reads every public page), ADR-063 (the
public library is cached for a day), ADR-077 (the cached copy).

## Context

The public library's SEO pages are a lattice of places (city, country, country×city) and tags
(global, city, country, country×city), each `noindex, follow` below three published days and listed
in the sitemap from three up. Mitchell asked, 2026-11-04, for pages that group Playbooks by trip
length with a place, to rank for searches shaped like "weekend trips in the Bay Area" or "2 weeks in
Asia". He then set the bands: *"use the filter on the playbook page as guidance"*, not new ones like
weekend or multi-week.

## Decision

1. **The bands are Discover's, unchanged: 1 / 2-3 / 4-6 / 7+ days** (`LengthBand`, confirmed with
   Mitchell 2026-09-19). One table (`LENGTH_BAND_RANGE`) decides a band for the filter, the count and
   the page, so a length page and the filter it mirrors cannot disagree.
2. **They cross the places, not the tags.** A length page exists at the four scopes the tag lattice
   has: the whole library, a city, a country, and a city inside its country. Length × tag is not
   generated: it multiplies the page count by about a dozen for searches nobody has asked to rank.
3. **URLs take their own literal `/length/` segment**, as `tagPath` asks of every dimension after
   tag: `/playbooks/length/<band>`, `/playbooks/city/<slug>/length/<band>`,
   `/playbooks/country/<slug>/length/<band>`, `/playbooks/country/<slug>/city/<city>/length/<band>`.
   The band segment reads as the filter does: `1-day`, `2-3-days`, `4-6-days`, `7-plus-days`
   (`LENGTH_PAGE_SLUG`). The `?length=` keys (`one`, `two-three`) are not accepted as segments, so
   each page has one URL. A URL has no redirect behind it: a band that gains a neighbour keeps its
   slug, and a new band takes a new one.
4. **The same threshold.** `placeIndexable` over the page's own count: below three days a length
   page opens and is `noindex, follow`, and the sitemap leaves it out.
5. **A day's band is its stored `day_count`**, the column `lengthPredicate` filters on, not the floor
   `parseSavedDayColumns` repairs it up to. The count and the listing then agree about every day,
   including one whose stops run past its stored count.
6. **Place pages link down to their bands** in the lattice nav, so a crawler reaches a length page
   without the sitemap. They share the twelve-link cap with the tags and country×city links.

## Consequences

- Production on 2026-11-04 (read through the Caesura connector; countries inferred from city names):
  148 one-day, 38 two-to-three-day, 11 four-to-six-day and no seven-plus Playbooks. So the three
  global pages with days, about 22 country one-day pages, Italy's 2-3 day page and four city one-day
  pages (Paris, Reykjavík, San Francisco, London) would be indexed on merge. The rest open as
  `noindex` until the library fills them.
- Regions wider than a country ("Asia", "the Bay Area") are not a dimension the data has: cities are
  free text and countries are ISO codes. A region page needs its own decision on where the regions
  come from, and would take its own literal segment beside `/length/`.
