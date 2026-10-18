# ADR-077: The public library serves a cached copy to readers with no session

**Status:** **Accepted — 2026-10-18.** Mitchell chose the split over a cookie-free route group
and over `cacheComponents`, the same day.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-061** (the library is readable without an account), **ADR-063** (its reads are
cached for a day and cleared on publish), **ADR-045** (entitlements; never a JWT claim), M45
decision 3 (the plan goes with the page), the SEO pass plan (`docs/plans/2026-10-02-seo-pass.md`,
which rules out `loading.tsx` here), and the candidate *"Public playbook pages become cacheable"*
from PR 481's audit.

## Context

Measured on production on 2026-10-18: `/playbooks` answered `cache-control: private, no-cache,
no-store` and `x-vercel-cache: MISS` with about 770ms to first byte, while `/welcome` was a
prerendered HIT. Lighthouse mobile scored `/playbooks` 75 (LCP 2.4s) and a playbook day 73.
`next build` listed every `/playbooks/**` route as `ƒ`.

The `(app)` layout was the obvious cause: it reads `cookies()` and awaits `auth()`, the plan and
the preferences. But the pages read the session too. Discover calls `auth()` for *Saved* and a
live answer, and the day page calls it so an author can open their own private day. Discover,
the place and tag pages (`?page=`) and the day page (`?from=`) also read `searchParams`. Any one
of those makes a page dynamic, whatever the layout does.

One fact settled the shape: **the Ask is only drawn for a signed-in reader**
(`usePlaybookAssistantOffered` in `BeyondTripAssistant.tsx` needs `signedIn`). A reader with no session never saw
an Ask, *Saved* or a private day.

## Decision

1. **`proxy.ts` picks the copy.** It now matches `/playbooks/:path*` and rewrites every request to
   `/playbooks/cached/…` when `req.auth` is empty and the query holds nothing a page reads
   (Next's `_rsc` and `utm_*`/`fbclid`/`gclid` are ignored), and to `/playbooks/live/…` otherwise.
   The decision is `lib/playbooksReader.ts`, tested on its own.
2. **The pages live once, in `app/playbooks/live`, and render per request** exactly as they did
   in `(app)`: a signed-in reader's plan is still in the first HTML (M45 decision 3), with their
   preferences, *Saved* and their own private days. Its layout reads the session through
   `server/servedSession.ts`, which `(app)/layout.tsx` now shares. Both draw `AppShell`.
3. **`app/playbooks/[copy]` re-exports those pages as the cached copy.** Its layout draws the
   signed-out shell with nothing read. The pages ask `readerOf(params)`: with `copy` present they
   read no `auth()` and no `searchParams`, which is what lets Next cache them. Every
   `generateStaticParams` there returns `[]`, so each URL renders on its first visit and is kept.
4. **The cache's lifetime is the data's.** The pages' reads are `libraryCached` (ADR-063), whose
   tags land on each page's ISR entry, so `invalidatePublicDay` and `invalidateAuthor` clear the
   pages as well as the reads. That includes a cached 404: the miss read carries the day's tag
   before it throws. A page with no tagged read (the board) keeps until the next deploy.

## Why two trees and not one segment

Tried first: one tree under `app/playbooks/[reader]`. Two Next behaviours ruled it out, both seen
under `next start`:

- A route with `generateStaticParams` renders **every** value of its segments in ISR mode. The
  live copy's `cookies()` then failed the render with `DYNAMIC_SERVER_USAGE`, a 500.
- A cached copy in a plain folder (no dynamic segment) is prerendered at `next build`. CI builds
  without a database (`app/sitemap.ts` is `force-dynamic` for the same reason), so Discover would
  fail the build.

`live` is therefore a plain folder that renders per request. The cached copy is a segment,
`[copy]`, so an empty `generateStaticParams` can defer it to first visit. A URL that names a copy
itself 404s: the proxy prefixes it again.

## Options not taken

- **One cookie-free route group, with the session read on the client.** The signed-in header
  would flash *Sign in* before the avatar. The Ask would appear only after `/api/account/plan`,
  which undoes M45 decision 3 on these pages. An author's private day would 404 on the server,
  and *Saved* could not render there.
- **`cacheComponents` / PPR.** A global switch with the largest blast radius. A `notFound()`
  inside a dynamic hole streams with a 200, which is the `loading.tsx` problem the SEO plan
  rules out.
- **`generateStaticParams` with the top tags and cities.** The candidate asked for it. It needs a
  database at build, which CI does not have. Any publish clears every list (`LIBRARY_TAG`), so a
  page built at deploy would not outlive the next publish anyway.

## Consequences

- The proxy now runs on every library request: one Edge invocation and a JWT decode, before a
  CDN hit.
- `/playbooks` no longer renders without `proxy.ts`. The routes are only reachable through its
  rewrite.
- The lint-wall exemptions moved with the files: `src/app/playbooks/**/page.tsx` for the pages
  and `src/app/playbooks/live/layout.tsx` beside `(app)/layout.tsx` for the session read. The
  cached layout has none. Fixtures are in `scripts/check-lint-wall.mjs`.
- A day segment that cannot be canonical (a bare id, an upper-cased id, a doubled hyphen) is
  answered live, because it is a 308 and Next 16.4.2 doubles a cached redirect's `Location` under
  `next start` (KI-2026-10-18-d; Vercel does not). A stale slug still reaches the cached copy, and
  its redirect drops a shared link's campaign tag, which no page reads.
- `/signin` and `/signup` stay dynamic, deliberately. They read `searchParams` for the link card a
  scraper sees (*"A trip shared with you"*, the referral card) and to seed the callback before
  hydration. Their own comments carry that decision.
