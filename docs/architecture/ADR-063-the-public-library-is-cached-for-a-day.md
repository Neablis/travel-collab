# ADR-063: The public library is cached for a day

**Status:** **Accepted — 2026-10-03.** Mitchell decided it; this records the shape.
**Deciders:** Mitchell (product); Claude — drafted
Amends: **ADR-061**'s first consequence (an unpublish or a moderation took up to an hour to
leave our edge cache).
Related: **ADR-059** (the cache is expendable; the Redis budget), **ADR-061** (the library is
readable without an account; private equals missing), spec
`docs/specs/2026-10-02-seo-pass-design.md` (the pages this caches).

## Context

> We can probably cache a trip for 24h at least, they don't need to be live. And we can clear
> the cache when we publish or unpublish.

Mitchell, 2026-10-03, and in the same exchange he chose to cache the preview images for 24 hours
too, purged from the CDN by tag.

The SEO pass made the library's pages render on the server, so every signed-out view of
Discover, a day, a city or a country page, and every fetch of the sitemap, ran its queries
against Postgres. None of that needs to be live: a day changes rarely, and a list a day old
misleads nobody. One thing must be live: **whether a day is in the library at all**. An
unpublished or hidden day shown to a stranger is the one failure ADR-061 exists to rule out.

## Decision

1. **Two layers, one set of tags.** Next's data cache (`unstable_cache`) holds the reads. Vercel's
   CDN holds the preview cards, through `Cache-Control` and a `Vercel-Cache-Tag` header. Both
   use the same names, built in one module, `apps/web/src/server/libraryCache.ts`:

   | Tag | On |
   |---|---|
   | `day:<savedDayId>` | that day's cached read; its card and `meta` (a private day's generic card included, so publishing it shows) |
   | `author:<userId>` | the author's public numbers; their same-author list; their profile card and `meta` |
   | `library` | everything that lists days: Discover for a signed-out reader, place pages and their lists, the sitemap, related days; the city and country cards and the city `meta` |

   The generic Playbooks and board card carries no tag: its words are static. Vercel allows any
   tag without a comma, up to 256 bytes, so `:` is fine. A tag built from a typed segment that
   breaks either rule is left off the header (`cacheTagHeader`).
2. **A day: `LIBRARY_CACHE_SECONDS = 86400`.** Cards are
   `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`: a day at the edge,
   and an hour in a browser or an unfurler, as before.
3. **What clears it.** `invalidatePublicDay(savedDayId, ownerId)` expires the three tags in the
   data cache (`revalidateTag(tag, { expire: 0 })`: expired, not served stale while it
   refreshes). It also deletes them from the CDN (`dangerouslyDeleteByTag`, not
   `invalidateByTag`, which would serve the old card once more). The CDN half runs only on Vercel
   (`VERCEL` set).
   - **The two halves land at different moments.** `revalidateTag` only records the tags; on
     Vercel, Next flushes them after the response, through `waitUntil` (the app-route
     template). So the data cache expires just after the 200, not before it. The CDN purge is
     the half that is awaited, so a 200 to "unpublish" means the day's card is gone.
   - **One narrow race is left.** A read that queried before the commit and stores its entry
     after the flush re-caches the old answer. For a day that is bounded by `readAt`
     (decision 5); for a list, by its day.
   - The purge is bounded at 2 s (`PURGE_TIMEOUT_MS`), so one that never answers cannot hang the
     write. It never throws: the write has committed, and a 500 would tell the author it had
     not. A failure or a timeout is one `console.error`.

   Its callers are the writes that move a day into or out of the library, after their commit:
   - `setSavedDayVisibility`: publish and unpublish, from `/api/saved-days/:id/publish` and
     `/v1/library`.
   - `updatePlaybookContent`: a visibility change, or a **rename of a published day**, from
     `/v1/playbooks`. The name is the URL's slug. A reader served the old name gets a 308 from
     the new URL to the old one, and a browser keeps a 308. Once the cache caught up, the
     reverse 308 would loop in that browser.
   - `deleteSavedDay`: from `/api/saved-days/:id` and `/v1/library`. Only a private day can be
     deleted, but its adds leave its author's numbers.
   - `actOnReport`: an operator's hide and restore.
   - The two dev seed routes (`/api/dev/saved-days`, `/api/dev/content/playbooks`): one batched
     clear of every day they rewrite, each tag once (`invalidatePublicDays`).

   **A name clears its author and every list.** The library names people (ADR-061 decision 4),
   and someone who changes the name it shows, perhaps to take their real one out, should not
   see the old one on the next page. `invalidateAuthor(userId)` clears `author:<id>` and
   `library`, awaited like an unpublish. That takes the name out of the day reads' author, the
   Discover, place and related lists' `ownerDisplayName`, and the day and profile cards. It is
   called only when the value changed: by `writePreferences` when `displayName` moved, and by
   `upsertUser` when a returning sign-in's `name` did.

   **An add clears less.** `invalidateDayRead(savedDayId, ownerId)` clears `day:<id>` and
   `author:<ownerId>` only, when an add counted: `insertSavedDay` (the add dialog, a new trip
   from a day, `/v1` playbook applications) and the assistant's approved insert
   (`ai/writeTools.ts`). A reader who just added a day sees its count move when they go back to
   it (M11b's "1 trip"). Lists do not need to show it within the day, so `library` stays. Adds
   are frequent, so the CDN half is not awaited: it is handed to `waitUntil` and runs after the
   response, on the same 2 s bound.
4. **Only a stranger's view is cached; a miss never is; an author always reads live.**
   - The day page tries the cached public read first. A day the library does not hold is read
     live for a signed-in reader, because it may be their own private or hidden day. For anyone
     signed out it is a 404. The author always reads live, so their edits and an operator's
     note show at once.
   - A miss (private, moderated, deleted, unknown) is thrown inside the cache, and
     `unstable_cache` keeps no throw. Random ids cannot fill it, and a private day and an
     unknown one stay the same answer (ADR-061 decision 2).
   - The per-reader side effect, a signed-in reader's pin backfill, runs outside the cache.
     Pins written by it clear nothing, so a cached day can show stops unpinned for up to a day.
     Meanwhile each signed-in stranger who opens it schedules a pass that finds nothing to do:
     one row read, no geocode spent (`backfillSavedDayStops` re-reads the live stops). Left so
     on purpose.
   - Discover is cached only for a reader with no account, keyed by the search. *Yours* and
     *Saved* are a signed-in reader's own, and stay live.
   - The JSON API (`/api/saved-days/:id`, `/api/playbooks`) stays live. The screens' own
     re-reads go there, and it is rate-limited already.
5. **A day-old entry is read again, not served.** Next answers an expired entry with the old
   value and refreshes it behind the response, and a refresh that throws keeps the old value. A
   day that left the library by a path that cleared nothing would otherwise be shown until
   something cleared its tag. So the cached day carries the time it was read, and an entry past
   its day is read live.
6. **Production builds only.** `next dev` and the test lanes read live, so a reseed is seen at
   once. The behaviour is proven where it runs: `e2e/seo.spec.ts` on the CI-like lane's
   `next start`.
7. **Every entry is keyed by its database and its deployment.** The database part is a hash of
   `DATABASE_URL`: CI restores `apps/web/.next/cache`, the data cache lives inside it, and every
   test run reads a database of its own. The deployment part is `VERCEL_DEPLOYMENT_ID`, else
   `VERCEL_GIT_COMMIT_SHA`, else `local`. `unstable_cache` keys on the callback's source and
   these parts, and Vercel's data cache outlives a deploy. Without it, a release that changed
   the shape of `SavedDay`, `DiscoverDay` or `PublicAuthor` would read the last release's JSON
   for a day.

## What is stale for up to a day

To a reader with no account, and to a signed-in reader of somebody else's day:

- a published day's summary, rating and review count, and its stops' pins: reviews, ratings,
  pins and a summary edit clear nothing;
- an author's review numbers on their days and their profile card;
- Discover's order and counts (most-added included), a place page's list and count, related
  days, and the sitemap's `lastModified`.

Two writes are exceptions (decision 3):

- An add clears the day it added and its author's entries, so a day's add count and its
  author's are live, and only the lists lag.
- A name change clears its author and every list.

**Nothing about whether a day is in the library is ever stale**, except through the paths
below.

## What does not clear it

- **`apps/web/scripts/import-content-production.ts`** writes from outside Next, so it cannot call
  `revalidateTag`. A day it withdraws leaves the day page within a day (decision 5). Lists and
  cards keep it until their tag is cleared or the day is up. After an import that withdraws or
  hides a day, purge the `library` tag in the Vercel dashboard (*CDN → Caches → Purge*), or run
  `vercel cache dangerously-delete --tag library`. Vercel's docs say a purge by tag clears the
  data cache as well as the CDN; that is *unverified here* (see the last consequence).
- A hand-run `UPDATE`, for the same reason and with the same remedy.

## Why not Redis

ADR-059 allows Redis for an expendable cache, with a budget line per use, on a free tier shared
by every environment. This would be its largest use by far: every page view, against a command
allowance. Next's data cache and Vercel's CDN are already in the bill. Vercel tags them and
purges by tag, and a purge reaches every instance. That last part is what ADR-059 decision 2
found a per-instance store could not do.

## Consequences

- A stranger's page view of a cached day costs no query. A new day reaches the library at once,
  since publish clears `library`.
- A publish clears every list. At the library's size (155 published days, 2026-10-02) that is
  some re-reads, not a stampede.
- Discover for a signed-out reader is keyed by its search, and a search is text anyone can type,
  so junk searches each leave an entry for a day. Nothing in the app meters that. The rendered
  pages are the Vercel firewall's to protect (ADR-061 decision 3, as amended 2026-10-03). A
  miss on a day is never stored, so the day page has no such cost.
- The preview routes' lookups (`dayCardFor` and the rest) are not cached in the data cache: they
  run only on a CDN miss, which is now once a day per card.
- CI restores `apps/web/.next/cache` between runs (`.github/workflows/ci.yml`), and the data
  cache lives in it (`fetch-cache`). Each e2e run reads its own database, and so writes entries
  under its own key, so that cached directory grows by a few KB per run until its cache key
  changes. Left as it is; if it ever matters, drop `fetch-cache` before saving the cache.
- Previews and production share the tag names, but Vercel scopes tags per project and
  environment, so a preview's purge does not touch production.
- Every deploy starts with a cold library cache (decision 7): the first view of each day, list
  and search after a release reads Postgres, as every view did before this ADR.
- *Not verified locally:* the CDN purge. It runs only inside a Vercel function. On a preview,
  open a day's card URL twice (the second response's `x-vercel-cache` is `HIT`), unpublish the
  day, and fetch the card again: it must be the generic card, and `MISS`. Also unverified: that
  a purge by tag from the dashboard or CLI clears Next's data cache on Vercel, as its docs say.
