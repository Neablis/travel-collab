# M49 plan — A cover can come from anywhere, and be framed where you want it

Staged while M49 is in flight; deleted in the gate-close commit. Decisions: the milestone file.
Design: ADR-081. Paths are relative to the repo root; `web/` means `apps/web/src/`.

**Order.** Part 1 merges first. Parts 2 and 4 then branch from `main` and run in parallel. Part 3
branches from `main` once part 2 has merged. Part 0 (`claude/cool-goodall-p53ykz`, prose only)
merges last.

| Part | Branch | Theme | Waits on |
|---|---|---|---|
| 1 | `claude/m49-part1-cover-union` | The union, `position`, migration 0068, rendering | — |
| 2 | `claude/m49-part2-guarded-proxy` | The guarded fetcher, the signed proxy, setting from a URL | 1 |
| 3 | `claude/m49-part3-public-api-cover` | `/v1/trips/{tripId}/cover`, the next minor | 2 |
| 4 | `claude/m49-part4-reposition-band` | Reposition on the band, the e2e spec | 1 |

## Part 1 — the cover becomes a union, and carries a position

`TripCover` becomes `{ source: "unsplash", …today's fields, position } | { source: "url", url,
alt?, credit?: { name, url? }, position, proxySrc? }`. `proxySrc` is the signed same-origin path
that part 2 mints; until then, a URL cover with no `proxySrc` renders the fallback. Migration 0068
covers both cover tables. `CoverImage` renders `object-position` and falls back on `onError`.
Picking a new Unsplash photo resets `position` to 50. `TripCover` already appears in the published
document (`DiscoverDay.cover`, `TripSummary.cover`), so this part ships the union as public API
a minor version (**1.28.0**, since main took 1.27.0 for a zod 4 fix while part 1 was in review) with
its `docs/contracts/CHANGELOG.md` entry; part 3's endpoint is the next minor after whatever main
carries when it merges (found by the first builder, 2026-10-25). `setTripCoverPosition(tripId, position)` lands
here so that parts 3 and 4 share it.

| File | Entry point | Test |
|---|---|---|
| `packages/contracts/src/cover.ts` | `TripCover`, `CoverPosition`, `CoverCredit` (new), `SetCoverPositionBody` (new) | `packages/contracts/test/cover.test.ts` |
| `apps/web/drizzle/0068_cover_source_position.sql` (+ `meta/`) | from `db:generate`; check constraint per source | — |
| `web/server/db/schema.ts` | `tripCovers` (:656), `savedDayCovers` (:1144) | — |
| `web/server/coverRows.ts` | `coverJson`, `coverOf`, `storedCover`, `coverValues` | `web/app/api/trips/[tripId]/cover/route.int.test.ts` (an existing Unsplash row reads unchanged, with `position: 50`) |
| `web/server/tripCovers.ts` | `setTripCover`, new `setTripCoverPosition` | same |
| `web/server/savedDayCovers.ts` | writes the new columns' defaults | `web/app/api/saved-days/[savedDayId]/cover/route.int.test.ts` |
| `web/server/coverRoutes.ts` | pick resets position to 50 (:93-122) | trip cover `route.int.test.ts` |
| `web/components/cover/CoverImage.tsx` | `object-position`, `onError` fallback, URL source (one `src`, no srcset) | `CoverImage.test.tsx` (seen red with `object-position` removed) |
| `web/components/cover/CoverCredit.tsx` | a `credit` branch for URL covers; Unsplash wording unchanged | `CoverCredit.test.tsx` |
| `packages/contracts/src/trip.ts`, `web/lib/sharedDayView.ts` | follow the union | typecheck |

**Preview:** an existing trip's Unsplash cover looks the same, with the same credit, on the band,
the Home card and the hero. Change the cover, and it still saves.

## Part 2 — a guarded fetcher, a signed proxy, and setting a cover from a URL

ADR-081 items 3 and 4. This is the most security-sensitive part, and it gets the extra fresh review.

| File | Entry point | Test |
|---|---|---|
| `web/server/external/remoteImage/guard.ts` | `assertPublicAddress(host)`: resolves and refuses private, loopback, link-local, CGNAT, multicast, unspecified and v4-mapped v6 | `guard.test.ts` (one case per range, each seen red) |
| `web/server/external/remoteImage/fetchImage.ts` | `fetchRemoteImage(url, { maxBytes, maxRedirects: 3, timeoutMs })`: https only, manual redirects re-checked per hop, `image/*` and no SVG, byte cap while streaming | `fetchImage.test.ts` (fake `fetch` and resolver, no network) |
| `web/server/coverProxy.ts` | `signCoverUrl(url)` / `verifyCoverUrl(url, sig)` (HMAC-SHA256, `COVER_PROXY_SECRET`) | `coverProxy.test.ts` |
| `web/server/env*` (wherever server secrets are read) | `COVER_PROXY_SECRET`, with a dev default outside production | existing env test |
| `web/app/api/cover-image/route.ts` | `GET ?u=&s=`: 403 on a bad signature, 502 on a guard refusal, else stream with cache headers | `route.test.ts` |
| `web/server/coverRows.ts` | mints `proxySrc` for `source: "url"` covers | the trip cover `route.int.test.ts` |
| `web/server/tripCovers.ts` | `setTripCoverFromUrl(tripId, { url, alt?, credit?, position? }, by)`: fetch-check, then upsert; a refusal throws a typed rejection carrying the reason | `tripCovers.int.test.ts` (non-image, private address and too large each refused with nothing saved) |

**Preview:** nothing changes visibly. `curl <preview>/api/cover-image?u=https://example.com/x.jpg`
without `s` answers 403.

## Part 3 — the public API sets, reads, moves and clears a trip's cover

| File | Entry point | Test |
|---|---|---|
| `web/app/api/v1/trips/[tripId]/cover/route.ts` | `GET` (viewer), `PUT`, `PATCH { position }` and `DELETE` (editor, `trips:write`) via `route()` (copy `v1/trips/[tripId]/pages/[pageId]/route.ts`) | `web/server/public-api/cover.int.test.ts` (drives the route with a token: PUT then GET; a non-image and a private address each 422 with nothing saved; PATCH moves the position; DELETE clears it) |
| `web/server/public-api/exposure.ts` | `:103` → `public`, `v1`; `:104` search → `never` with `reaches` | `conformance.test.ts` |
| `packages/contracts/src/publicApi.ts` | `ApiErrorCode` gains `cover-url-rejected` | contract test |
| `web/server/public-api/openapi.ts` | `API_VERSION` = the next minor over main's, fingerprint; `pnpm --filter web openapi:generate` | `openapi.test.ts` |
| `docs/contracts/CHANGELOG.md` | the endpoint and the error code, the next minor (the union's entry, 1.28.0, landed with part 1) | — |
| `docs/guidelines/using-the-api.md` | the cover endpoint in the endpoint list, if it keeps one | — |

**Preview:** with an API token, `curl -X PUT …/v1/trips/<id>/cover -d '{"url":"https://…jpg"}'`.
The cover shows on the trip band, the Home card and the hero, and the image request goes to the
preview's own `/api/cover-image`. A `credit` shows its name.

## Part 4 — Reposition on the band

Decision 10's interaction model, in full: hover (editor) → *Reposition* beside *Change cover* →
*Drag image to reposition* with a grab cursor. Mouse or touch drag moves it vertically, live.
`↑`/`↓` move it 1%, `Shift` 10%. *Save position*/`Enter` sends the PATCH, and *Cancel*/`Esc` reverts.
It is desktop only, as the band is.

| File | Entry point | Test |
|---|---|---|
| `web/components/trip/cover/RepositionCover.tsx` (new) | the drag/keyboard state, mapped to a 0–100 position | `RepositionCover.test.tsx` |
| `web/components/trip/cover/TripCoverBanner.tsx` | the *Reposition* button and mode (:67-95) | `TripHeader.cover.test.tsx` / `CoverSection.test.tsx` |
| `web/app/api/trips/[tripId]/cover/route.ts` | `PATCH { position }` (editor), calling `setTripCoverPosition` | its `route.int.test.ts` |
| `web/mocks/handlers.ts` | the PATCH handler, if the cover routes are mocked there | — |
| `apps/web/e2e/m49-cover-reposition.spec.ts` (new) | reposition by mouse and by keyboard, reload, see it held (copy setup from `m37-trip-covers.spec.ts`) | the spec itself, on `test:e2e:ci-like` |

**Preview:** on a trip with a cover, hover the band, click *Reposition*, drag the photo down, then
*Save position*. Reload: it holds, and the Home card and hero show the same framing. Repeat with
the arrow keys and `Esc` to see Cancel revert.

## Gate box → part

| Box | Part |
|---|---|
| Decisions, changelog and API version | 0 + 3 |
| PUT from a URL shows on the trip, Home card and hero; GET returns it; integration test with a token | 2 + 3 |
| Non-image and private address refused, nothing saved, each seen red | 2 (+ 3 at the API) |
| No third-party host sees a viewer's request | 2 (the proxy) + 3 (the rendered `src` is same-origin) |
| An existing Unsplash cover reads unchanged and keeps its credit | 1 |
| Reposition persists on every surface; PATCH moves it; unit test seen red | 1 + 3 + 4 |
| The e2e spec passes on ci-like | 4 |
| [walk] | Mitchell, on the parts' previews |
| Retro | 0 |
