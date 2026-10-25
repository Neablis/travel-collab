# M53 — A search engine reads every public page the way a person does

**Status (2026-10-25): proposed, not scoped.** Minted by Mitchell the same day from an SEO audit
of production (*"Create a new milestone listing all these issues to fix as one big milestone"*).
Placed **last**, after M44, until Mitchell places it (see `docs/milestones/README.md`,
*2026-10-25 — minted: M53, the SEO audit's findings*). Every decision below is a recommendation;
none has been answered.

## Why this exists

The SEO pass (`docs/specs/2026-10-02-seo-pass-design.md`, PRs 295–299) and M42's leftovers built
the plumbing: robots, a dynamic sitemap, server-rendered days, canonicals, real 404s, place and
day JSON-LD. An audit of production on 2026-10-25 found that the plumbing holds, and that what is
left is in the content it carries and in one route family it never reached. The audit put the site
at about 82/100. That score is the auditor's own estimate from the HTML, and there was no
Lighthouse or Core Web Vitals run.

### What the audit measured (production, 2026-10-25)

Every URL in `https://caesura.today/sitemap.xml` was fetched: **282 URLs** (the 10 static paths,
181 days, 70 country, 13 city and 8 tag pages). Every one answered 200, none carries `noindex`,
and none is missing a description.

| Finding | Measured | Where |
|---|---|---|
| **Duplicate days** | 4 pairs of day pages share a title and description and are each canonical to themselves: Bologna (`09976f06…` by Tomas, `cdb8e3ff…` by Neablis), Florence, Rome and the Amalfi Coast. | `sitemapDays()` lists both, `playbooks/live/day/[savedDayId]/page.tsx:69` canonicals each to itself |
| **Demo trips are empty without JavaScript** | All five `/demo/<slug>` pages are in the sitemap. Their server HTML has no heading and no itinerary, only *"Opening the example trip…"*. | `BoardFallback`, `apps/web/src/components/demo/DemoTripScreen.tsx:104`; it is KI-2026-09-20-f for this one route family |
| **Long titles** | 183 of 282 titles are over 60 characters. Day titles repeat their city: *"3 days in Rome: emperors, gladiators & the layers beneath · Rome — Caesura"* (78). | the day page's `generateMetadata` |
| **Long descriptions** | 193 of 282 descriptions are over 160 characters. Place and tag descriptions are strung together from stop names, without a length limit. | the place, country×city and tag pages' metadata |
| **Missing canonical** | `/developers` and `/developers/reference` have no canonical and no `og:url`. `/playbooks` has a canonical but no `og:url`. | `(front)/developers/page.tsx:7` calls `pageMetadata` without `canonical` |
| **Raw tag labels** | A tag page titles itself from the raw tag: *"Sight days worth borrowing"*. | the tag pages' metadata |
| **Short static titles** | 9 titles are under 30 characters and generic: *"Developers — Caesura"*, *"Playbooks — Caesura"*, *"Example trips — Caesura"*. | `(front)/developers`, `playbooks/live/page.tsx`, `(front)/demo` |
| **Structured data gaps** | Day, city and country pages have no `BreadcrumbList`, though the country → city → day lattice is already there. `/playbooks` and `/demo` have no JSON-LD. | `lib/playbookUrls.ts` holds the paths |
| **Sitemap freshness** | Only the day entries carry `lastmod`. The place and tag entries have none. | `apps/web/src/app/sitemap.ts` |
| **Homepage weight** | The landing's HTML is **923 KB**, about 200 KB of it inline script and the RSC payload, with 136 links. It is served from the cache, so the first byte is fast, but the size weighs on mobile LCP and INP. | `(front)/page.tsx`, `components/front/LandingScreen.tsx` (M51's sea of day cards) |

### What already passes, and must keep passing

- `robots.ts` blocks `/api/` except `/api/og/playbooks`, and keeps previews out with `noindex`
  rather than a disallow.
- The sitemap and every page's robots tag read the same `placeIndexable` predicate.
- http → https (308), www → apex (307), unknown paths answer 404.
- Every page has one `<h1>`. The phone tree's headline is an `h2` with `aria-level=1` so the
  desktop tree keeps the document's only `<h1>` (`PhoneFrontDoor.tsx:220`).
- Every page has a unique description and a 1200×630 OG and Twitter card. The second `og:image`
  on pages with a card of their own is the deliberate fallback (`lib/siteMetadata.ts:74`).
- The homepage has `Organization` and `WebSite` JSON-LD, and day pages have `TouristTrip`,
  `ItemList`, `TouristAttraction` and `Person`.
- `llms.txt` is published.

## Decisions

### Open

1. **What happens to the four duplicate pairs, and what stops a fifth.** *Recommendation:* first
   find out how they arose. Two authors and identical text point to one content bundle imported
   twice (`docs/guidelines/content-bundles.md`). Unpublish the later copy of each pair. Then add a
   guard where duplicates come from: if the cause is the importer, a lint error for a day whose
   title and city match an already published day. Canonicalising one copy to the other was
   considered: it keeps two pages that say the same thing, and a canonical between two authors'
   days says one of them is not real.
2. **How a demo trip reaches a crawler.** *Recommendation:* a server-rendered summary in place of
   `BoardFallback`. That means the trip's title as the `<h1>`, then each day with its stops as text,
   read from the committed demo content the page's metadata already reads
   (`(front)/demo/[slug]/page.tsx:18`). The board replaces it once its client subtree mounts.
   Reading the whole board on the server is the general fix for KI-2026-09-20-f, and it is out of
   scope here.
3. **The title format.** *Recommendation:* keep the `— Caesura` suffix, and drop `· City` when the
   title already names the city. A person's own title is never clipped: Google truncates it in
   the results anyway, and a clipped title in the tab would be worse. The gate counts what is
   left over 60 characters rather than requiring zero.
4. **The description length.** *Recommendation:* the place, country×city and tag builders stop
   at 155 characters, on the last whole phrase that fits. A day's own description, written by its
   author, is left as it is.
5. **The static pages' words.** *Recommendation:* the build proposes the new titles and
   descriptions for `/playbooks`, `/demo`, `/developers` and `/developers/reference`, and Mitchell
   approves the words, as he did the landing's copy in M50.
6. **Tag labels.** *Recommendation:* one display label per tag beside the tag list (ADR-070's
   thirteen tags), read by the tag pages' titles, headings and descriptions. For example, `sight`
   becomes *"Sightseeing"*.
7. **The homepage's weight target.** *Recommendation:* measure first: which cards and how much of
   the RSC payload the server sends. Then set a target with Mitchell (a working figure: under
   400 KB of HTML) without losing M51's sea, for example by rendering fewer cards on the server
   and filling the rest in on the client.

## Scope

A first cut of the parts, for the plan to settle:

1. **Duplicates** (decision 1): the cause, the four unpublishes, and the guard.
2. **Demo trips on the server** (decision 2): the summary, and an e2e with JavaScript off.
3. **Metadata builders** (decisions 3–6): titles, descriptions, the canonicals and `og:url`, tag
   labels.
4. **Structured data and the sitemap**: `BreadcrumbList` on day, city, country, country×city and
   tag pages; `ItemList` on `/playbooks` and `/demo`; `lastmod` on the place and tag entries,
   from their newest published day.
5. **Homepage weight** (decision 7).
0. **The gate**: the production crawl, the evidence, the retro.

## Out of scope

- Indexing profiles or the board (the SEO pass, §7; M42 decision 4).
- Reading every route's data on the server, which is KI-2026-09-20-f in general.
- Lighthouse or Core Web Vitals targets beyond the homepage's weight. They are a candidate if the
  crawl shows they matter.
- Search Console and Bing Webmaster submissions, which are Mitchell's and need his accounts.
- Content and keyword strategy: what new days or places to write.

## Exit gate

- [ ] **Duplicates:** no two indexable day pages in the production sitemap share a title, and the
  guard from decision 1 is seen to refuse a duplicate in its test.
- [ ] **Demo trips:** with JavaScript off, every `/demo/<slug>` answers HTML with one `<h1>` (the
  trip's title) and every day's name (`test:e2e:ci-like`, or CI on the PR).
- [ ] **Titles:** no day title repeats its city after the `·`, and the count of production titles
  over 60 characters is recorded against the audit's 183.
- [ ] **Descriptions:** no place, country×city or tag description is over 160 characters (a unit
  test over the builders, and the production crawl).
- [ ] **Canonicals:** every page in the sitemap has a `rel="canonical"` and an `og:url` that
  match its own URL (the production crawl).
- [ ] **Tag labels:** no tag page's title, heading or description shows a raw tag.
- [ ] **Static copy:** the new titles and descriptions for `/playbooks`, `/demo`, `/developers`
  and `/developers/reference` are the words Mitchell approved.
- [ ] **Breadcrumbs:** a day, a city, a country, a country×city and a tag page each carry
  `BreadcrumbList` JSON-LD whose items are their real ancestors (unit tests over the builders).
- [ ] **Lists:** `/playbooks` and `/demo` carry `ItemList` JSON-LD.
- [ ] **Sitemap:** every place and tag entry carries a `lastmod`.
- [ ] **Homepage:** the landing's HTML is under the target set in decision 7, measured on
  production.
- [ ] **[walk]** Mitchell runs a day page and a city page through Google's Rich Results Test, and
  both show breadcrumbs with no errors.
