# ADR-007: Maps and geocoding as bought commodity, behind a server-side seam

**Status:** Accepted — 2026-07-09
**Deciders:** Mitchell (product/eng), Claude (architect)
**Refines:** ADR-002's one-line maps note ("MapLibre GL + OpenStreetMap/
Protomaps tiles") — which named no geocoding provider and no seam.

## Context

M3's map view needs two commodity capabilities the foundation says to *buy*,
not build (foundation §1): rendering a map, and turning user-typed place names
into coordinates. Constraints from ADR-002 still bind: solo developer + AI
agents, free/hobby-tier operating cost, and the architecture's purity rules —
`packages/domain` does no I/O (Invariant 4), and only `apps/web/src/server` may
perform network calls.

A vendor survey (2026-07-09) established the decisive constraint for
geocoding: **we persist geocoded results** (`lat/lng` + canonical name in
Postgres, rendered later), and several free tiers **forbid storing results**
(MapTiler, Mapbox's temporary API) or are non-commercial-only (Stadia). That
eliminates the otherwise-convenient single-vendor bundles. For tiles, the
cheapest viable path is keyless and uncapped (OpenFreeMap) or self-hosted with
no per-request cost (Protomaps PMTiles).

The architectural question is not only *which vendor* but *where geocoding
lives*. It must not leak into the pure domain, and it must be swappable, since
any free-tier vendor is a availability/terms risk.

## Decision

**Buy both; confine geocoding to a server-internal seam; keep tiles a UI
concern.**

- **Boundary — geocoding is pre-command enrichment, not a domain operation.**
  The server resolves a place name to a `Location` *before* issuing the
  ordinary `AddActivity`/`UpdateActivity` command. The pure domain only ever
  stores coordinates it is handed. Unlike `AccessPolicy` (which the command
  pipeline calls), the `Geocoder` port is **server-internal**
  (`apps/web/src/server/geocoding/`); the domain has no knowledge of it.

  ```ts
  interface GeocodeResult { lat: number; lng: number; canonicalName: string; countryCode?: string; }
  interface Geocoder { forward(query: string, opts?: { limit?: number }): Promise<GeocodeResult[]>; }
  ```

  Vendor-specific concerns (key, base URL, response mapping, attribution) live
  entirely inside each adapter. We store the **normalized** `GeocodeResult`,
  never raw vendor payloads — so a provider switch is zero data-migration.

- **Geocoding provider: LocationIQ.** 5k requests/day free, terms permit
  storing results, OSM-based. Implemented as `LocationIQGeocoder` behind the
  port; env `LOCATIONIQ_API_KEY`. Resolve-on-submit in M3 (no autocomplete).

- **Tiles: OpenFreeMap.** Keyless, no request cap, ready-made MapLibre style
  JSONs. A UI concern only — a style URL in the MapLibre component; OSM
  attribution rendered. No server or contract impact.

## Consequences

- Purity intact: no I/O in `packages/domain`; the only new network calls in M3
  are the geocoding adapter and are contained in `src/server`.
- Both choices are low-stakes and reversible: geocoding swaps behind the port
  (one wiring line), tiles swap by changing a style URL. The designed escape
  hatch for tiles if OpenFreeMap's donation-funded uptime disappoints is
  Protomaps PMTiles on Vercel Blob — still a MapLibre style URL, no code
  reshaping.
- `Location` gains an optional `countryCode` (populated by the geocoder,
  forward-useful for the future `publicHoliday` anchor); additive, non-breaking.
- We accept two free-tier operational risks — LocationIQ's daily cap and
  OpenFreeMap's best-effort availability — as acceptable at hobby scale, with
  named upgrade/replace paths rather than lock-in.
- ADR-002's maps line is now superseded by this ADR for the specifics
  (provider names, the seam); ADR-002 remains the record of the original
  direction.
