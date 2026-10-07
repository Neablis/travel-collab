# M37 — A trip looks like somewhere before it has a plan

**Status:** **Gate closed 2026-10-07, 11 of 11** (retro at the end). Current from 2026-10-06, by M35's gate closing. Built as a five-part stack, #350 → #354, from `docs/plans/2026-10-06-M37-trip-cards-and-covers.md`. **Scoped 2026-10-06, placed after M35.** Every decision below was answered as
recommended (*"Yes that recommendation is fine"*), and the order M37 → M47 was confirmed
(*"Order is good"*), both on 2026-10-06. Minted from `docs/candidates.md` when its 42 unplaced
entries were grouped into milestones (asked 2026-10-06: *"Go through the suggested new features,
categorize them into similar features, and lets build out our next new milestones"*). The grouping
and the order are in `docs/milestones/README.md` under *2026-10-06 — proposed: M37 to M47*.

## Why this exists

The home page is the first screen after sign-in, and a new trip looks empty on it. Mitchell,
2026-10-04: *"better card for trips on your homepage, especially when a trip doesn't have days or
activities, it looks very blank atm"*. The same day he asked for *"leveraging unsplashed free photos
to add photos to activities, trips, playbook days notebooks"*. A cover photo carries most of the
visual weight a card needs, but the card must still work without one. That is why both are one
milestone. The card also still leaves out the trip's length, which a 2026-08-01 entry asked for.

Candidates absorbed (each deleted by this gate):
- *Better home-page trip cards, above all for a trip with no days or stops* (2026-10-04)
- *Free Unsplash photos on activities, trips, playbook days and notebooks* (2026-10-04)
- *Trip list row: show the trip's length* (2026-08-01)

## Decisions (answered 2026-10-06: every one as recommended)

1. **A photo is a decoration on the trip, not a plan fact.** *Recommended:* store it as trip
   metadata (a column or side table: Unsplash id, URLs, photographer, credit link), not as an
   event. Changing a cover is not something History needs to undo, and keeping it out of the log
   keeps invariant 1 simple. The other option, an event, gives undo and replay but puts a vendor
   URL into payloads that are replayed forever.
2. **Fetch once, store the choice, never query per view.** The Unsplash key is server-side only
   (ADR-052: external data enters as a server-fetched input). The demo tier is rate-limited, so
   a search runs only when someone is choosing a photo. Unsplash's terms require the credit line
   and a download-tracking ping when a photo is picked.
3. **Hotlink Unsplash's CDN, do not copy the file.** *Recommended:* Unsplash's guidelines expect
   hotlinking, and copying means storage we do not have.
4. **Scope of the first pass: trips, then playbook days.** *Widened 2026-10-06 by Mitchell: "Yes
   on playbook days, make sure to really consider the design and the aesthetic of the playbook
   pages with the new images, i would love something similiar to homepage where it has a fade
   through to context below it." Playbook days are in this milestone (plan part 5). Their OG
   image stays as it is, and that is asked separately.* *Recommended:* stops and notebooks get
   photos in a later pass. A stop photo is per-stop UI on the board, which is a design question.
   Public playbook days need a decision on their OG images (ADR-061).
5. **The card reads only what the trip list already returns.** Any new fact the card shows
   (route, stop count, travellers, cost per person) is added to `TripSummary` in one read. It is
   never fetched per card. That is a contracts change with a changelog entry.
6. **Default cover.** *Recommended:* none chosen automatically. The empty card gets a designed
   state instead: dates or destination if known, a prompt to add the first day, and an invite
   nudge when the owner is alone. An automatic search on the destination name is the
   alternative. It costs one API call per new trip and sometimes picks the wrong place.

## Scope

- `components/home/TripCard.tsx`: a designed empty state and a fuller populated card. Its
  skeleton in `HomeSkeletons.tsx` changes to match. This is a design change, so it goes through
  the design sync first if it touches `.design-sync/**`.
- A server route that searches Unsplash, and a picker in trip settings that sets and clears a
  cover. Each pick stores the credit and pings Unsplash's download endpoint.
- The trip's length in days on the card.
- Covers on public playbook days, if decision 4 keeps them in this milestone.

## Out of scope

- Uploading your own photo, which needs storage and moderation.
- Photos on individual stops and notebooks, unless decision 4 is answered the other way.
- The demo-trip picker on the front door (M42).

## Exit gate

- [x] **Decisions 1–6 are answered and recorded here**, with the date and who answered.
      *(Ticked 2026-10-06: all six as recommended. No automatic cover; a photo is trip metadata,
      not an event.)*
- [x] **An empty trip's card is designed, not blank**: a trip with no days and no stops shows its
      dates or destination and a next step, and a test asserts that state. The test was seen red
      against the old card.
      *(Ticked 2026-10-06, part 2 (#351, `ffde4c9`): `TripCard.test.tsx` and `NextTripHero.test.tsx`, run against the old components: 12 of 14 fail, e.g. `Unable to find an element with the text: No dates yet · nothing planned yet`. "Nothing planned" is read as no stops (see #351); a trip with no days satisfies this box word for word.)*
- [x] **A cover can be searched, picked and cleared**, with the photographer's credit visible
      wherever the photo renders. The download ping fires once per pick, which an integration test
      asserts against a stubbed Unsplash.
      *(Ticked 2026-10-06, parts 3–4 (#352, #353): `cover/route.int.test.ts` against real Postgres with the offline Unsplash fake. A pick stores the row and sends one ping, a re-pick sends exactly one more, clear removes it. Seen red with `trackDownload` called twice: `expected [ …(2) ] to deeply equal [ Array(1) ]`. The credit renders on the card, the hero, the settings preview and each tile (`CoverCredit.test.tsx`, `m37-trip-covers.spec.ts`).)*
- [x] **No page view calls Unsplash.** An integration test, or a grep wall, shows the card and trip
      routes read the stored URL only.
      *(Ticked 2026-10-06, part 3 (#352): both an integration test and a wall. `cover/route.int.test.ts` asserts zero port calls across `GET /api/trips` and `GET /api/trips/:id`; seen red as `expected "vi.fn()" to not be called at all, but actually been called 1 times`. The ESLint zone lets only the cover routes import the port, with lint-wall fixtures. Part 5 adds the same zero-call assertion for public day reads.)*
- [x] **The card shows the trip's length**, and `TripSummary` changes appear in
      `docs/contracts/CHANGELOG.md`.
      *(Ticked 2026-10-06, part 2 (#351, `b25b1c3`): `dayCount`/`stopCount` on `TripSummary`, with a `CHANGELOG.md` entry and API 1.7.0. Covers add entries for 1.8.0 (#352) and 1.9.0 (#354).)*
- [x] **The design is approved by Mitchell before its UI merges** (asked 2026-10-06: *"go ahead and
      drawn out the design and let me approve"*). Canvas:
      https://claude.ai/artifact/655uQXn7esDDWjeAnnAxa1.
      *(Ticked 2026-10-06: Mitchell, "designs approved", on the canvas's seven artboards as first
      published. The UI in parts 2, 4 and 5 builds to them.)*
- [x] **A playbook day can carry a cover** (decision 4, widened 2026-10-06). The author picks it.
      The day page fades it into the title, as the front door's veil does, and its Discover card
      leads with it, each with the credit. A hidden day hides its cover.
      *(Ticked 2026-10-06, part 5 (#354, `0814970`): author-only routes, the day page's 440/360px band with `.cover-veil-paper`, and the Discover card leading with the photo. `saved-days/[savedDayId]/cover/route.int.test.ts` covers the hidden day: with `notModerated` emptied it fails as `expected { …(21) } to be undefined`. `m37-playbook-cover.spec.ts` passes on ci-like.)*
- [x] **Unsplash's guidelines hold**: hotlinked URLs only, one download ping per pick, a linked
      credit with `utm_source=caesura&utm_medium=referral` wherever a photo renders, the Access
      Key server-side only. The list is in the plan's *Unsplash's API guidelines*.
      *(Ticked 2026-10-06, parts 3–5:*
      - *Images are hotlinked from `urls.*`, sized with imgix parameters on `urls.raw`.*
      - *`trackDownload` is called once per pick, and only to `api.unsplash.com`.*
      - *`unsplashCreditHref` adds `utm_source=caesura&utm_medium=referral`. Seen red as `Received: "…utm_source=app…"`.*
      - *`UNSPLASH_ACCESS_KEY` is server-side only.*
      - *There is no logo and nothing named like Unsplash.*
      *Mitchell's pasted production checklist is quoted in the plan.)*
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: create an empty trip, see
      the designed card, pick a cover, and see it on the card.
      *(Ticked 2026-10-06:*
      - *`m37-trip-covers.spec.ts` (#353) covers the trip journey. `m37-playbook-cover.spec.ts` (#354) covers the playbook day.*
      - *Full ci-like run on the stack's top (#354): **243 passed, 1 flaky**. The flaky one is `m14-notebook-widgets.spec.ts:754`, which passed on retry and 8 of 8 in repeats. It is filed as KI-2026-10-06-a; the stack touches no notebook code.)*
- [x] **[walk]** On the PR preview, the home page with one empty and one populated trip is walked
      at desktop and phone widths.
      *(Ticked 2026-10-07: walked on #354's preview (`4b95117`) by the phase-verifier at 1280 and 390,
      signed in as `alice` and signed out. All six steps passed:*
      - *empty and populated cards;*
      - *the `?settings=people|cover` links;*
      - *real Unsplash search, pick, credit and remove, with utm hrefs and `images.unsplash.com`
        sources;*
      - *a playbook-day cover on the day page, on Discover and on the city card.*

      *The walk found one problem: credit and city links were 15px tall at 390. The fix is
      `min-h-11` on `CoverCredit` (#353) and on the band's city link (#354). The e2e specs now
      measure both at 44px. Real photo pixels were not seen: the session's network blocks
      `images.unsplash.com`, so layout was checked with a stand-in image.)*
- [x] A retro is appended at gate close.

## Retro — gate closed 2026-10-07 (11 of 11)

**What shipped.**
- **Trip cards (#351, plus fixes in #352).**
  - Every trip card and the next-trip hero show the trip's length and stops (`TripSummary.dayCount`, `stopCount`, `ideaCount`).
  - An unplanned trip gets a designed state: a dashed card with *Add the first day*, *Invite who's coming* and *Choose a cover photo*.
- **Unsplash covers for trips (#352, #353).**
  - Search, pick and clear live in Trip settings.
  - The cover fades into the card and hero, with a linked credit.
- **Covers for playbook days (#354).**
  - The day page gets a full-bleed band with the paper veil rising into the title.
  - The Discover card leads with the photo.
- **Storage.** Two side tables, `trip_covers` (`0042`) and `saved_day_covers` (`0043`). Neither is a projection, so neither touches the event log.
- **Unsplash's production checklist is met:**
  - photos are hotlinked;
  - one download ping is sent per pick, after the response;
  - a linked credit with utm params appears wherever a photo renders;
  - no Unsplash logo or naming;
  - the Access Key is used server-side only.

**What held.**
- **The design came first.** Mitchell approved a seven-artboard canvas (https://claude.ai/artifact/655uQXn7esDDWjeAnnAxa1) before any UI merged, and every part built to it.
- **Two reviews per part found real bugs that CI didn't.**
  - My own review of each part caught one major per part:
    - an ideas-only trip read as blank;
    - searching locked out picking;
    - *More results* spent quota on an empty last page.
  - CodeRabbit caught two more:
    - the key followed a same-origin redirect;
    - city chips escaped a Discover card's photo at 390.
- **The stack's Tier 3 run found bugs that green CI had missed.** The full ci-like run on the top part found three #353 bugs:
  - the settings sheet losing its scroll position;
  - the e2e pick quota running out;
  - a viewport check that depended on whether alice held Premium.

  #353's own CI was green only because of spec order inside its shard. The fixes were moved down to #353, as the stacked-PR guide says.

**What did not.**
- **Self-review came after the PRs were opened, not before.** The stacked-PR guide says self-review comes first. Mitchell had to ask *"Was there code reviews done for each of the PRs?"*, and when the reviews were done they lived only in chat until he asked again. **Next time:** review each part before opening it, and post the review on the PR.
- **#351 merged before its review fixes landed.** They shipped through #352 instead. That worked, but it meant reconciling the API version against what `main` had already shipped (1.7.0 went out without `ideaCount`).
- **The merge reached production before its migrations.** `main` deploys on merge, and `0042`/`0043` had not been dispatched when the stack merged (14:21 UTC, 2026-10-07), so the trip list and Discover failed until they were. **Next time:** say in the merge hand-off that the dispatch has to follow the merge immediately.
- **Drafts get no preview.** The first walk attempt found nothing to open, because `vercel-preview.yml` skips draft PRs.

**Left open, not gating.**
- `/v1/trips` publishes `cover` and `ideaCount` as optional, though they are always sent. This is the same shape #354 fixed for `DiscoverDay`.
- A single city name of 40 or more characters with no spaces overflows a card. This predates M37.
- Real Unsplash photos were never seen on a preview from this session, because the session's network blocks the CDN.
- Production rate limits: register **Caesura** with Unsplash and apply for production access, with screenshots of the credit.
