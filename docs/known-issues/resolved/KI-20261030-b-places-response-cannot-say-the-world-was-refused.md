### KI-2026-10-30-b — `/api/places` answers a refused world search the same as one with no world results — RESOLVED

- **Severity:** wrong wording risk on New trip's Where page; no wrong data.
- **Area:** `apps/web/src/server/places.ts` (`worldPlaces`), `apps/web/src/lib/cities.ts`
  (`PlaceSearchResponse`), `apps/web/src/app/api/places/route.ts`.
- **Symptom / What happens:** with `world=1`, an account past its daily world quota, the global
  cap, a vendor failure and a vendor answer with nothing new all return 200 with the library rows
  only. A client cannot tell "no such place" from "the world was not asked", so the Where page
  could tell someone over their quota that a real place does not exist.
- **Why not fixed here:** D3 asks for no more than the fallback, and the only consumer that
  would read the difference is part 2's Where page, which was not on PR 639's branch; the review
  (finding 12) judged it fine to defer to part 2 if recorded.
- **Fix path / Tripwire:** a `worldLimited: true` on `PlaceSearchResponse` when the world was
  asked and not answered (wrap `charge` to record a refusal; treat `readThrough`'s `null` after a
  charge as a failure), and the Where page words that case as "only places with Playbooks right
  now". Tripwire: part 2's Where page shows an empty or "no match" state for a world search.
- **Cross-reference:** M56 plan § Part 2 and § Part 3; review of PR 639, finding 12.
- **First noted:** 2026-10-30, review of PR 639.
- **Resolved 2026-11-14** (overnight KI sweep). `PlaceSearchResponse` (`apps/web/src/lib/cities.ts`)
  gains `worldLimited: true`, set by `searchPlaces` when `worldPlaces` returns `null`: that is
  exactly when `readThrough` had nothing to serve after the world was asked (the quota refused, a
  back-off, a failed or timed-out call) or the cache table threw. A vendor answer with nothing new
  leaves it absent. The client reads it through a new `searchPlacesWithWorld` (`apiClient.ts`;
  `searchPlaces` is library-only again, for Discover), and the Where page words an empty list as
  "Only places with Playbooks can be searched right now, and none matches …" and a non-empty one
  with "Only places with Playbooks right now." Proven in `places/route.int.test.ts` (the over-quota
  test now asserts `worldLimited`, plus *says the world was not answered when the vendor fails,
  and not when it answers with nothing*), which failed before the change with `expected undefined
  to be true` and `expected { status: 200, places: [] } to deeply equal { …, …(1) }`, and in
  `NewTripWizard.test.tsx` (*says only places with Playbooks were searched…*), red with the
  wizard's `limited` forced to `false`. Not covered: a signed-in `world=1` request on a deployment
  with no vendor configured (`worldSearchFor` returns `null`) still answers without the flag.
