### KI-2026-09-20-f — every route fetches its own data client-side, so every route has a gap where the page is not there yet

- **Severity:** invisible on a fast connection, a blank or near-blank screen on
  a slow one, on every route in the app. Not a correctness defect. (As found.)
- **Area:** all of `apps/web/src/app/(app)/**/page.tsx` and
  `apps/web/src/app/(front)/**/page.tsx`, and the screen each one mounts.

- **Symptom / What happens:** a route page renders, mounts a client screen, and
  *that* screen starts the network read. So between navigation and content there
  is always a frame or many in which the route is mounted and has nothing to
  show. Each screen then invents its own answer for that window — a bare
  `Loading…`, a skeleton, or nothing — and they do not agree with each other.

- **Measured, 2026-09-20** (`find app -name page.tsx`, then what each mounts):
  **16 route pages under `(app)` and `(front)`; 14 mount a client screen that
  fetches its own data; exactly one — `app/(app)/page.tsx`, Home — does any
  server-side reading at all.** `app/(app)/trips/[tripId]/page.tsx` is typical
  and is the clearest case: it is already an `async` server component, it
  `await`s `params`, and it fetches nothing.

- **How it was found:** Mitchell, 2026-09-20, after the trip-board flicker fix
  (KI-2026-09-20-e): *"Doesnt react now support a concept called Suspense? That
  would give you this for free?"* — asked about one surface, and the survey
  above is what the question turned up.

- **Suspense alone does NOT fix this, and that matters for whoever picks it up.**
  `<Suspense>` takes `children` and `fallback`; there is no delay or debounce
  prop, and the `SuspenseConfig` / `useTransition({ timeoutMs })` that once
  offered one was removed before the stable release. More importantly a boundary
  here would do *nothing at all today*: these screens read in `useEffect` and
  store in `useState`, which never suspends. The repo's existing boundaries say
  as much — `app/(app)/plans/page.tsx:13`: *"The Suspense boundary is Next's
  requirement, not a loading state."*

- **What actually fixes it:** move the route's first read into the server
  component that already exists, and pass it down as initial data. Then there is
  no client loading state to design, because there is no window in which the
  route is mounted without its data. App Router `<Link>` navigation is a
  transition, so React holds **the previous page** on screen until the next one
  is ready — no spinner, no skeleton, and no blank screen either, which is
  strictly better than any of the three answers the 14 screens currently give.

- **What must NOT move, and this is the easy mistake:** reads triggered by an
  interaction rather than by arriving — `CitySearch`, `AddToTripDialog`,
  `SavedDaysDialog`, `KeepDayDialog`, `TravelersPanel`, `ShareButton`,
  `TokensSection`'s trip list. Those are correctly client-side and correctly
  effect-driven; a dialog that fetches when it opens has no server render to
  attach to. The line is *"does this read decide whether the route paints"*, not
  *"is this a fetch"*.

- **What it would cost, on the hardest one.** `TripProvider` is not just the
  read: it owns optimistic state, command dispatch, undo/redo/revert,
  `fetchTripDetailAt` for history scrubbing, and the `cachedRead` dedupe window
  with its command-triggered invalidations. Server-fetching the first read means
  threading it in and keeping that client cache coherent with it — including the
  5s `DEDUPE.NAVIGATION` window, which exists precisely because with no polling
  and no socket, remounting is how you find out a co-traveller edited the trip
  (`TripProvider.tsx:110-117`). Start somewhere smaller.

- **Relationship to KI-2026-09-20-e.** That entry lists four surfaces still
  answering a slow read with a bare `Loading…` and proposes link 7's skeleton for
  them. This entry is the reason to consider doing neither: a skeleton is a
  well-designed answer to a question this app does not have to ask. Whoever picks
  up either should read both and decide once.

- **Deliberately not in PR #196.** That PR is 163 files trying to land, and this
  is an architecture change across 14 routes with its own test surface.
