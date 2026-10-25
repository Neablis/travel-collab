# M49 — A cover can come from anywhere, and be framed where you want it

**Status:** **Scoped 2026-10-25 with Mitchell; current milestone.** Decisions 4–10 were answered
as recommended and decision 2 was confirmed at scoping (2026-10-25). The design is ADR-081, and the
plan is `docs/plans/2026-10-25-M49-covers-from-anywhere.md` (deleted at gate close). Proposed
2026-10-12 and minted on Mitchell's ask (see `docs/milestones/README.md`, *2026-10-12 — reordered
and minted*). It waited for M51 and then M52, both closed.

## Why this exists

M37 gave trips and playbook days covers, but only from Unsplash, and only from the app:

- **The public API cannot touch a cover.** `trips/[tripId]/cover` and its search are marked
  `PLANNED("Undecided …")` in `apps/web/src/server/public-api/exposure.ts`. Mitchell, 2026-10-12:
  *"Allowing the api to set a header image so i can use the api to find and add images to trips
  in the future."* The finding happens outside Caesura; the API only has to accept the result.
- **A cover can only be an Unsplash photo.** `trip_covers` requires an Unsplash id and a
  photographer (`apps/web/src/server/db/schema.ts`), the server accepts only
  `images.unsplash.com`, and the page's CSP admits no other image host (`apps/web/next.config.ts`).
- **A cover is always centre-cropped.** The trip page's band fades over its bottom third, so a
  photo whose subject sits low loses it. Mitchell, 2026-10-10: *"i want to do the adjusted photo
  crop like notion option later"*.

Candidates absorbed (each deleted by this gate):
- *Reposition a cover: drag the photo to choose what the band shows* (2026-10-10)

## Decisions

**Answered by Mitchell, 2026-10-12:**

1. **A cover can come from any image URL**, not only Unsplash.
2. **A URL cover is referenced, not uploaded and stored.** Caesura keeps the URL and shows the image
   from it, and never copies the image into its own storage. **Confirmed at scoping, 2026-10-25:**
   the proxy (decision 4) caches at the CDN and writes nothing to blob storage.
3. **Reposition ships in both places**: as a field on the API, and as a drag in the UI.

**Answered by Mitchell at scoping, 2026-10-25, each as recommended:**

4. **A browser loads a URL cover through a pass-through route on Caesura's own origin.** The route
   fetches the image and streams it back with CDN cache headers, writing nothing to storage. The
   CSP's `img-src` stays as it is, and a viewer's IP and referrer never reach a third-party host.
   The route serves only URLs Caesura itself signed when it serialized a cover, so it is not an
   open proxy (ADR-081).
5. **Setting a URL cover checks it.** `https` only. One fetch at set time must answer `image/*`
   under a size cap. An SSRF guard refuses private, loopback and link-local addresses on every
   hop and allows at most 3 redirects. A URL that fails is a 422 with the new error code
   `cover-url-rejected` and a reason, and nothing is saved. The proxy applies the same guard on
   every fetch.
6. **`TripCover` becomes a union on `source`.** It is either `"unsplash"` (today's fields) or
   `"url"` (`url`, optional `alt`, optional `credit: { name, url? }`), and both carry `position`.
   Migration `0068` makes the Unsplash columns nullable and adds `source`, `url`, `credit_name`,
   `credit_url` and `position` to `trip_covers` and `saved_day_covers`. Existing rows read as
   `source: "unsplash"`, `position: 50`. It is recorded in a `docs/contracts/CHANGELOG.md` entry, as
   public API **1.27.0**. Unsplash's attribution rules keep applying to Unsplash covers only.
7. **A dead link falls back** to the designed no-cover state when the image fails to load
   (`onError` on `CoverImage`, which today has none, so a broken Unsplash image is fixed too).
   Nothing re-checks URLs in the background.
8. **The API surface** is `GET`, `PUT` and `DELETE /v1/trips/{tripId}/cover`, with `PUT` taking
   `{ url, alt?, credit?, position? }`, and `PATCH` taking `{ position }` alone. The token needs
   `trips:write`, and an editor is the minimum role, as in the app. **No Unsplash search on the
   API**: `exposure.ts` marks the search route `never`. Playbook-day covers stay off the API.
9. **`position` is one vertical value**, `0–100`, default `50` (today's crop). It renders as
   `object-position: center <y>%` in `CoverImage`, so the trip band, the Home card, the Home hero
   (`NextTripHero`) and the playbook day all follow. A new photo resets it to `50`. Playbook-day
   covers carry the column too, so the shared row types line up. Horizontal position is left out
   until a surface needs it.
10. **The control is Notion's pattern on the band.** An editor hovering the band sees *Reposition*
    beside *Change cover*. Clicking it shows *Drag image to reposition*, with a grab cursor. A mouse
    or touch drag moves the photo vertically, live. `↑`/`↓` move it 1%, and with `Shift` 10%.
    *Save position* (or `Enter`) saves it, and *Cancel* (or `Esc`) reverts. It is the same control
    for every cover, so a URL cover can be repositioned in the UI too, though only the API can set
    one. The band is desktop-only today, so a phone has no reposition.

## Scope

- The URL cover: the contract union, the migration, the set-time check, how browsers load it,
  rendering and the broken-link fallback.
- `/v1/trips/{tripId}/cover` on the public API, its OpenAPI entry and the exposure-list change.
- `position` on the cover, in the API and as the band's drag control.

## Out of scope

- Uploading an image file, or copying a URL's image into Caesura's storage.
- A URL field in the app's cover picker. The app keeps picking from Unsplash; a URL cover comes
  from the API.
- Unsplash search on the public API, and playbook-day covers on the API.

## Exit gate

- [ ] **Decisions 4–10 are answered and recorded here**, with the contracts changelog entry and the
      API version. *(Answered and recorded 2026-10-25 with ADR-081. The changelog entry and 1.27.0
      land with part 3, so the box is ticked then.)*
- [ ] **A cover set through `PUT /v1/trips/{tripId}/cover` from an image URL shows on the trip page,
      the Home card and the Home hero**, and `GET` returns it. An integration test drives the route with a token.
- [ ] **A URL that is not an image, or that points at a private address, is refused and nothing is
      saved.** Each case has a test that was seen red.
- [ ] **No third-party host is sent a viewer's request for a URL cover** (or, if decision 4 goes the
      other way, the CSP change is tested the way `next.config.test.ts` tests Unsplash today).
- [ ] **An existing Unsplash cover reads unchanged after the migration**, and its credit still
      renders.
- [ ] **Reposition persists**: a dragged position survives a reload and shows on every surface the
      cover appears on, and `PATCH` with `{ position }` moves it. Its unit test was seen red with
      the `object-position` removed.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: reposition a cover by mouse
      and by keyboard, reload, and see it held.
- [ ] **[walk]** On the PR preview, a cover set by `curl` with an API token appears on the trip, and
      an Unsplash cover is repositioned from the band.
- [ ] A retro is appended at gate close.
