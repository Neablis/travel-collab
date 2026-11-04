### KI-2026-11-04 — a location marked `verified: false` shows as unconfirmed only on the trip's Map lens

- **Severity:** cosmetic, and a little more for the assistant. Nothing is wrong. The fact is shown in one
  place and quietly dropped in the others.
- **Area:**
  - `apps/web/src/server/invitePreview.ts`, `placeOf`: copies a location's map fields by name, so
    `verified` never reaches the invite preview's map.
  - The stop card and the activity editor (`apps/web/src/components/board/ActivityEditor.tsx` and the
    card that renders a stop's place): neither says the location is unconfirmed.
  - `apps/web/src/server/assistant/tools/read.ts`, the trip read the model gets: exposes `precision`
    but not `verified`, so the assistant cannot tell its own unconfirmed guesses from located stops.
  - `apps/web/src/components/playbooks/SharedDayMap.tsx`: the Playbook / shared-day map draws its own
    pins and ignores the flag.
  - Places that USE the coordinate as though it were confirmed (second review of PR 686, finding 3):
    `apps/web/src/lib/directions.ts` ("Get directions" goes to the guess), `apps/web/src/server/nearbyStops.ts`
    (other stops ranked by distance from it), and `tripRegionOf` in
    `apps/web/src/server/geocoding/region.ts` (the guess widens the trip's region for later lookups).
    The last is the one with a correctness edge: a wrong guess admits wrong answers near it.
- **Symptom / What happens:** PR 686 added `Location.verified: false` (Mitchell, 2026-11-03) for an
  assistant coordinate no geocoder confirmed. The trip's Map lens draws it as a hollow teardrop with a
  "Not confirmed" legend key. Everywhere else the same stop looks exactly like a confirmed one: a solid
  pin in the invite preview and on a shared day's map, no note on its card, and nothing in the read the
  assistant gets.
- **Why not fixed here:** scope. Mitchell, 2026-11-03: the map first, the other surfaces filed.
- **Fix path:** one surface at a time. Copy `verified` in `invitePreview.ts`'s `placeOf` (and draw it in
  that map), add it to `read.ts`'s location view with a line in the tool description, and give the card
  a short "Location not confirmed" note. Each needs a test that fails without it.
- **Tripwire:** a new surface that draws or describes a stop's location.
- **Cross-reference:** KI-2026-11-03, PR 686, `packages/contracts/src/activity.ts` (`verified`).
- **First noted:** 2026-11-04, from the PR 686 discussion.
