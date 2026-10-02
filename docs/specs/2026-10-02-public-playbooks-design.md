# Playbooks without an account: browse, share, and sign in to add

**Status:** Design and plan, 2026-10-02. Built on `claude/youthful-curie-ckccgy` in the same
session. The decision is recorded in **ADR-061**.

Mitchell's ask:

> Implement a signed-out experience for /playbooks. I want to be able to share them with people
> who aren't signed up, they can see them, they can browse other playbooks, and when they are
> ready to add them it prompts them to sign in or sign up. The link should have a correct open
> graph preview of that location. Make sure to not show any functionality that wouldn't make
> sense to the signed-out experience.

Facts below were checked against `main` at `0be6472`.

---

## 1. Where things stand

- **`proxy.ts` sends every signed-out request for `/playbooks/:path*` to `/signin`.** Each
  page comment says so on purpose: M11b's exit gate read "findable by another *signed-in*
  account".
- **Every read behind those pages answers 401 without a session.**
  - `GET /api/playbooks` (Discover), `GET /api/playbooks/board`, `GET /api/playbooks/profile/:id`
  - `GET /api/saved-days/:id` and `GET /api/saved-days/:id/reviews`, both through
    `requireSavedDayRead` (`server/access/saved-day-access.ts`)
  - `GET /api/places` (the place search on Discover)
- **The library is pseudonymous.** `publicAuthor` and `toAuthor` name an author with
  `displayNameFor({ userId })`, so a person appears as a handle like "Traveler a1b2c3" and never
  by their real name. A preview must not reveal more than the page does.
- **What can be reused:**
  - The per-link preview cards from spec 2026-09-27: `renderCard`, `CardCopy`, the
    `/api/og/**` + `/meta` pair, `linkPreviewMetadata`, and the per-IP `limitLinkPreview`.
  - The share page's pattern (`SharedTripScreen`): the action is shown to everyone, and a
    signed-out press goes to `/signin?callbackUrl=` and comes back.
  - The demo's localStorage intent marker (`lib/pendingDemoClone.ts`), so the click is not lost
    on the way through sign-in.
- **Identity on the client** is `useSessionUser()`, which fetches `/api/auth/session` and
  returns `undefined` (not known yet), `null` (signed out), or the user. The header's
  `HeaderSessionChrome` already renders nothing when signed out.

## 2. Decisions

1. **Same URLs, made public.** The link a signed-in person copies from the address bar is the
   link a stranger opens. There is no `/p/…` alias to keep in step. `/playbooks/:path*` leaves
   `proxy.ts`'s matcher, and the four pages stay in `(app)` so a signed-in reader sees exactly
   what they see today.
2. **Reads open, writes unchanged.** The six GETs above serve a signed-out caller. Every write
   (publish, delete, review, report, add to trip) still answers 401. A signed-out reader is
   handled as "a reader who owns nothing":
   - **Discover:** scope is forced to `everyone`. *Yours* and *Saved* have no meaning.
   - **A day:** only published, unmoderated days are readable. That is the same predicate
     another signed-in account gets, so a private or moderated day is the same 404.
   - **Reviews:** listed, with `mine: null`.
   - **Board:** `meUserId: null`, a web-local wire change logged in the contracts CHANGELOG.
   - **No pin backfill.** It spends the reader's geocode quota, and an anonymous reader has
     none.
3. **Anonymous reads are rate-limited per IP.** A public, unauthenticated Discover query is the
   most expensive read in the library. Policy `public-library-minute`: 120 per IP and 6,000
   globally per minute, counted in Postgres like `linkPreviewQuota`. Signed-in reads are not
   charged.
4. **The client knows who is reading from one fetch.** A `SessionUserProvider` in
   `(app)/layout.tsx` resolves the session once, and `useSessionUser()` reads it from context
   when a provider is mounted (it falls back to its own fetch otherwise). The header, the tab
   bar and the playbook screens all read it.
   - **Signed-in-only controls hide only on a confirmed `null`.** While the session is still
     `undefined`, they render as they do today, so the signed-in majority sees no shift.
   - **The first paint already knows a signed-out reader** (added 2026-10-02, Mitchell). The
     layout checks whether an Auth.js session cookie exists at all (`lib/sessionHint.ts`).
     With none, the session starts `null`, so the server renders the signed-out shell and
     skips the session and preferences fetches. A cookie is only a reason to ask. It is
     never treated as signed in. The cost is that the `(app)` group renders per request.
5. **What a signed-out reader sees, and what they do not:**

   | Surface | Signed out |
   |---|---|
   | Header | Logo, then **Sign in** and **Create an account**. Both carry `callbackUrl` = this page. No Trips/Playbooks nav, no account menu. |
   | Phone tab bar | Hidden. Its tabs are Trips (yours) and Playbooks, and the header already offers the way in. |
   | Discover | Search, filters, sort, cards and *Who shares the most*. **No** *Everyone / Yours / Saved* tabs. |
   | A day | Everything a reader sees. **Add to a trip** stays, and opens a *Sign in to add this day* dialog (see below). **No** Report on the day or on reviews. **No** review composer. **No** author controls (already author-only). |
   | Profile and board | As today. No "You" row. |

   **Add to a trip, signed out.** The dialog offers *Sign in* and *Create an account*, both
   with `callbackUrl` = the day. It also banks `pending_playbook_add = { savedDayId, at }` in
   localStorage, following `pendingDemoClone`. When the day page loads with a signed-in reader
   and a live marker for **this** day, it clears the marker and **opens** the add dialog. It
   does not add anything: picking a trip is still the reader's click, so a forged marker can
   only open a dialog.
6. **A *Share* button on the day.** It uses `navigator.share` where available and otherwise
   copies the link. The link is the clean `/playbooks/day/<id>`, without `?from=`. It is shown
   to everyone, because a signed-out reader can pass a link on too.
7. **Link previews.** These follow spec 2026-09-27 §2.2: image routes under `/api/og/`, a
   `/meta` JSON sibling, and `generateMetadata` through `linkPreviewMetadata`.

   | Page | Card route | og:title | Line under it |
   |---|---|---|---|
   | `/playbooks/day/<id>` | `/api/og/playbooks/day/<id>` | the day's name | "Kyoto · 3 days · 12 stops · by Traveler a1b2c3 · ★ 4.6" |
   | `/playbooks/profile/<id>` | `/api/og/playbooks/profile/<id>` | "Traveler a1b2c3's playbooks" | "N playbooks · added to N trips · knows Kyoto, Osaka" |
   | `/playbooks?city=Kyoto` | `/api/og/playbooks/city/<city>` | "Kyoto playbooks" | "N days other travelers planned in Kyoto" |
   | `/playbooks`, `/playbooks/board` | `/api/og/playbooks` (static) | "Playbooks on Caesura" / "Who shares the most" | the Discover line |

   - **Names are the page's own handle**, never a real name (§1).
   - **Failure gets the generic card.** A private, moderated, deleted or unknown day, an author
     with nothing shared, or a city with no published days all fall back to the generic
     Playbooks card. This keeps the routes from becoming an oracle for private days, and stops
     a crafted `?city=` from printing arbitrary text on a Caesura-branded card.
   - **Cache:** day and profile cards `s-maxage=3600`, so an unpublish clears within the hour,
     the trade-off the invite card already made. City and generic cards `s-maxage=86400`.
     The existing per-IP `limitLinkPreview` applies.
8. **Indexing is not decided here.** There is no `robots` file today. Whether search engines
   should list the public library is a separate product question, recorded as a candidate.

## 3. Plan

Three independent units, with disjoint files:

**A. Server reads** (`src/server/**`, `src/app/api/**` except `og`, `proxy.ts`)
1. `readableSavedDay(id, readerId: string | null)`. Null keeps only the public, unmoderated
   branch.
2. `readSavedDayAsViewer(id)` in `saved-day-access.ts`, returning
   `{ readerId: string | null, day, isAuthor }`. `requireSavedDayRead` stays as-is for writes.
3. `discoverDays` and `reviewsFor` take `readerId: string | null`. The scope and moderation
   predicates get an explicit null branch, never `owner_id = NULL`.
4. The six GET routes serve anonymous callers, charged to `limitPublicLibraryRead(request)`
   (new `publicLibraryQuota()` in `quota.ts`, `server/publicLibraryLimit.ts`).
5. `LeaderboardResponse.meUserId` becomes nullable, with a CHANGELOG entry.
6. `proxy.ts` drops `/playbooks/:path*`.
7. Integration tests: anonymous Discover only sees public days and ignores `scope=yours`;
   an anonymous day read is 200 for public and 404 for private and moderated; reviews give
   `mine: null`; anonymous writes are still 401; the limiter refuses past the ceiling.

**B. Link previews** (`src/server/og/**`, `src/app/api/og/playbooks/**`, the four page files'
`generateMetadata`)
1. `server/og/playbooks.ts` provides `dayCardFor`, `profileCardFor` and `cityCardFor`, each
   returning the card data or `{ kind: "generic" }`.
2. `copy.ts` gets `playbookDayCopy`, `playbookProfileCopy`, `playbookCityCopy` and
   `PLAYBOOKS_GENERIC`, plus unit tests for the words.
3. The routes: image and `/meta` for day, profile and city, and the static generic image.
4. `generateMetadata` on all four pages. Discover personalises only for exactly one `?city=`.
5. Integration tests: the public day gives its name; private, moderated and unknown days give
   the generic card; a real name never appears.

**C. Client** (`src/components/**`, `src/lib/**` client modules, `(app)/layout.tsx`)
1. `SessionUserProvider` and the context-aware `useSessionUser`.
2. `HeaderSessionChrome` signed-out actions, and `PhoneTabBar` hidden when signed out.
3. `DiscoverScreen` without scope tabs when signed out. `SharedDayScreen` gets the sign-in
   dialog, hides Report and the review composer, and adds the Share button.
   `ReviewsSection` gets a `canReport` prop.
4. `lib/pendingPlaybookAdd.ts`, the marker, with unit tests.
5. Component tests for each signed-out branch, each seen failing.

**Then:**
- A Playwright spec (`e2e/public-playbooks.spec.ts`): a signed-out walk of Discover → day →
  Add → sign-in dialog, plus the `og:` tags in the page head. Verdict from
  `test:e2e:ci-like` (CLAUDE.md rule 1).
- ADR-061, the STATUS note and the candidate for indexing.
