# M49 — A cover can come from anywhere, and be framed where you want it

**Status:** **Waits for M51 from 2026-10-20** (Mitchell: M51 goes ahead of M49; nothing here has started). **Proposed 2026-10-12, placed after M48 and before M43 and M44. Not scoped yet**:
decisions 1–3 were answered by Mitchell when it was minted; the rest are recommendations and none
has been answered. Minted on Mitchell's ask the same day (see `docs/milestones/README.md`,
*2026-10-12 — reordered and minted*).

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
   from it. It does not copy the image into its own storage. *(Read from "we shouldnt assume upload
   and store, but also including a url of a image to reference"; confirm at scoping.)*
3. **Reposition ships in both places**: as a field on the API, and as a drag in the UI on Unsplash
   covers.

**Open (recommendations; none answered):**

4. **How a browser loads a URL cover**, given the CSP admits only Unsplash. *Recommended:* through
   a pass-through route on Caesura's own origin that fetches the image and streams it back, with
   CDN cache headers and nothing written to storage. The CSP stays as it is, a viewer's IP and
   referrer never reach a third-party host, and the route can refuse a non-image. The alternative
   is to widen `img-src` to `https:`. It is cheaper, but any editor could then place a tracking
   pixel in front of everyone on the trip, including share-link viewers.
5. **What setting a URL cover checks.** *Recommended:* `https` only; one fetch at set time, which
   must answer `image/*` under a size cap; the SSRF guard any server-side fetch of a user URL needs
   (no private, loopback or link-local addresses, a bounded number of redirects). A URL that fails
   is a 422 with a reason, and nothing is saved.
6. **The contract shape.** *Recommended:* `TripCover` becomes a union on `source`:
   `"unsplash"` (today's fields) or `"url"` (`url`, optional `alt`, optional
   `credit: { name, url? }`). Both carry `position`. That means a `trip_covers` migration making the
   Unsplash columns nullable, a `docs/contracts/CHANGELOG.md` entry and a public API minor version.
   Unsplash's attribution rules keep applying to Unsplash covers only.
7. **A link that dies.** *Recommended:* the cover falls back to the designed no-cover state when
   the image fails to load. Nothing re-checks URLs in the background.
8. **The API surface.** *Recommended:* `GET`, `PUT` and `DELETE /v1/trips/{tripId}/cover`, with
   `PUT` taking `{ url, alt?, credit?, position? }`, and `PATCH` taking `{ position }` alone. The
   caller's token needs write access to the trip, and an editor is the minimum role, as in the app.
   **No Unsplash search on the API**: the caller finds images itself, and a search would spend
   Caesura's Unsplash quota on another program's behalf. Playbook-day covers stay off the API.
9. **The reposition field.** *Recommended:* one vertical position, `0–100`, default `50` (today's
   crop), rendered as `object-position: center <y>%` wherever the cover shows (the trip band, the
   Home card, the playbook day). A new photo resets it to `50`. Horizontal position is left out
   until a surface needs it.
10. **The reposition control.** *Recommended:* Notion's pattern on the band itself: *Reposition*,
    drag up or down, then *Save* or *Cancel*. Arrow keys move it, and a touch drag works on the
    phone. It is the same control for every cover, so a URL cover can be repositioned in the UI
    too, though only the API can set one.

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
      API version.
- [ ] **A cover set through `PUT /v1/trips/{tripId}/cover` from an image URL shows on the trip page
      and the Home card**, and `GET` returns it. An integration test drives the route with a token.
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
