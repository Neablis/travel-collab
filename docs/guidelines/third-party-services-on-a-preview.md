# Third-party services, checked by hand on a preview

**No automated test talks to a real third party** — not unit, not integration,
not e2e (Mitchell, 2026-09-24). A test that depends on somebody else's service
fails when that service is slow, down, rate-limited or unreachable from where
the test runs, and it sends our test traffic to them. So every third-party
dependency gets two things instead:

1. **A common-sense placeholder** in the UI for when the service's data cannot
   load, covered by a test that **stubs** the service — never calls it.
2. **A manual check on a Vercel preview**, written down below, that confirms the
   real service works in the real deployed environment (real CSP, real keys,
   real network).

This file is the home for part 2. **Add a section here when a feature starts
depending on a third-party service**, in the same shape: what it depends on,
what the automated tests stub instead, and a short numbered check.

How to reach a preview (Deployment Protection, signing in, driving it from a
cloud container with `pnpm --filter web walk:preview`) is in
`environments-and-deploys.md` → *Testing against a preview deployment*. Record
what you checked, on which preview URL, in the PR — "the map works" without
the URL is not a check anybody can rely on.

## Map tiles — `tiles.openfreemap.org`

**Depends on:** the basemap style, tiles, glyphs and sprites that the Map lens
(`MapLens.tsx`) and the shared day map (`SharedDayMap.tsx`) load from
`tiles.openfreemap.org` (`STYLE_URL` in `src/components/lenses/mapBootstrap.ts`).
The CSP in `next.config.ts` allows that host in `connect-src` and `img-src`.

**What the automated tests do instead:** the e2e map specs serve a
background-only style from `apps/web/e2e/fixtures/map-style.json` at the real
URL (`e2e/fixtures/mapTiles.ts`) and assert no request left for a third party.
One spec blocks the host and asserts the placeholder, *"The map could not
load"* (`MapOfflineState`). A plain, featureless background in a local run is
the fixture working — it says nothing about the real tiles.

**Manual check:**

1. Open the PR's preview and sign in. Open a trip whose days have **located
   stops** (the seeded demo trip has them; a trip you create needs stops with
   a place picked).
2. Open the **Map** lens. Confirm a real basemap draws — coastlines, roads,
   place labels — under the day's pins and route lines, and the
   `MapLibre | OpenFreeMap © OpenMapTiles` attribution is in the corner.
3. Open a **shared day** with at least one located stop
   (`/playbooks/day/<savedDayId>`, reached from Playbooks). Confirm the same
   basemap draws under its numbered pins.
4. With DevTools open on both pages, confirm the **Console has no
   Content-Security-Policy errors** (`Refused to connect…`, `Refused to load
   the image…`) and the Network tab shows the style, tiles and glyphs from
   `tiles.openfreemap.org` returning 200.

A blank or paper-coloured canvas is a failure, not a pass. If screenshots of
the canvas come back blank, look at the page itself rather than the capture
(KI-49 records a screenshot pipeline that could not capture WebGL).
