# ADR-081: A cover from any URL, served through our own origin, and framed by one position

**Status:** **Accepted — 2026-10-25.** Mitchell answered M49's decisions 4–10 as recommended and
confirmed decision 2 at scoping.
**Deciders:** Mitchell (product); Claude — drafted
Related: ADR-041 (content bundles), M37 (covers from Unsplash), M22 (the public API), M49
(`docs/milestones/M49-covers-from-anywhere.md`).

## Context

A cover can only be an Unsplash photo today. `trip_covers` and `saved_day_covers` require an
Unsplash id and a photographer (`apps/web/src/server/db/schema.ts`). The server accepts only
`images.unsplash.com` (`server/external/unsplash/unsplash.ts`). The CSP's `img-src` admits Unsplash
and the map tiles and nothing else (`apps/web/next.config.ts`). Mitchell wants the public API to set
a cover from an image found anywhere, kept as a reference rather than a copy. He also wants the crop
to be repositionable, because the trip band fades over its bottom third.

No server code fetches a user-supplied URL today, so Caesura has no SSRF guard to reuse.

## Decision

1. **`TripCover` is a union on `source`.** It is either `"unsplash"` (today's fields, unchanged) or
   `"url"` (`url`, optional `alt`, optional `credit: { name, url? }`). Both carry `position`.
   `trip_covers` and `saved_day_covers` gain `source` (default `'unsplash'`), `url`, `credit_name`,
   `credit_url` and `position` (default `50`), and their Unsplash columns become nullable, in one
   migration. A check constraint holds each row to its source's required columns. Every row↔contract
   mapping stays in `server/coverRows.ts`.
2. **A URL cover is referenced, never stored.** Caesura keeps the URL. Nothing is written to blob
   storage.
3. **A browser reads a URL cover from Caesura's own origin.** `GET /api/cover-image?u=<url>&s=<sig>`
   fetches the image and streams it back with long `Cache-Control` / `CDN-Cache-Control` headers.
   `s` is an HMAC of `u`, minted on the server only when it serializes a `source: "url"` cover to a
   client. So the route serves only URLs a cover already holds, and nobody can use it as an open
   proxy or as a way to fetch an arbitrary URL. The CSP is unchanged. A viewer's IP, cookies and
   referrer never reach the third-party host, which therefore cannot plant a tracking pixel in front
   of a trip's members or its share-link viewers. The key is `COVER_PROXY_SECRET`, with a fixed
   development default outside production, as the other server secrets do.
4. **Every server fetch of a cover URL goes through one guarded fetcher**
   (`server/external/remoteImage/`). It enforces `https` only and resolves the host, refusing
   private, loopback, link-local, CGNAT, multicast and unspecified addresses (IPv4, IPv6 and
   IPv4-mapped). It follows redirects by hand (`redirect: "manual"`), at most 3, re-checking each
   hop. The response must be `image/*` (SVG refused, since it can carry script) and under 10 MB,
   counted while streaming rather than trusted from `Content-Length`, within a timeout. Setting a
   cover runs it once. A refusal is a 422 `cover-url-rejected` with the reason, and nothing is
   saved. The proxy runs it on every CDN miss, and a refusal there is a 502 that the browser shows
   as the fallback.
5. **A cover that fails to load shows the designed no-cover state** (`onError` on `CoverImage`).
   Nothing re-checks URLs in the background.
6. **`position` is one vertical value, 0–100, default 50.** `CoverImage` renders it as
   `object-position: center <y>%`, so every surface follows. Picking a new photo resets it to 50.
   A URL cover has no imgix `srcset`. It gets one `src` through the proxy.
7. **The public API exposes `/v1/trips/{tripId}/cover`**: `GET`, `PUT { url, alt?, credit?,
   position? }`, `PATCH { position }` and `DELETE`, behind `trips:write` and the editor role. Search
   is `never` on the API, because it would spend Caesura's Unsplash quota on another program's
   behalf. Playbook-day covers stay off the API. The union is 1.27.0, because `TripCover` is
   already in the published document, and the endpoint is 1.28.0, with the new error code
   `cover-url-rejected`.

## Consequences

- One more server secret, and one route that reaches the open internet. Its guard is the most
  security-sensitive code in M49 and gets the extra review pass.
- A CDN miss costs one upstream fetch. A source that goes away shows the no-cover state, and the
  cover is not cleared.
- The CSP test (`next.config.test.ts`) does not change. M49's gate proves the privacy property by
  showing the rendered `src` is same-origin instead.

## Rejected

- **Widening `img-src` to `https:`.** One line, but it hands any editor a tracking pixel in front of
  every viewer of the trip.
- **An unsigned proxy (`?u=` alone).** That is an open proxy, an SSRF amplifier and a bandwidth
  sink.
- **Keying the proxy by trip id.** That needs a per-request access check, which share-link and
  public views would each have to re-implement. The HMAC carries the authorization the serializer
  already decided.
- **Copying into blob storage.** It is out of scope by decision 2.
