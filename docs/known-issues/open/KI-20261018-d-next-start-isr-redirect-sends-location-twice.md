### KI-2026-10-18-d — Under `next start`, a cached library page's first redirect sends `Location` twice

- **Severity:** cosmetic in production, which runs on Vercel and is not affected. It matters to
  `next start`, which is CI's e2e lane and the local ci-like lane: Playwright's request API joins
  the two headers into `"<url>, <url>"`, and an assertion on the header fails.
- **Area:** `node_modules/next/dist/build/templates/app-page-runtime.js` (Next 16.4.2), reached
  through `app/playbooks/[copy]/day/[savedDayId]/page.tsx` (ADR-077).
- **Symptom:** an ISR page that calls `permanentRedirect()` answers its cache-filling request
  (`x-nextjs-cache: MISS`) with `location` twice. Requests that HIT the cache get it once. Measured
  2026-10-18 on `next start`. On PR 487's Vercel preview the same requests sent it once, MISS and
  HIT alike.
- **Cause:** in the blocking render, `app-render.js` sets `location` on the live response
  (`setHeader`, around line 5254). Then the runtime appends every header of the fresh cache entry
  to that same response (`res.appendHeader`, around line 1360). Vercel's deploy path serves the
  entry itself (`invokeOnCacheEntry`), so it never doubles.
- **Workaround in place:** `lib/playbooksReader.ts` sends a day segment that cannot be canonical (a
  bare id, an upper-cased id, a doubled hyphen) to the live copy. Those are the redirects a URL
  alone can spot, and `e2e/seo.spec.ts` covers them. **Still open:** a stale but well-formed slug
  (`/playbooks/day/an-old-name-<id>`, no query) reaches the cached copy and doubles the header on its
  first request under `next start`.
- **Fix direction:** an upstream fix in Next (search its issues for "ISR redirect duplicate
  location"), then drop the `CANONICAL_DAY` routing. Until then, a spec that asserts a stale slug's
  `Location` without a query string will fail under `next start` the first time it runs.
- **First noted:** 2026-10-18, PR 487.
