### KI-2026-09-20-e — four surfaces still answer a slow read with a bare `Loading…`, which link 7's own survey missed

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

- **What it would take:** the pieces already exist — `Skeleton`, `SkeletonRegion`
  and `RegionError` in `ui/skeleton.tsx`, and `HomeSkeletons.tsx` as the worked
  example. The trip board is the one that earns it first, being the most-opened
  surface in the app; its shape is the header, the view tabs, the day chips and
  the board columns.

- **Deliberately not done in PR #196.** That PR is 163 files trying to land. New
  placeholder UI for four surfaces is milestone work with its own red-first
  tests, not cleanup, and adding it is how the branch reached 163 files in the
  first place.
