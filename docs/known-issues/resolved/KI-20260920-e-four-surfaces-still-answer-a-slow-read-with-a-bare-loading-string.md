### KI-2026-09-20-e — four surfaces still answer a slow read with a bare `Loading…`, which link 7's own survey missed — RESOLVED

- **Severity:** cosmetic on a fast connection, and a blank-looking app on a slow
  one. Not a correctness defect. (As found.)
- **Area:** `apps/web/src/components/board/TripBoardScreen.tsx` (the
  `status === "loading"` branch), `apps/web/src/components/plans/PlansScreen.tsx:687`,
  `apps/web/src/components/pages/PageScreen.tsx:423`,
  `apps/web/src/components/trip/NotebooksMenu.tsx:207`.

- **Symptom / What happens:** each of these answers a whole-surface read with
  the string `Loading…` and nothing else — no chrome, no shape. M26 link 7 calls
  that out by name for other surfaces: *"a page's chrome and primary actions are
  real from the first frame and never placeholdered"*, and `ui/skeleton.tsx`'s
  header argues the same point in prose — *"'Loading…' said once for a page that
  is three-quarters painted is a lie."*

- **How it was found:** Mitchell, 2026-09-20, on the PR #196 preview: *"i still
  see a flicker of 'Loading' text in top left when i click a trip to open it. It
  happens too quickly to leave a ui comment."*

- **The trip board's string is GONE; the other three remain.** Why it flashed:
  `TripProvider` starts at `status: "loading"` and reads through `cachedRead`,
  and Home's hero has usually already fetched the same `TripDetail` for its
  stats (`TripProvider.tsx:109`), so the promise settles in about a frame. The
  branch now returns `null` — the board is not there until its data is.

  **Two more elaborate fixes were tried or considered and both were worse.** A
  200ms gate on the word (`useSlowLoad`, since deleted) shipped first and was
  reverted on Mitchell's call: *"dont even have the loading state. KEep it
  simple."* It was a second piece of timing state to own, for a word. And a
  skeleton alone would not have fixed anything — `[data-sk]` starts at
  `opacity: 1`, so a placeholder flashes exactly as hard as text does.

  Note what that leaves: on a genuinely slow network the trip board now shows
  nothing at all until the data lands. That is deliberate and it is the right
  trade at one frame; it is the *wrong* trade at three seconds, and the fix for
  the three-second case is the skeleton below, not the word coming back.

- **Why link 7 did not cover it.** Link 7's survey enumerated four surfaces —
  Home, Overview, the Notebook index and the Map lens — and all four were built.
  The trip board, Plans, `PageScreen` and `NotebooksMenu` were never on the list,
  so this is an incomplete *survey*, not an incomplete execution. Worth saying
  plainly because the milestone's gate boxes are ticked and a reader would
  otherwise conclude §3b is finished everywhere.

- **READ `KI-2026-09-20-f` BEFORE BUILDING ANY OF THIS.** That entry measures the
  cause one level down: 14 of the app's 16 route pages fetch their own data
  client-side, which is *why* every surface has a window to fill in the first
  place. If a route's first read moves to the server component that already
  exists, the window closes and there is nothing left for a skeleton to cover —
  App Router holds the previous page on screen instead. A skeleton is a good
  answer to a question this app may not have to ask. Decide between them once,
  rather than building four placeholders and then deleting them.

- **What it would take** (if the skeleton is still the answer after reading
  `-f`): the pieces already exist — `Skeleton`, `SkeletonRegion`
  and `RegionError` in `ui/skeleton.tsx`, and `HomeSkeletons.tsx` as the worked
  example. The trip board is the one that earns it first, being the most-opened
  surface in the app; its shape is the header, the view tabs, the day chips and
  the board columns.

- **Deliberately not done in PR #196.** That PR is 163 files trying to land. New
  placeholder UI for four surfaces is milestone work with its own red-first
  tests, not cleanup, and adding it is how the branch reached 163 files in the
  first place.
- **2026-09-23, after M27:** the Notebooks menu's string is **gone** too. It now
  shows placeholder rows sized to the real rows, with `role="status"` named
  *Loading notebooks*, pinned by `NotebooksMenu.test.tsx`. `PageScreen.tsx`
  (now `:524`) and `PlansScreen.tsx:687` remain. The notebook page's is the one
  a walk hits: it paints `Loading…` alone where M26 §3b wants real chrome from
  the first frame. The Home hero's sparkline `Loading…` is a separate problem
  with its own measurement: `KI-2026-09-23-e`.
- **2026-09-24, seen again, and the scope widened on Mitchell's call.** On the
  PR #221 preview, going **Overview → Edit Overview** (a notebook page,
  `/trips/…/pages/…?from=overview`) still shows `Loading…` where the page's
  placeholder belongs. That is `PageScreen.tsx:646`, the branch this entry has
  named since 2026-09-20. Mitchell, via a preview comment: *"Lets file a KI to
  clean up all page transitions and confirm we arent doing the 'Loading...'
  text anymore."* So this entry now covers **every route transition**, not just
  the four surfaces it started with. The bare strings still in the tree, by
  `grep -rn "Loading…" apps/web/src --include=*.tsx` without the tests and
  comments, are:
  - `components/pages/PageScreen.tsx:646`: the whole page, and the one a walk hits.
  - `components/plans/PlansScreen.tsx:687`: the order card while Stripe's
    preview is pending. It sits inside a card, not a whole surface, but it
    is still the word.
  - `components/account/TokensSection.tsx:646`: `Loading your trips…` in the
    token scope picker. It has the same shape, so it's in scope.

  **Done means, in addition to the fixes above:**
  1. Every route under `app/` has been walked from its usual entry point on a
     preview (for the notebook, Overview → the page), and none paints the word.
     KI-2026-09-20-f's server-first read is still the first thing to weigh.
     Where a route keeps a client read, it gets a shaped placeholder from
     `ui/skeleton.tsx`, as `NotebookScreen` and `OverviewLens` have.
  2. **A guard, so "confirm we aren't doing it anymore" stays true.** Add a
     wall (the shape of the docstring wall, and allowlist-free) that fails
     when a `.tsx` under `apps/web/src`, outside tests and comments, renders
     text matching `/^\s*Loading(…|\.\.\.)/`. Screen-reader names on
     `SkeletonRegion`, such as `label="Loading notebooks"`, are attributes, not
     rendered text, and stay allowed. See it red on `PageScreen.tsx:646`
     before that line is fixed.
- **Resolved 2026-09-25 (overnight KI sweep).** The last three strings are
  gone, and the trip board's rule applies to each: render the chrome that is
  real from the first frame, and otherwise nothing.
  - `PageScreen.tsx`: the loading branch returns `null`.
  - `PlansScreen.tsx`: the order card keeps its `Order` heading and shows no
    body until Stripe's preview lands.
  - `TokensSection.tsx`: the trip picker keeps its explanatory sentence and
    shows no chips until the list lands.

  A re-grep of `apps/web/src` found no other rendered `Loading…`.

  **Guard:** `scripts/check-loading-wall.mjs` runs in `pnpm lint`, with
  `scripts/__tests__/check-loading-wall.test.mjs`. It uses the TypeScript
  AST, so comments are never scanned, and it has no allowlist. It fails on a
  JSX text node or a non-attribute string literal in a non-test `.tsx` that
  starts with `Loading` and ends in `…` or `...`. The widening is
  deliberate: the entry's `/^\s*Loading(…|\.\.\.)/` would have missed
  `Loading your trips…`. Run over the pre-fix tree, the wall fails and names
  all three sites: `TokensSection.tsx:651`, `PageScreen.tsx:752`, and
  `PlansScreen.tsx:691`. Over the fixed tree it prints
  `loading wall OK (187 files scanned)`.

  **Proof:** three component tests hold each read pending: the trip read in
  `PageScreen.test.tsx`, Stripe's preview in `PlansScreen.test.tsx`, and the
  trip list in `TokensSection.test.tsx`. Against the unfixed code all three
  failed for this reason, e.g. `expected 'Loading…' not to match /Loading/`
  and `expected 'OrderLoading…BackConfirm' not to match /Loading/`. After the
  fix, all three files pass (110 tests).

  **Not done: walking every route on a preview** (Done-means item 1). This
  sweep cannot push, so there was no preview to walk. The wall stands in for
  that walk on the one claim it verifies: no component renders the word. It
  checks that statically on every lint, which a single walk cannot.
- **Decision (2026-09-25 overnight sweep):** the rule is Mitchell's on the
  trip board: *"dont even have the loading state. KEep it simple."* It is
  applied as chrome-or-nothing, with no skeletons and no timers.
  - `PageScreen` renders nothing rather than its chrome. The breadcrumb's
    first crumb is the trip's name, and every button there acts on a page
    that has not loaded, so a first frame of that chrome would itself be a
    placeholder.
  - The Plans order card and the token trip picker keep the chrome that
    stands on its own: a heading, and the scope sentence.

  Rejected:
  - Shaped skeletons per route, which Done-means item 1 asks for "where a
    route keeps a client read". That trade belongs to KI-2026-09-20-f, which
    may remove the window altogether, and the owner's later call was for no
    loading state.
  - A 200ms gate. It was already tried and reverted.
  - The entry's narrower regex. It misses `Loading your trips…`.

  Left as is: `PlansScreen`'s *"Working out what this costs…"*. It is a
  sentence about the work under way, not the bare word, and neither the
  entry nor the wall covers it.
