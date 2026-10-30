### KI-2026-10-30-c — a library place the vendor matches mid-name comes back as an unlabelled world row

- **Severity:** a duplicate shape on New trip's Where page; no wrong data.
- **Area:** `apps/web/src/server/places.ts` (`searchPlaces`, `notInLibrary`).
- **Symptom / What happens:** with `world=1`, typing `york` matches the vendor's "New York" by a
  word inside the name, but not the library's prefix index (`city ilike 'york%'`). The library
  row is absent, so `notInLibrary` has nothing to claim the world row with, and "New York" goes
  through as a world row with `hasPlaybooks: false`. Picking it commits a world id for a place
  the library holds. Typing `new york` gives the library row instead, so the same place reaches
  part 2 in two shapes depending on what was typed. The same JSDoc names two sibling misses
  (a different namesake ranked first; a city-state's city spending its country's claim).
- **Why not fixed here:** the fix is a second library query, an exact-name lookup over the world
  rows' names, not a change to the filter; part 2's Where page, the only consumer, is not on
  PR 639's branch, and the review (finding 2) judged a KI enough.
- **Fix path / Tripwire:** after the vendor answers, look the world rows' names up exactly in the
  library (`saved_days.cities && ARRAY[...]`, which the GIN index serves) and label or drop the
  ones it holds. Tripwire: part 2's Where page offers a place without its Playbooks label that it
  labels when typed in full.
- **Cross-reference:** M56 plan § Part 2 and § Part 3; review of PR 639 (first pass finding 10,
  re-review finding 2); KI-2026-10-30-b.
- **First noted:** 2026-10-30, review of PR 639.
