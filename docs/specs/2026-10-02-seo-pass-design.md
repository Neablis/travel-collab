# The SEO pass over the public library

**Status:** Design, 2026-10-02. Approved by Mitchell in the session that wrote it. Not planned
and not built: the plan is written in a fresh session, and the build in another
(`docs/retros/2026-09-15-m9-planning-session-scope-drift-retro.md`).

Mitchell's ask:

> Can you research how our website is doing for SEO today, and what improvements we can do to
> better have it found by search providers.

Then, after the audit: *"Lets start the SEO work"*, and on the design below: *"Yes looks great
... make sure to use subagent development and stacked PRs to build"*.

This is the pass `docs/candidates.md` records as "An SEO pass over the public library". It is
candidate work that runs **alongside M19**, not a milestone.

**How far to trust section 1.** It comes from a read-only audit of `main` at `c75154c0`, done by
a subagent and spot-checked. The live-site lines were observed directly. The plan session
verifies every cited file and line before it relies on one.

---

## 1. Where things stand

**What is public.** No trip is public. ADR-061 made the **playbook library** readable without an
account: `/playbooks` (Discover), `/playbooks/day/<uuid>`, `/playbooks/profile/<userId>` and
`/playbooks/board`. A trip is reachable signed-out only through `/s/<token>` or
`/invite/<token>`, which are secrets in a URL.

**Observed on the live site, 2026-10-02:**

- `/`, `/robots.txt` and `/sitemap.xml` answer `429 Vercel Security Checkpoint`
  (`x-vercel-mitigated: challenge`) to non-browser clients, from two networks.
- `/llms.txt` and `/api/og/playbooks` answer 200.
- So the firewall rule `docs/guidelines/using-the-api.md` describes ("challenges automated
  traffic on every path outside `/api/*`") is on. It is dashboard configuration.
- Not testable from here: whether verified Googlebot and Bingbot pass the challenge.

**In the code:**

- There is no `robots.ts`, no `sitemap.ts`, no canonical URL, no `robots` metadata, no JSON-LD
  and no `not-found.tsx` anywhere in `apps/web`.
- Every public playbook screen is `"use client"` and reads in an effect (`DiscoverScreen`,
  `SharedDayScreen`, `ProfileScreen`, `LeaderboardScreen`). The HTML a crawler receives is a
  skeleton. This is KI-2026-09-20-f.
- A missing, private or moderated day answers HTTP 200 with a client-rendered "not in the
  library" message.
- Every day page has the `<title>` "A playbook — Caesura". `lib/linkPreview.ts` gives
  `og:title` the real name and keeps the tab title generic on purpose.
- Every internal link to a day or profile carries `?from=…&day=…&profile=…`
  (`components/playbooks/backLink.ts`). The clean URL is never linked.
- Discover returns the top 24 of at most 200 candidates and has no pagination
  (`server/playbooks.ts`).
- City is a query string on Discover (`/playbooks?city=Kyoto`). A city preview card and its
  copy already exist under `/api/og/playbooks/city/[city]`.
- `saved_days.summary` (up to 500 characters, authored) is neither rendered on the day page nor
  used in its description.
- `/welcome` renders the phone and desktop trees together and hides one with CSS, so the
  document has two `<h1>`s. `/demo` and `/s/[token]` set string titles already ending in
  "— Caesura", which the root template suffixes again.
- A signed-out `/` redirects to `/welcome` (`proxy.ts`), so the bare domain is not the indexed
  homepage.
- Page files may not import `@/server` (the lint wall). `linkPreviewMetadata` works around it
  with an HTTP self-fetch that is rate-limited to 60 a minute per IP and falls back to generic
  metadata on any failure.

## 2. Decisions

Each was put to Mitchell as a choice on 2026-10-02.

| # | Decision | Chosen over |
|---|---|---|
| D1 | Spec the whole pass, then build it as stacked PRs with subagents | One small PR of quick wins |
| D2 | `sitemap.ts` and `robots.ts` join the lint wall's exempt shell and read in-process | An HTTP self-fetch; a route handler plus a rewrite |
| D3 | `<title>` on day pages is the day's real name and city | The generic tab title |
| D4 | The index holds the landing, Discover, days, city pages and country pages. Profiles and the board are `noindex, follow` | Indexing profiles; indexing everything |
| D5 | `src/app/(app)/playbooks/**/page.tsx` joins the exempt shell and reads in-process | An HTTP self-fetch to the public API; leaving pages client-rendered |
| D6 | City **and** country pages as paths: `/playbooks/city/<slug>`, `/playbooks/country/<slug>` | Cities only; keeping `?city=`; leaving them out |
| D7 | Day URLs become `/playbooks/day/<slug>-<id>` | Keeping the bare UUID |
| D8 | Related days on a day page, and paged city and country lists. Discover stays a 24-item view | Paginating Discover; sitemap only |
| D9 | The landing is served at `/` for a signed-out visitor, and `/welcome` is canonical to `/` | Keeping the redirect |

D5 is the second hole in the wall after `src/app/admin/**`. The reason is the one AGENTS.md
records for admin: a server component fetching its own API over HTTP keeps the wall's letter
and inverts its reason, and it puts a rate limit and a timeout in the render path.

## 3. Constraints that hold throughout

- **Private equals missing** (ADR-061 decision 2). A private, moderated, deleted or nonexistent
  day gives the same 404, with the same body. Nothing distinguishes them, in the page, the
  sitemap or a redirect.
- **The library is pseudonymous** (ADR-061 decision 4). Titles, descriptions and structured
  data name an author by handle (`displayNameFor`), never a real name.
- **Token routes stay out of every index.** `/s/**` and `/invite/**` get `noindex` metadata.
  They are *not* listed in `robots.txt`: a disallowed URL cannot be crawled to see its
  `noindex`, and naming the prefixes advertises them.
- **No contract change and no migration.** Slugs are derived, not stored. If the plan finds it
  needs either, that is a design change and comes back to Mitchell.
- **No new public API endpoint** (AGENTS.md, Definition of Done). New internal routes get a
  line in `server/public-api/exposure.ts`.

## 4. The build: five stacked PRs

Planned and merged per `docs/guidelines/stacked-prs.md`. Each part is built by a subagent in
its own worktree (`subagent-driven-development`; `phase-implementer` and `phase-verifier`).
Each opens as a draft.

### Part 1: crawl plumbing

- `robots.ts`: allow all, disallow `/api/`, name the sitemap. It is the same on every
  deployment; a preview is kept out by `noindex` (next bullet), which a disallow would hide.
- `noindex` metadata on `/s/**`, `/invite/**`, `/signin`, `/signup`, `/playbooks/profile/**`
  and `/playbooks/board` (the last two `noindex, follow`), and on every page of a
  non-production deployment.
- Canonical URLs through `alternates.canonical`:
  - a day or profile drops `?from=`, `?day=` and `?profile=`;
  - Discover is canonical to `/playbooks` whatever its filters.
- Day `<title>` is the day's name and first city, from the same lookup `og:title` uses. When
  the lookup fails it falls back to today's generic title.
- One `<h1>` in the landing document. `/demo` gets a description, and the doubled title suffix
  on `/demo` and `/s/[token]` goes.
- The proxy rewrites a signed-out `/` to the landing with no redirect. `/welcome` declares `/`
  canonical. The response for `/` must not be cached across the session boundary; the plan
  says how and a test proves a signed-in request never gets the landing.
- `pageMetadata()` sets the `twitter` title and description explicitly.

### Part 2: sitemap

- `sitemap.ts` lists the static public routes (`/`, `/playbooks`, `/demo`, `/developers`,
  `/developers/reference`) and every published day that is not moderated and not deleted.
  `lastModified` is `publishedAt`.
- One query in `server/playbooks.ts`. It is not limited by Discover's 200-candidate cap.
- The lint-wall exemption for `sitemap.ts` and `robots.ts`, with fixtures in
  `scripts/check-lint-wall.mjs` proving the hole is exactly those files, and AGENTS.md's
  exempt-shell paragraph updated.
- If production holds more days than one sitemap file allows (50,000), the plan adds chunking.
  It checks the count first.

### Part 3: server-rendered days, real 404s, slugs

- The lint-wall exemption for `src/app/(app)/playbooks/**/page.tsx`, with fixtures and the
  AGENTS.md paragraph.
- The day page and Discover read on the server and pass `initialData` to the existing client
  screens, which render it without a first fetch. `useLibraryRead` accepts the initial value.
  Profiles and the board stay client-rendered: they are out of the index (D4).
- `generateMetadata` for a day reads in-process too, replacing the HTTP self-fetch for that
  route. The image still comes from `/api/og/playbooks/day/<id>`.
- A day that is missing, private, moderated or deleted calls `notFound()`. A root
  `not-found.tsx` gives the 404 its page.
- The day's `summary` is rendered on the page and becomes the meta description when present.
  The facts line ("Kyoto · 3 stops · by Traveler x") is the fallback.
- **Slugs.** The URL is `/playbooks/day/<slug>-<uuid>`. The slug is derived from the day's name
  by a pure function; the UUID alone resolves the day. A request whose slug is absent or stale
  gets a 308 to the current URL, so every link already shared keeps working. Link builders
  (`DiscoverCard`, `backLink.ts`, the share button, the sitemap) emit the slugged form.

Slugs ship here and not last so that the sitemap and canonicals never publish one set of URLs
and then change them. Part 2's sitemap emits bare-UUID URLs for the short time before Part 3
merges; they redirect afterwards.

### Part 4: structured data

- One pure JSON-LD builder module, unit-tested, rendered as a `<script type="application/ld+json">`
  by the server component.
- Landing: `Organization` and `WebSite`.
- Day: `TouristTrip` with an `ItemList` of its stops, and a `BreadcrumbList` (Playbooks, city,
  day). The author is the handle.
- No `aggregateRating`. Its schema.org domain does not include `Trip`, so validators flag it,
  and Google shows no review stars for a trip. (Amended 2026-10-03, from a review of #298.)

Google has no rich-result type for an itinerary; breadcrumbs are the part likely to show. The
module stays small for that reason.

### Part 5: city and country pages, and crawl depth

- `/playbooks/city/<slug>` and `/playbooks/country/<slug>`: server-rendered lists of that
  place's published days, each with its own title and description. The city page reuses the
  existing city card; the country page gets one in the same shape.
- **Slug resolution.** `cities` and `countries` are free text. The page slugifies the distinct
  values across published days and matches the request. Spellings that slugify alike merge
  into one page. A slug with no published day is a 404.
- Paging by `?page=N` with real links. Each page is self-canonical.
- Both kinds of page go in the sitemap.
- A day page gains related days: a few from the same city and a few by the same author, as
  real links.
- Discover's `?city=` and `?country=` views are canonical to the matching path. City chips on
  a profile and on Discover link to the path.
- A Kyoto day appears on the Kyoto page and the Japan page. Each is self-canonical, and the
  day's breadcrumb runs through the city.

## 5. Outside the code

- **The firewall exemption is Mitchell's, in the Vercel dashboard.** Bypass the challenge for
  `/`, `/welcome`, `/playbooks/**`, `/robots.txt` and `/sitemap.xml`. Until then the whole pass
  is invisible to any crawler Vercel does not verify. Part 1 updates the table in
  `docs/guidelines/using-the-api.md`.
- **After Part 2 merges:** submit `/sitemap.xml` in Google Search Console and Bing Webmaster
  Tools. Mitchell's step; they need his accounts.
- **Check before Part 1 ships:** that `VERCEL_PROJECT_PRODUCTION_URL` resolves to
  `caesura.today`. `metadataBase`, and so every canonical URL, is built from it.

## 6. Testing

One layer per claim (`docs/guidelines/testing.md`); each test is seen to fail first.

| Claim | Layer |
|---|---|
| Slug derivation, canonical URL builders, JSON-LD builders | Unit |
| The sitemap query and the city and country queries exclude private, moderated and deleted days | Integration |
| A day's HTML holds its name and stops with JavaScript off; a missing id answers 404; a stale slug answers 308; a signed-out `/` serves the landing and a signed-in one does not | E2E, one script, `test:e2e:ci-like` |
| The two wall exemptions are exactly the named files | `scripts/check-lint-wall.mjs` fixtures |

## 7. Not in this pass

- Indexing profiles or the board.
- Paginating Discover.
- Public notebook templates (`SavedNotebookVisibility` is `private` only; a contract change).
- Public pages for the sample trips under `content/trips/`.
- The PWA, recorded separately in `docs/candidates.md`.

## 8. What the plan session must settle

- The exact glob and fixture set for each wall exemption.
- How `/` avoids being cached across the session boundary.
- The production counts of published days, distinct cities and distinct countries, which decide
  sitemap chunking and whether thin city pages need a minimum-days threshold.
- Whether the server read for Discover shares code with the `/api/playbooks` handler or calls
  the same `server/playbooks.ts` function. It must be one implementation.
