# ADR-046: The client read cache is a seam, not a store — and it is SWR-shaped on purpose

**Status:** **Accepted — 2026-09-14.** Mitchell asked for the three scoped fixes
below "while also setting up the code in a logical way to leverage SWR in the
future"; this records the shape that answers both halves.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-012** (trip client-state architecture — invariant 1, *TripProvider
is a server-cache + dispatch, never a store*, is the line this ADR works within),
ADR-013 (optimistic updates and atomic batches — the queue a stale read could
revert), ADR-002 (the stack this adds no dependency to)

## Context

Every repeated network call in this app is a **remount**. There is no polling,
no `EventSource`, no socket, and nothing listens for `visibilitychange` or
`focus` — so a request repeats only when the component that makes it is mounted
again. Three shapes of that were costing real requests:

1. **Lens switches.** `TripBoardScreen` renders lenses conditionally
   (`{view === "Overview" && <OverviewLens/>}`), so leaving the tab unmounts it.
   A glance at Calendar and back re-ran `/globals`, `/pages` and `/pages/:id`
   — three requests per visit, for documents that had not moved.
2. **Route navigation.** Home → trip → home re-read the trip list, the detail,
   the history and the access row; and `NextTripHero` on the home page fetched
   the *same* `TripDetail` that `TripProvider` fetched a second later.
3. **The city typeahead.** `/api/cities?q=` is a pure function of the query and
   the most expensive read in the app per call — an `unnest` + aggregate over
   every published saved day, with no index a prefix match can use. It had no
   cache at any layer, and neither did any other route: nothing in
   `src/app/api/**` set a `Cache-Control` header.

A general fetch cache was the obvious answer and is the wrong one, for a reason
specific to this product: **with no realtime, refetch-on-mount is the only
mechanism by which anyone ever sees a co-traveller's edit.** A long TTL buys
request count with correctness on the one flow the product is named after. And
`TripProvider` is not a cache but a state machine — an optimistic queue with a
sequential sender and a retained-failure gate (KI-36) — where a stale read
arriving after a confirmed command shows a board that has silently reverted the
user's own edit.

## Decision

**1. A short reuse window, not a store.** `src/lib/queryCache.ts` de-duplicates
identical in-flight reads and reuses a resolved one inside a window measured in
seconds: `DEDUPE.NAVIGATION` (5s) for `TripDetail`, `DEDUPE.DOCUMENT` (30s) for
read-mostly trip documents. The window suppresses the thrash of remounting; it
never suppresses the next real read. Sized against the freshness it costs, not
against the requests it saves.

**2. The API client stays uncached, and that is what makes it SWR-ready.** The
read helpers in `apiClient.ts` / `pagesClient.ts` remain pure fetchers that know
nothing about the cache. Caching is the **call site's** decision, expressed as
`cachedRead(key, fetcher, { dedupeMs })`, because only the call site knows how
fresh it needs to be. This is `useSWR(key, fetcher, { dedupingInterval })` with
the same three arguments, which is the migration: swap the call, keep the key
and the fetcher, delete this module.

**3. Keys live in one file.** `src/lib/queryKeys.ts` is the whole catalogue, and
these are the SWR keys unchanged. A key is `:`-delimited, narrowest last, so a
prefix names a family and `invalidate(tripKeys.all(id))` drops a trip's detail,
history, access, notebook list and page docs in one call.

**4. A write opens a SCOPE, it does not merely invalidate afterwards.**
`beginWrite(prefix)` before the request, `endWrite(prefix)` in a `finally`.
Stated as a second module invariant beside the existing "never rejects" one,
and enforced per helper by a table-driven test in each client's suite.

The `finally` alone was the first design and it was **wrong in a way only a
browser found** — see Consequences. Invalidating when the write RESOLVES is too
late for a read that arrives while it is still open: `TripProvider` reads once
on mount, takes the pre-write answer, and there is no second read to correct
it. A scope is three things, and each is killable by its own mutation:

- `beginWrite` **clears** the prefix, so a read after the write was sent finds
  nothing stored and nothing pre-write to join.
- While the scope is open nothing may be **stored**, so two reads during one
  write do not share an answer the write has since falsified.
- The scope is **counted**, not a flag — a page autosave and a command can be
  outstanding at once, and the first to finish must not reopen caching.

A fourth mechanism (suppressing cache *hits* while a scope is open) was written
and removed: no mutation could kill it on its own, and a mechanism no test can
kill is exactly the unproven claim this change was caught by twice.

- **In a `finally`, i.e. on the way out.** Clearing before the request looks
  equivalent and is not: a read that starts after that clear and lands before
  the write's response caches a pre-write answer that nothing then clears.
- **Whatever the outcome**, because a write whose response never arrived may
  still have been applied. One extra read is the cost of being wrong this way;
  a document the user edited and cannot see is the cost of the other.
- A per-key **generation counter** (the same monotonic-ticket shape as
  `(app)/page.tsx`'s `loadTicket`) stops a read that was already in flight when
  the write landed from storing its stale answer.

**5. Failures are never stored.** A cached `ok: false` makes a retry a no-op for
the rest of the window — the user presses *Try again* and nothing happens, which
is worse than the failure it caches. Failures still de-duplicate while in
flight, which is the half that is safe.

**6. The trips list is deliberately NOT cached.** `GET /api/trips` backs the
home page, where creating, restoring and deleting a trip must show immediately.
It is the one read where staleness is visible as a bug rather than as latency.

**7. City search is NOT cached, at either layer — attempted, then withdrawn.**
Both a client memo and a `Cache-Control: private, max-age=300` header were
written, and both came out before merge. The memo broke
`e2e/m11b-playbooks.spec.ts:339` at line 374: the test routes `/api/cities` to
abort and refills a query it already searched, and a cached answer means **no
request is made, so the failure state never renders**. The four states that test
walks are a milestone exit gate.

The general statement, which is why this is a decision and not a bug report:
**on a search endpoint, saving the request and keeping the failure state
reachable are mutually exclusive.** A cache that saves the request cannot fail.
A stale-while-revalidate cache keeps every state and saves nothing — which was
the entire point. There is no client-side shape that delivers both.

The header went with it even though the e2e passed with the header alone. That
pass is an artifact: Playwright's `page.route` intercepts ahead of the browser's
HTTP cache, so the test cannot see what a real user under `max-age=300` would —
the same staleness the memo had. Shipping a behaviour whose safety rests on a
test blind spot is worse than shipping neither.

## Consequences

- New: `src/lib/queryCache.ts`, `src/lib/queryKeys.ts`, and their tests. No new
  dependency; SWR is not installed by this change.
- `vitest.setup.ts` clears the cache after every test. A module-level cache
  outlives an `it()` the way MSW's handlers do, and it is the worst kind of
  leak: it does not fail, it **passes** with the previous test's answer. Four
  `TripProvider` tests that mock a failing read went green against a success
  cached above them the moment this landed.
- When SWR is adopted: `cachedRead` → `useSWR`, `invalidate` → `mutate` with a
  key filter, `DEDUPE` → `dedupingInterval`. `queryKeys.ts` does not change, and
  neither do the fetchers. The call sites that change are the ones already
  calling `cachedRead`, which is the list this ADR bounds.
- **The defect that a browser found and 2,579 unit tests could not.** Adding a
  day and navigating away and back inside the window left the board missing the
  day, permanently — about one attempt in five naturally, every time with a
  slow write. `cachedRead` served an entry stored *before the command was
  sent*; the `finally` invalidation then fired with nothing left to correct,
  because `TripProvider` had already taken that answer and set its state. Every
  unit test here mocks the transport, and none of them put a read between a
  write being sent and its response — which is the whole window. Fixed by
  Decision 4's scope; the lesson is that a cache's races live in the gaps
  between requests, and a mocked transport has no gaps.
- What this does NOT do: it does not make the app realtime. Every window here is
  a bet that a co-traveller has not edited in the last few seconds, and the way
  to stop betting is a subscription, not a longer cache.
- **What the scope does NOT close, confirmed by the same walk that found the
  defect** — `KI-2026-09-14-e`. A command the server applies *after* you
  navigate leaves the board behind in exactly the same way, and the cache is
  not involved: that read reaches the wire and is correct when taken. `main`,
  which refetches on every mount and has no cache, does it too. The cache-hit
  path is closed; the no-re-read path is `TripProvider`'s, and it is a second
  read that fixes it, not a cache change.
- **The city-search cost is real and still unpaid** — `KI-2026-09-14-d`. It
  belongs on the server, where the request still happens and every
  client-observable state survives: a short server-side memo, an `ETag` with
  `must-revalidate` so a repeat is a 304, or a maintained `city -> count`
  projection. The last removes the aggregate instead of hiding it. *Paid
  2026-09-25 with the first option, a 30 s per-process memo in `searchCities`
  that is cleared on publish, unpublish and moderation. The entry's Decision
  line explains why the projection was rejected.*
- **The general lesson, worth more than the cache.** Two of the three targets
  were safe to cache because a *local write invalidates them*. The third was not,
  because its interesting state is a *failure*, and failure is the one answer a
  cache can never reproduce. "Is this read cacheable?" is really "can every state
  this read can be in survive being served from memory?" — and for anything whose
  UI distinguishes failed from empty, the answer is no.
