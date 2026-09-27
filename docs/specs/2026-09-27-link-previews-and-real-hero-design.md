# Personal link previews, and the front door's hero on real components

**Status:** Design, 2026-09-27. Approved in conversation; **not yet planned**.
The next session writes the plan (`docs/plans/`); the one after executes it.

Mitchell's ask:

> Create some custom OpenGraph pages for commonly shared links that would be good to
> customize unique to user — /signup -> X Invited you to Caesura (look up who invited
> you, dont share full name, just first). We also might want to reconsider the homepage
> design to better show some major changes, like the trip timeline with times view, and
> new notebook widgets.

Decisions from that conversation:

1. **Previews ship in two waves.** First the trip invite and the referral link (personal),
   then the share link and `/demo`.
2. **The hero uses real components on demo data (option B).** A trip picker was liked but
   kept **off the home page for now** so the page stays simple; it is recorded in
   `docs/candidates.md`.
3. **Keep the landing's layout and swap in real components.** Redesigning the sections
   is out of scope and would need a design pass first.

Facts below were checked against `main` at `d0d1e68c`.

---

## 1. Where things stand

- **One static preview for every URL.** `apps/web/src/app/opengraph-image.png`
  (1200×630) is rendered by Playwright in `apps/web/scripts/generate-og-assets.mjs`.
  Nothing in the tree uses `next/og` or `ImageResponse`.
- **`pageMetadata()`** (`src/lib/siteMetadata.ts:39-65`) repeats `images` on every
  call. Next merges metadata shallowly, so any segment that sets `openGraph` loses the
  file-convention image unless it restates it.
- **`/invite/<token>` is public.** `readInviteLanding` (`src/server/inviteLanding.ts`)
  already returns `inviterName`, trip name, start date, day, city and stop counts, and the
  crew. `GET /api/invites/:token` exposes it.
  - `inviterName` comes from `displayNameFor`, which is the **whole display name** (line
    85). A preview must pass it through `firstNameOf` (`src/lib/displayName.ts`).
- **`/signup?code=<CODE>`** is the referral link from Account → "Bring someone in"
  (`PlanSection.tsx:79-81`).
  - `invite_codes.created_by` is the referrer.
  - Codes are 10 characters drawn uniformly from 31 symbols, about 49 bits
    (`server/entitlements/referrals.ts`). Resolving a code to a first name is not
    guessable in practice.
- **`/s/<token>`** is public. `SharedTripView` already strips members.
- **The lint wall.** Everything under `src/` except `src/server/**`, `src/app/api/**` and
  `.well-known` routes is banned from importing `@/server/*` and `@tc/domain`. That
  includes page files and any `opengraph-image.tsx` next to them.
- **The color wall** (`scripts/check-color-wall.mjs`). Raw color literals are allowed
  only in `globals.css`, and satori (behind `ImageResponse`) cannot resolve
  `var(--…)`.
- **The landing hero** (`components/front/LandingHeroArt.tsx`) rotates hand-drawn
  `MapView`, `TimelineView` and `NotebookView` mockups taken from the design handoff.
  - They predate M29 (the time river, `components/board/DayRiver.tsx`) and M30 (notebook
    widgets, `components/pages/blocks/`).
  - SPEC §14 says the page fetches nothing, and `LandingScreen.test.tsx` enforces it.
- **The demo trip** is folded in memory by `src/server/demoTrip.ts` from `@tc/fixtures`
  through `@tc/domain`. Neither import is reachable from UI code.

## 2. Link previews

### 2.1 Cards

| Route | og:title | Image shows | When the lookup fails |
|---|---|---|---|
| `/invite/<token>` | "Maya invited you to plan Japan: Tokyo → Kyoto → Osaka" | inviter's first name, trip name, date range, "N days · N cities", crew first names (max 3, then "+N") | generic "You're invited to a trip on Caesura" |
| `/signup?code=<CODE>` | "Maya invited you to Caesura" | referrer's first name and the product line | the current site card |
| `/s/<token>` (wave 2) | trip name | trip name, a day-length strip, "N days · N cities · N stops". **No people.** | the current site card |
| `/demo` (wave 2) | "Look around a real trip" | the Japan trip card, static | — |

**Privacy rule:** names are **first names only**, taken through `firstNameOf`. Never
show an email, a handle derived from an email, a surname, or a photo.

**A revoked invite, an accepted invite, or an unknown token** gets the generic card, not
the inviter's name. The token is the only thing that was shared, and it must stop saying
who sent it once revoked.

- `readInviteLanding`'s `member` state needs a viewer, and an unfurler has none. Map
  "valid" to the personal card and everything else to the generic card.
- A redeemed referral code keeps the name. Chat apps cache the first unfurl anyway, and
  the referrer shared that code on purpose.

### 2.2 Shape (keeps both walls intact)

- **Image routes live under `src/app/api/og/`**: `/api/og/invite/[token]`,
  `/api/og/referral/[code]`, and later `/api/og/share/[token]`.
  - They return `ImageResponse` and call `src/server/*` directly. That is allowed there.
  - Each goes through one small server module (`src/server/og/*`) that returns only what
    the card prints: first names and counts.
- **Pages set `openGraph.images` to that URL** from `generateMetadata`, through
  `pageMetadata()` so the site image stays the fallback.
  - For `/signup`, the URL is only set when `searchParams.code` is present.
- **og:title and og:description** need the same data, and page files cannot reach
  `@/server`.
  - **Recommendation:** add a small `/api/og/…/meta` JSON sibling and have
    `generateMetadata` fetch it. This follows "UI calls the API" literally.
  - The alternative is widening the lint wall to `generateMetadata`, which is a
    precedent the wall has never granted.
  - The plan settles this, and ADR-worthy if the wall moves.
- **Colors.** The plan picks one of these:
  - **(a)** a generated `ogTokens.generated.ts`, emitted from `globals.css` by the
    same parser `generate-og-assets.mjs` uses. The color wall exempts that file, and a
    verify step fails CI if it differs from a fresh parse (the `content:verify`
    pattern).
  - **(b)** read `globals.css` at request time.
  - Recommendation: **(a)**. (b) depends on file tracing into the function bundle.
- **Fonts** are bundled as local TTF/WOFF files (Bricolage Grotesque 600, IBM Plex Sans
  400/500). They are not fetched from Google at render time: see KI-2026-09-27-a, a
  production deploy that failed on Google Fonts.
- **Caching.** Invite and referral images:
  `Cache-Control: public, max-age=300, s-maxage=300`. That is short, so a revoked invite
  goes generic quickly on our side (unfurler caches are outside our control). The demo
  card is static.
- **Rate limit.** The same as `GET /api/invites/:token`. The referral lookup is new
  surface, so the plan confirms a limiter covers it.

### 2.3 Tests (per `docs/guidelines/testing.md`, each seen failing)

- **Server module, integration:**
  - valid invite → first name only (seed "Dana Reyes" and assert "Dana" appears and
    "Reyes" does not);
  - revoked, accepted and unknown → generic;
  - referral code → first name.
- **Route:** returns `image/png` at 1200×630 for each state.
- **Metadata:** `/invite/<token>` and `/signup?code=` emit an `og:image` pointing at the
  route, and `/signup` without a code keeps the site image.
- **Browser walk** on the Vercel preview: paste each link into an unfurl debugger or
  Slack DM, done by a person as a gate box. A crawler cannot run in CI.

## 3. The hero on real components

### 3.1 What changes

Only the **Timeline** and **Notebook** panels of `LandingHeroArt`. The map panel, copy,
layout, phone tree and CTAs stay as they are.

- **Timeline:** the real `DayRiver` for one Kyoto day of the Japan fixture, read-only:
  no drag targets, no gestures, and `useTimeFormat` falling back to `DEFAULTS` (there is
  no provider on the landing, and `usePreferences` already returns `DEFAULTS`).
- **Notebook:** real blocks laid out as the Overview lens lays them out, fed the same
  trip: `TripStripBlock`, `ItineraryDayBlock`, `SpendByDayBlock` or `CostsTableBlock`,
  and `WeatherBlock`.
  - Any block that fetches must be given its payload inline or be left out. The plan
    checks each one. `WeatherBlock`'s payload comes from a fixed table, and that is to be
    confirmed.
- `LandingFeatureBlocks`' "Together" mini-timeline is a candidate for the same swap. It
  goes in only if the plan finds it is the same work.

### 3.2 Getting demo data without breaking §14 or the lint wall

The landing cannot fetch, cannot import `@/server/demoTrip`, and cannot import
`@tc/domain`. So:

- **A committed snapshot, generated and drift-checked.**
  - A script under `apps/web/scripts/` folds the Japan fixture through the same path
    `server/demoTrip.ts` uses. Scripts are outside the wall, as `db-seed.ts` is.
  - It writes `src/lib/landingDemo.generated.json`, trimmed to the day and blocks the
    hero renders. That is a few KB, not the whole 68-stop trip.
  - A verify step (`pnpm landing:verify`, joined to the existing verify job) regenerates
    it in memory and fails on any difference. The snapshot can go stale only by failing
    CI.
- **Dates.** The live demo shifts dates with `DEMO_TRIP_LEAD_DAYS`, and a snapshot would
  freeze them. The hero shows "Day 4 · Kyoto"-style labels and times, not calendar
  dates. The plan confirms no rendered block prints an absolute date, or strips it.

### 3.3 Risks the plan must answer

- **Bundle weight on `/welcome`.** `DayRiver` pulls in pragmatic-drag-and-drop, and the
  spend blocks pull in Recharts.
  - Measure the `/welcome` First Load JS before and after.
  - If the growth is material, load the hero panels with `next/dynamic` after first paint
    and keep the current static art as the placeholder.
- **Visual fit.** The real components are sized for the board, not a hero card.
  Screenshot at desktop and at the breakpoint where `PhoneFrontDoor` takes over.
  Mitchell reviews them visually before merge (memory: show UI decisions visually).
- **Design-handoff drift.** The hero's current panels cite
  `.design-sync/handoff/design/Trip Planner Redesign.dc.html`. Swapping them is a
  deliberate divergence from the handoff, so record it where M26 design parity tracks
  divergences.
  - `.design-sync/**` is a build input, not prose (AGENTS.md DoD).
- **Tests.**
  - The existing `LandingScreen.test.tsx` no-fetch assertion must still hold. Add a
    `fetch` spy that fails if anything calls it during render.
  - The snapshot verify must be seen failing: edit one fixture stop's time and watch it
    go red.

## 4. Out of scope

- The trip picker on the home page, and `/demo/<slug>` for the four content-bundle trips
  (Dolomites, Iceland, Northern Spain, Thailand). Recorded in `docs/candidates.md`.
- Redesigning the landing's sections or copy.
- Previews for `/trips/*` and `/playbooks/*`. Both are behind sign-in, so unfurlers never
  reach them.
- Replacing the site-wide static image.

## 5. Suggested plan shape (for the planning session to confirm)

1. `src/server/og/*` lookups, plus the invite and referral image and meta routes, fonts
   and the tokens module.
2. Wire `generateMetadata` on `/invite/[token]` and `/signup`.
3. Share-link and `/demo` cards (wave 2).
4. The landing snapshot generator and verify step.
5. Swap in the hero Timeline and Notebook panels, then measure the bundle and take
   screenshots.

Steps 1–3 and 4–5 are independent and can be two PRs.
