# M37 — trip cards and covers: build plan

Gate: `docs/milestones/M37-trips-look-like-somewhere.md` § *Exit gate*. Decisions are numbered
there and cited here as D1–D6. Delete this file at M37's gate close (`docs/plans/README.md`).

## The stack

Four parts, each on its own branch, merged 1 → 4 with merge commits
(`docs/guidelines/stacked-prs.md`). All open as drafts. **Nothing merges without Mitchell.**

| Part | Branch | Theme | Tier |
|---|---|---|---|
| 1 | `ccr-0e9597fb-6iqsii` | M35 closed, M37 current, this plan | 1 (prose) |
| 2 | `ccr-0e9597fb-6iqsii-cards` | `TripSummary` gains `dayCount` and `stopCount`; card and hero get the empty state and the length | 2 |
| 3 | `ccr-0e9597fb-6iqsii-covers-server` | migration `0042` (`trip_covers`), the Unsplash port and its offline fake, search / pick / clear routes, `TripSummary.cover`, CSP, the import wall | 2 |
| 4 | `ccr-0e9597fb-6iqsii-covers-ui` | the picker in Trip settings; the cover and credit on card and hero; the e2e spec | 2, then 3 on the top |

**On the preview, what does a person click to see this?**
- Part 2: the home page. A new trip's card (or hero) is designed, and every card reads its length.
- Part 3: nothing (routes and a column, no screen), so its body says so.
- Part 4: Trip settings → Cover photo → search, pick. Home shows it.

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
     `trackDownload` once;
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
4. **Tier 3 on the top part**: `pnpm check`, ci-like e2e and `seed:verify`, run once. Record the
   result in part 1's body.

## Out of this stack

- **Covers on public playbook days (D4's second half).** It needs the OG-image decision from
  ADR-061, and the gate does not ask for it. It stays a follow-up in this milestone file.
- **Mitchell's steps:**
  - set `UNSPLASH_ACCESS_KEY` in Vercel (preview and production) and register the app with
    Unsplash;
  - dispatch `migrate-production` after part 3 merges.
