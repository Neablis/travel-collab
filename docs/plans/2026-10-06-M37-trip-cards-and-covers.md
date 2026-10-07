# M37 — trip cards and covers: build plan

Gate: `docs/milestones/M37-trips-look-like-somewhere.md` § *Exit gate*. Decisions are numbered
there and cited here as D1–D6. Delete this file at M37's gate close (`docs/plans/README.md`).

## The stack

Five parts, each on its own branch, merged 1 → 5 with merge commits
(`docs/guidelines/stacked-prs.md`). All open as drafts. **Nothing merges without Mitchell.**

| Part | Branch | Theme | Tier |
|---|---|---|---|
| 1 | `ccr-0e9597fb-6iqsii` | M35 closed, M37 current, this plan | 1 (prose) |
| 2 | `ccr-0e9597fb-6iqsii-cards` | `TripSummary` gains `dayCount` and `stopCount`; card and hero get the empty state and the length | 2 |
| 3 | `ccr-0e9597fb-6iqsii-covers-server` | migration `0042` (`trip_covers`), the Unsplash port and its offline fake, search / pick / clear routes, `TripSummary.cover`, CSP, the import wall | 2 |
| 4 | `ccr-0e9597fb-6iqsii-covers-ui` | the picker in Trip settings; the cover and credit on card and hero; the e2e spec | 2 |
| 5 | `ccr-0e9597fb-6iqsii-playbook-covers` | covers on playbook days: the author picks one, the day page fades it into the title, Discover cards lead with it | 2, then 3 on the top |

**On the preview, what does a person click to see this?**
- Part 2: the home page. A new trip's card (or hero) is designed, and every card reads its length.
- Part 3: nothing (routes and a column, no screen), so its body says so.
- Part 4: Trip settings → Cover photo → search, pick. Home shows it.
- Part 5: on your own playbook day, *Add cover*. The day page and its Discover card show it.

## The design (approved before any UI is built)

The canvas is **https://claude.ai/artifact/655uQXn7esDDWjeAnnAxa1**. It has seven artboards:
home desktop, home with an empty trip, home on a phone, the cover picker, a playbook day on desktop
and phone, and Discover cards. Mitchell asked on 2026-10-06 to *"drawn out the design and let me
approve"*, and **approved it the same day** (*"designs approved"*). Parts 2, 4 and 5 build to
it.

The rules it sets:
- **The fade is the front door's veil.** The photo dissolves into the paper (or into the card's
  surface) where the words begin, and the title stands on the fade. A playbook day uses a
  full-bleed 440px cover (360px on a phone). Home's hero uses a 236px band; a card uses a 132px
  strip.
- **No cover, no change.** Every surface without a cover renders as it does today, or as part 2's
  card does.
- **The credit sits wherever the photo is**: *Photo by <name> on Unsplash*, both linked, on the
  card, the hero, the day page, the Discover card and the picker.
- **The empty trip is dashed, not blank.** It shows its dates (or *No dates yet*), *nothing
  planned*, and then, as links:
  - *Add the first day*;
  - *Invite who's coming* (owner and alone only);
  - *Choose a cover photo* (editors only).
  The hero version keeps the moss *Shape of the trip* panel, with dashed rows for the dated days.
- **A trip shared with you that is empty** says whose it is (*Sam hasn't planned anything yet*)
  and offers no actions.

## Unsplash's API guidelines (binding on parts 3–5)

Unsplash's production-access checklist, as Mitchell pasted it on 2026-10-06:

> - **Hotlink photos.** Photos must be hotlinked to the original image URL on Unsplash.
> - **Trigger downloads.** When a user in your application uses a photo, it triggers an event to
>   the download endpoint.
> - Your app does not use the Unsplash logo and is not named similarly to Unsplash.
> - Your app must look visually distinct from Unsplash and not use 'Unsplash' in the name.
> - The photographer's full name and Unsplash are properly attributed and linked (ex: *Photo by
>   Annie Spratt on Unsplash*).

The rules below implement it. Items 1, 2, 3 and 5 are the checklist's. The rest come from the API
documentation and the terms, as known when this was written: `unsplash.com` is unreachable from a
cloud session's proxy. **Mitchell added the Access Key on 2026-10-06.**
1. **Hotlink.** Images render from the `urls.*` Unsplash returns (`images.unsplash.com`). They are
   never downloaded, re-hosted or proxied. Sizing uses the imgix parameters on `urls.raw`
   (`w`, `q`, `fm`, `fit`, `crop`), which is allowed.
2. **Trigger a download when a photo is used.** Picking a cover sends one GET to the photo's
   `links.download_location` with the key. A search result being shown does not. A re-pick of the
   same photo sends one more, because it is a new use.
3. **Attribute, linked, on every surface the photo appears**: *Photo by
   [name](user.links.html) on [Unsplash](https://unsplash.com)*. Both links carry
   `?utm_source=caesura&utm_medium=referral`. The `utm_source` value is the registered app name,
   so register it as **Caesura**. Store the photographer's name and profile URL with the cover, so
   a page never asks Unsplash for them.
4. **Don't replicate Unsplash.** The picker serves one purpose (a cover for this trip or day): no
   browsing feed, no downloads, no wallpaper or gallery features.
5. **The app is not named or branded like Unsplash**, and no Unsplash logo implies endorsement.
   The credit is text.
6. **Keys.** Only the **Access Key** is used, sent server-side as
   `Authorization: Client-ID <key>`. It goes in `UNSPLASH_ACCESS_KEY`, never in the browser
   bundle. The **Secret Key is not used and should not be set**: it exists only for the OAuth
   flow that acts *as* an Unsplash user (likes, uploads, collections), which Caesura never does.
7. **Rate limits.** The demo tier allows 50 requests an hour; production allows 5,000 an hour
   after Unsplash approves the app. Approval asks for screenshots showing the attribution and
   confirms download tracking. The search and pick quotas (`unsplashSearchQuota`,
   `unsplashPickQuota`) together stay under the tier we hold, and only a person typing a search
   or picking a photo spends them (D2).
8. **Content.** Search sends `content_filter=high`. Results use `alt_description` as the image's
   alt text, falling back to *Photo by <name>*.

## What is true today

Surveyed 2026-10-06. Re-check the line numbers before trusting them.

- **Home** is `app/(app)/page.tsx`, a client page with no server load. It calls `fetchTrips()`
  (`lib/apiClient.ts:167`). The next trip renders as `NextTripHero` (`components/home/NextTripHero.tsx`),
  chosen by `lib/homeTripOrder.ts`. The rest go to the "Other trips" grid as `TripCard` (`:721`).
  **A new trip is usually the hero**, so the empty state has to cover both, or the gate's e2e
  never sees it.
- **`TripCard.tsx`**: an accent bar, the title link, one date line (start date, else *Created …*),
  a cost slot, travellers' avatars and a status badge. An empty trip renders identically to a full
  one. Its skeleton is `TripGridSkeleton` in `HomeSkeletons.tsx:140`.
- **Per-card `fetchTripDetail`** for the cost line (`page.tsx:395-420`) predates M37. D5 governs
  *new* facts, so it stays. It is noted here and not widened.
- **`TripSummary`** (`packages/contracts/src/trip.ts:367-391`) has `startDate` and `endDate`.
  `endDate` is derived in SQL from `trip_details.doc` in `LISTED_SUMMARY` (`server/projections.ts:357`),
  so there is no column for it. `dayCount` and `stopCount` follow that precedent, as
  `jsonb_array_length` over the doc. New fields are `.nullable().default(null)` or defaulted, for
  version skew.
- **`/v1/trips` publishes `TripSummary`**, so a new field bumps `API_VERSION` (minor) and
  `API_FINGERPRINT` (`server/public-api/openapi.ts:36`). `openapi.test.ts` fails until both move.
- **`trip_summaries` is a projection.** `rebuildProjections` deletes and re-inserts it, and
  `applyTripEvents` is its only writer. **A cover cannot be a column on it.** D1 makes it Access-style
  CRUD: a side table `trip_covers` (pk `trip_id`), LEFT JOINed into `LISTED_SUMMARY`. The precedents
  are `trip_travellers` (`0039`) and `command_receipts` (`0041`). Next migration: **`0042`**. Merge
  `main` before taking the number.
- **Trip settings** is `components/trip/SettingsSheet.tsx`. Cover photo goes after *Trip overview*,
  before *Budget*. A cover is not a command, so the section does its own fetches, the way
  `PeopleSection` does. It is shown to `canEditBoard`, and is read-only otherwise.
- **External fetches**: the vendor seam pattern is `server/geocoding/{index,locationiq}.ts`. Keys
  are read in `server/config.ts`, with quotas from `server/quota.ts` (`consumeQuota`, `quotaRefusal`).
  e2e sets `EXTERNAL_DATA_OFFLINE=true`, and no automated test may call a third party, so the port
  gets an **offline fake** selected by that flag.
- **CSP** `img-src` (`next.config.ts:80`) must add `https://images.unsplash.com`.
  `next.config.test.ts` pins the directive. There is no `next/image`, and none is added: a plain
  `<img>` hotlinks the CDN URL (D3).
- **Import wall**: copy the gateway chokepoint in `apps/web/eslint.config.mjs` (~L200-262) so
  only the cover routes may import `@/server/external/unsplash`.
- **Route shape**: `requireTripAccess(tripId, "editor")` as in `api/trips/[tripId]/shares/route.ts`,
  with `readBody` for the body. A new route directory gets an `exposure.ts` key (`planned`).

## Part 2 — the card reads like somewhere

1. **Contract**: `TripSummary.dayCount: z.number().int().nonnegative().default(0)` and `stopCount`
   the same way. Add both to `LISTED_SUMMARY` as one jsonb expression each, with no new query and no
   per-row read. `route.int.test.ts`'s constant-statement-count test must still pass.
   - Add a `CHANGELOG.md` entry.
   - Bump the OpenAPI minor version and fingerprint.
   - The demo fixture carries both fields (`pnpm seed:verify`).
2. **Length**: *N days* on card and hero, from `dayCount`. Nothing is shown at 0.
3. **The empty state** (D6): when `dayCount === 0 && stopCount === 0`, the card and the hero show
   - the dates if known, and nothing about dates otherwise;
   - a next step, *Add the first day*, linking into the trip;
   - when the reader is the owner and alone, an invite nudge linking to Trip settings → People.
   The skeleton is unchanged in height; the empty card fills the same slots.
   - **Design**: no artboard covers this. It is built from existing primitives and tokens, and
     walked at desktop and 390px. If Mitchell wants it drawn first, part 2 waits on `.design-sync`.
4. **Tests**: `TripCard.test.tsx` and `NextTripHero.test.tsx` cases for the empty state, the length
   and the owner-alone nudge. Each is seen red against the old card. Add a `projections.int.test.ts`
   case asserting both counts for listed and paged reads.

## Part 3 — covers, server side

1. **Migration `0042_trip_covers`**: `trip_covers(trip_id uuid pk references trips, unsplash_id text,
   url_regular text, url_small text, photographer_name text, photographer_url text,
   photo_page_url text, set_by text, set_at timestamptz)`. CRUD, not a projection. Rebuild does not
   touch it.
2. **Port** `server/external/unsplash/{index,ports,unsplash,offline}.ts`:
   - `search(query, page)` returns `CoverCandidate[]`;
   - `trackDownload(downloadLocation)` sends the ping that D2 requires;
   - the key is `UNSPLASH_ACCESS_KEY` in `server/config.ts` and `.env.example`;
   - the offline fake returns two fixed candidates whose URLs point at a same-origin test image,
     and records pings.
3. **Contract**: `TripCover` (url, small url, photographer name and url, photo page url) and
   `CoverCandidate` (plus `id` and `downloadLocation`). `TripSummary.cover: TripCover.nullable().default(null)`
   comes from the LEFT JOIN.
4. **Routes** (editor or above; a deleted trip answers 400):
   - `GET /api/trips/:id/cover/search?q=` uses the quota `unsplashSearchQuota`, per user and global,
     because the vendor's demo tier allows 50 requests an hour;
   - `PUT /api/trips/:id/cover` takes `{candidate}`, re-validates it, upserts the row and fires
     `trackDownload` once, after the response, on its own quota `unsplashPickQuota`;
   - `DELETE /api/trips/:id/cover` deletes the row.
   Without a key and not offline, search answers 503 `{error:"covers-unavailable"}`, so the UI can
   say so.
5. **CSP** adds `https://images.unsplash.com` to `img-src`. Update `next.config.test.ts`.
6. **The wall**: an ESLint zone so only `app/api/trips/[tripId]/cover/**` imports the port.
   **No page view calls Unsplash** is then held twice:
   - by the wall;
   - by an int test that spies the port across `GET /api/trips` and `GET /api/trips/:id` and
     asserts zero calls.
7. **Int tests** against real Postgres:
   - search hits the quota;
   - a pick stores the row and fires exactly one ping;
   - a re-pick replaces the row and fires one more ping;
   - clear removes it;
   - a viewer and a suggester get 403;
   - the summary carries the cover.

## Part 4 — covers, client side

1. **Settings → Cover photo**:
   - a search field and a grid of results, each with a *Photo by X on Unsplash* credit;
   - picking one sets it; *Remove cover* clears it;
   - the 503 says covers are not set up here.
   Typed client functions go in `lib/apiClient.ts`, with MSW handlers. 44px targets on phone.
2. **Card and hero**: the cover sits above the title with the credit line, linked as Unsplash's
   guidelines require (`?utm_source=caesura&utm_medium=referral`). Without a cover, nothing changes
   from part 2.
3. **e2e** `m37-trip-covers.spec.ts`, against the offline fake:
   - create an empty trip;
   - see the designed card;
   - pick a cover;
   - see it and its credit on home.
   Run on `test:e2e:ci-like`.


## Part 5 — covers on playbook days

Mitchell, 2026-10-06: *"Yes on playbook days, make sure to really consider the design and the
aesthetic of the playbook pages with the new images, i would love something similiar to homepage
where it has a fade through to context below it."*
1. **Storage**: a saved day is Community CRUD, not a projection, so it gets a side table
   `saved_day_covers` keyed by `saved_day_id`, the same shape as `trip_covers`, in the same
   migration if part 3 has not merged by then, otherwise as `0043`.
   - **Only the author sets or clears it.**
   - **Moderation**: a hidden day hides its cover with it.
2. **Routes**, author-only: `GET /api/saved-days/:id/cover/search`, `PUT`, `DELETE`. They reuse
   part 3's port, quota and ping.
3. **The day page** (`SharedDayScreen.tsx`): the full-bleed cover with the paper veil, and the
   title block (cities, `h1`, meta line, Share) standing on the fade. Its credit line sits at the
   right. The author gets *Change cover* or *Add cover*. Without a cover the page is unchanged. The
   veil is a named class in `globals.css`, the same way `.front-door-veil` is.
4. **Discover cards** (`DiscoverCard.tsx`): the cover leads, with the city chips on the fade and
   the credit under the facts line.
5. **The day's link-preview (OG) image** (ADR-061) is **not changed** by this part. Using the
   cover there would mean generating an image from a photo we may only hotlink. That is its own
   decision, asked of Mitchell after this ships.
6. **Tests**:
   - int: author-only, one ping per pick, moderation hides the cover;
   - unit: day page and card with and without a cover;
   - e2e: `m37-playbook-cover.spec.ts`, where the author adds a cover and the public page shows
     it with its credit.
7. **Tier 3 on this top part**: `pnpm check`, ci-like e2e and `seed:verify`, run once. Record the
   result in part 1's body.

## Out of this stack

- **The cover as a playbook day's link-preview image**: asked separately (part 5, item 5).
- **Mitchell's steps:**
  - register the app with Unsplash as **Caesura**, and set **only the Access Key** as
    `UNSPLASH_ACCESS_KEY` in Vercel (preview and production). The Secret Key is not used;
  - apply for production rate limits once part 4 is on a preview, with screenshots of the credit;
  - dispatch `migrate-production` after part 3 merges.
