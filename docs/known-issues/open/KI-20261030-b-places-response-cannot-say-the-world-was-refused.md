### KI-2026-10-30-b — `/api/places` answers a refused world search the same as one with no world results

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
