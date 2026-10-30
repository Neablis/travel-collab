### KI-2026-10-30-p — Two paths still store a stop's whole address as its name

- **Severity:** cosmetic (no wrong place or coordinate: the stop's title is its address, the
  defect Mitchell reported on the assistant's place cards).
- **Area:** `apps/web/src/server/ai/geocodeEnrichment.ts` (`resolveOne`, `found.name`),
  `apps/web/src/components/board/LocationInput.tsx` (`pick`, and the result row's label).
- **Symptom / What happens:** a stop is stored with `Location.name` set to LocationIQ's full
  `display_name`, e.g. "Cochon, 930, Tchoupitoulas Street, Warehouse District, New Orleans,
  Orleans Parish, Louisiana, 70130, USA" rather than "Cochon", on two paths:
  - a stop the assistant adds **without** a `placeRef` goes through geocode enrichment, which
    replaces the model's name with `match.canonicalName`;
  - a stop picked in the board's location input stores `r.canonicalName`, and the result list
    labels each row with it too.
  PR 649 fixed the cited-candidate path only (`search_places` → card → `placeRef`).
- **Why not fixed here:** PR 649 was a server mapping fix. `LocationInput` is a client change
  with its own row rendering and e2e surface; `/api/geocode` already returns `name`, so that fix
  is client-only (`r.name ?? r.canonicalName`, with the address as the row's second line).
  Enrichment starts from the model's own name, so whether to keep that or take the vendor's
  `name` is its own decision, with its own tests in `geocodeEnrichment.test.ts`.
- **Cross-reference:** M56 part 11 (PR 649) and its review, finding 2; `ownNameOf` in
  `apps/web/src/server/geocoding/locationiq.ts` is the one rule for what a `display_name` names.
- **First noted:** 2026-10-30, review of PR 649.
