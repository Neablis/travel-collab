# M51 — The front door tells the story

**Status:** **Proposed and scoped 2026-10-20 with Mitchell; current from 2026-10-20**, ahead of
M49 (decision 7). It comes from the top entry of `docs/candidates.md`, *The front door tells the
story*, which M50's walk filed on 2026-10-19 (M50 decision 21). The design review settled every
decision below before any code. The build plan is `docs/plans/2026-10-20-M51-front-door.md`,
nine parts on `main` (parts 8 and 9 added during the build). Part 0 is this file, the plan and the
gate tracker. No ADR: the two contract changes are additive, the `addedBy` read-model field
(part 4) and the public API's preview stop cap, 3 to 12 (part 9, 1.20.0), each recorded in
`docs/contracts/CHANGELOG.md` by its part.

## Why this exists

Mitchell walked production `/` after M50 part 9 (PR 503, merged as a stopgap) and asked for a
design review rather than more fixes. His six toolbar threads are kept verbatim in the
`docs/candidates.md` entry this milestone places, which this gate deletes. In short:

- **Wide screens are mostly dead space.** Every desktop band is held to 1140px, so at 3440px about
  two-thirds of each band is empty. The alternating dark and light bands read as a checker.
- **The pieces do not tell one story.** The playbooks spread shows two unrelated cards and no trip;
  the Together and Countdown cards sit side by side without relating.
- **Pricing is sterile and placeholder.**
- **The one thing he liked** was the notebook page: a real page from the app, showing how it is
  used.

The design review answered with a new ground for the whole page. It is a *sea of notebooks*: all
of the library's public days as real Discover cards, edge to edge. A few of them rise out of the
sea as you scroll, each telling one step of the story (find a day, make it your trip, the crew on
it, the notebook afterwards). Then the sea dims back behind them.

## Decisions

**The design review.** Mitchell, 2026-10-20, in three rounds of comments on these artifacts:

- Three directions (A one trip, B the notebook, C a wall of days), on a canvas:
  https://claude.ai/artifact/Xe65iUbSmhjaL9JVaWVaa3
- The B2 motion prototype (the notebook with borrowed days, a page flip):
  https://claude.ai/artifact/1nbkRFcYQN4jM2UgVi5J5T
- The C2 motion prototype (the sea of notebooks), **which the build follows**:
  https://claude.ai/artifact/Fvkoyjzu6mqxS9KxHZaGhK

**Answered by Mitchell, 2026-10-20:**

1. **Design before code.** The job of `/` is to make a stranger *fall for the feeling*: mood first,
   real pages, little explaining.
2. **Three directions, two second rounds, two motion prototypes** (the links above).
3. **Direction: C2, the sea of notebooks.** *"im actually now leaning towards C2, the logic is i
   love the book motif but i am not commited to rewriting rest of app right now. [C2] works now,
   solves getting more CTA by making the sample notebooks clickable, and is pretty novel design"*.
   The book motif (B2) waits as its own candidate, *The book motif across the app*, for when the
   app adopts it.
4. **Real components, cached data.** *"its important to re-use existing react elements from the
   real app. We can play with the ideas, but the root of them should be cached sample data,
   populating the real elements to minimize drift"*. The ruling is **frame yes, content no**:
   landing-only frame, motion and layout are allowed. Anything that shows trip content is the
   real component, fed by the build-time snapshot (`apps/web/scripts/landing-demo.ts`), never by a
   fetch.
5. **Borrowing days is the story.** *"our real market value is the sharing and borrowing of
   days"*. The notebooks are the ending, not the pitch.
6. **Pricing is a cumulative ladder:** Free → Plus $9/mo → Premium $19/mo, each step reading
   *"Everything in Free/Plus, and…"*.
   - **Free:** *"Every trip you want, as many days as you like — and share any of it with a
     link."*
   - **Plus:** your personal AI trip assistant.
   - **Premium:** bring the whole crew in; only you need it.
   - It is not pedantic: the details live on the in-app pricing page. The plan name stays
     **Plus**, not Pro.
   - **No "Free tier!"**: *"the exclamation mark undermines the authenticity and tone im looking
     for and makes user feel like its a scam"*. So SPEC §14's no-"free" rule holds ("Free" is
     only the plan name), and the landing has no exclamation marks. This settles the question
     M50's candidate left open.
7. **M51 goes ahead of M49.** M49 waits; nothing in it has started. Order:
   M51 → M49 → M43 → M44, with M48 still parked.
8. **App changes in scope:**
   - **(a) Names on stops.** The trip view draws who is going (avatars) and "Booked by" on stops.
     The stop read model gains an **`addedBy`** field, derived from who issued the add, shown as
     *"Sam added this"*. The public API schema (`openapi.json`) changes with it.
   - **(b) The rack's "Parked by" label becomes "Booked by"**, so that field has one word
     everywhere.
   - **(c) A borrowed day lands on a chosen existing day.** `AddToTripDialog` gets a day picker
     over the server's existing `startingAt` merge (ADR-050). It does **not** insert a new day
     mid-trip: no `beforeDayId`, no contract change.
9. **Sample ratings on the sea's cards**, Mitchell's call: *"just add the sample ratings, and we will re-address as
   reviews come in and use the real trips then"*. They use `ratingLine`'s format
   (*★ 4.8 · 37 reviews*), with about one card in nine reading *"No reviews yet"*. This reverses
   M50 part 9's no-invented-rating call (M50 decision 20) **for the landing only**. The candidate
   *Real reviews replace the landing's sample ratings* holds the follow-up.
10. **The C2 round-3 comments, all honoured in the prototype; the build follows the prototype:**
    - The **closing cell** is full width, part of the grid, and the very last element on the page
      (*"Make this full width (but still part of the grid) , and the absolute last element on
      page"*).
    - **Pricing is second to last**, and the sign-up / find-a-day CTA is last (*"the cost page
      should be the second to last page, the last page should be the CTA to signup/find a day to
      start with."*).
    - The **Japan notebook example** is surrounded by Japan day cards that light up with it and
      are clickable (*"have example japan notebooks around it that also turn on, and are clickable
      to start days from"*).
    - The **crew example** uses a different country and trip: Greece, three days, Paros → Naxos →
      Santorini, with the crew Maeve, Tomas, Ruth and Kenji, and Elena's Naxos day as Day 2
      (trimmed from four days in part 1's review, PR 507). It is compact (about 600px), so the sea
      shows around it, with Greek day cards lit around it (*"Use a different notebook, country and
      trip for this example… Maybe squish this down, do less days"*).
    - **River blocks are never squished**: they have a floor height (*"Is the top and bottom
      pending event spose to be squished?"*).
    - There is **one screen of sea between highlighted cells** (*"maybe shorten it so just as the
      last element leaves the top, the next one comes into view"*).
    - The **"make it your trip" moment starts the real onboarding**: signup → making your trip →
      the real trip with that day (*"can this actually kick off the onboarding and end with adding
      that real trip?"*; the plan is M50 decision 5).
    - Its **heading** is *"Start a trip using someone else's Thailand day, or add it to an
      existing plan."*, with no "Nadia".
    - The **colourful first screen holds longer** before it dims (*"Keep the initial page colorful
      background a tad longer before fading out"*).
    - **Links go only to real days.** Mitchell, after part 0 was written: *"every card on the home
      page doesnt need to be a real day, and all data that links somewhere needs to link to a real
      day that exists in the DB of the app that its part of, preview needs to link to seeded
      preview, prod needs to link to real prod days"*. So a linked cell goes to its real day page
      (`dayPath`, `/playbooks/day/<slug>-…`) with a hover and focus ring, and it must resolve in
      that environment's DB; unlinked cells are allowed. The Japan cells stay unlinked: Japan days
      exist only in the dev fixtures. Previews get the library days from part 7.
11. **Phone keeps the tiled sea** with the same rise and fade (*"Could we keep the tiled
    background, and the embedded cards from the elements as i suggested in the mobile
    version?"*).
12. **Other findings.** The Railay viewpoint's coordinates are about 4.2 km north of the real
    viewpoint, and the trip file copies them twice, once onto a dinner stop: KI-2026-10-20-a,
    fixed in part 1. No source could be read for them, so part 1 left all three Railay stops
    unpinned (no coordinate); re-pinning them needs the geocoder. The redesign resolves KI-2026-10-19-d, KI-2026-10-19-h and KI-2026-10-19-i.
13. **The parent sizes, the component fills.** Mitchell, on his walk of PR 510: a card or block
    never sets its own outer size, measures its parent or scales itself; the grid decides, and
    content that does not fit clamps, wraps or shows one row. Recorded in
    `docs/guidelines/building-from-the-design.md`.

**Answered by Mitchell, 2026-10-21:**

14. **The find moment's banner is his hand-picked Italy days**, not a ranking rule: the Rome day
    as the banner, with Florence, Amalfi and Bologna lit (*"i never said to make it a rule"*).
    They come in as content bundles exported from production; the landing links to the import's
    copies, and his production originals stay.
15. **The Italy bundle copies are owned by the library's demo owners** (dev-marco, dev-sofia,
    dev-elena, dev-tomas), not his account.
16. **Day cards list activities until they run out of room.** On the landing sea the cell sizes
    them. On playbook list pages it is option (b): cards in a grid row share one height, set by
    titles and details with room for at least 3 stops, and a card fills any spare height with
    more stops. No card shows fewer than 3 or grows because of its stops.
17. **The public API's preview stop cap rises from 3 to 12** (option b, a contract change; part 9,
    1.20.0).
18. **The notebook moment's journal prose stays as written**, and the sun widget gets a
    *"Sunrise and sunset"* heading.

**The comments behind them, verbatim** (typos kept). The ones quoted in decisions 3–11 are not
repeated here.

- *Round 1, the canvas (11 threads).* A's pricing ladder: *"This display of the pricing is my
  favorite of the 3"*. A's river: *"I like the river motif here, but we could expand it more, have
  the elements drift in on scroll, and add landmarks long the river?"*. B: *"the notebook design
  is maybe the most ambitious and the one that is currently resonating with me the most. My worry,
  is the notebooks are a bit of a weak point of app, and our real market value is the sharing and
  borrowing of days from existing trips."* B's crew page: *"The 4, whos coming can use less space,
  maybe just show avatars, and names on elements, and re-use that page space better"* (decision
  8a). C's wall: *"This one is really wild, i like the colors, and the breakway from the norms, it
  challenges the expectations."* C's search: *"Really like the idea of putting a search on the
  notebooks front and center, this is smart"*. The riff that became C2: *"make the "notebook" days
  full page, and the entire background. When you first land its all the elements, lots of colors
  and very overwhelming. But as you scroll down, they fade out, become background, and some of
  them fade in to accent the elements… So lots of noise, and the noise becomes focused and
  helpful, like the app"*. C's choice card: *"This is best example of re-using a trip for starting
  trips."*
- *Round 2, C2 (7 threads).* *"Introduce more variability into the cards, think of it as a grid
  system that rotates between 1x3, 2x2, etc elements"*; *"Play with having the standout elements
  being part of the background grid, and have them fad in when they scrolled into view."*; *"Make
  sure theres more space between the previous and next hero elements to give the background more
  time to be visible"*; *"We will need to think through the card text here with the trips behind
  them to keep readability"*; *"I love the bigger card on the left, and the smaller detacted card
  being the same trip, thats really cool"*; and a caption drawn over the previous element, a bug.
- *Round 2, B2 (6 threads).* The spine and the phone's pages must read as a book; *"Her day 3
  becomes your day 1"*; *"A cool addition could be a CTA on the trips in every example we show
  (across all 3 examples) that are clickable and able to start trips from"*; the camera, bike and
  boat emoji go on the cards' chips. These now wait with the book motif candidate.
- *Round 3, B2 (2 threads).* The cover's colour and texture (the candidate keeps them), and the
  page order that decision 10 applies here too.

## Scope

Nine parts, each its own PR on `main` (the plan has the files, entry points, tests and preview
walks):

1. **The sea's data.** All 148 public library days as `DiscoverCard` props with sample ratings,
   cell sizes and `dayPath` links. The Greece and Japan clusters and the moments' data, under
   `landing:verify`. The wrong Railay pins are removed from content.
2. **The desktop sea.** Full bleed, mounting only near-screen cells, moments that rise while the
   sea dims, clickable cells, pricing ladder second to last, closing cell last. It rewrites the
   tests that pin today's desktop landing.
3. **The phone sea.** `PhoneFrontDoor` becomes the tiled sea with the same rise and fade.
4. **Names on stops.** Going avatars and "Booked by" on stops, a new `addedBy` read-model field
   (`openapi.json`), and the rack's "Parked by" becomes "Booked by" (decision 8a, 8b).
5. **Pick a day.** `AddToTripDialog`'s day picker over the existing `startingAt` merge
   (decision 8c).
6. **Make it your trip.** The landing's moment drives the real signup → trip-from-day flow
   (decision 10).
7. **Seed content on previews.** Preview builds import `content/` after migrating, so the sea's
   links resolve on previews (decision 10's links ruling). It adds the checks that keep them
   real (Mitchell: *"We might also want a test or ci check that we dont introduce changes to
   frontend that will break this"*): a CI unit test against the importer's own slug/id code, and
   a CI step that requests every sea link on the PR's preview.
8. **The preview link check** (PR 511, merged). Part 7's CI step against the PR's preview, built
   as its own part: it requests every sea link and fails on any non-200 (*The links stay real*,
   second half).
9. **Day previews carry their stops** (PR 513, open). Day cards list stops until they run out of
   room, and the public API's preview stop cap rises from 3 to 12 (1.20.0; decisions 16 and 17).
   It waits on part 2 (PR 510) and merges after it.

Order: 1, 4, 5 and 7 start at once; 2 waits on 1; 3 and 6 wait on 2 (6 on 5 as well). 7 is
independent of 2–6. The crew
moment's names wait on 4. 8 followed 7; 9 merges after 2.

## Out of scope

- **The book motif (B2) across the app**: a candidate (decision 3).
- **Real reviews on the landing's cards**: a candidate (decision 9).
- **Inserting a borrowed day as a new day mid-trip** (decision 8c). That would be a contract
  change to `DayAddedV1`.
- **A real map behind the hero**, and the hero search box from direction C. Neither is in C2.
- **Hero photography and illustration** (as in M50).

## Exit gate

- [ ] **The sea's data:** a generated snapshot holds all 148 public library days as
      `DiscoverCard` props, each with a cell size, a canonical `dayPath` href that round-trips
      through `parseDaySegment`, and a sample rating in `ratingLine`'s format (about one in nine
      *"No reviews yet"*). It carries no calendar date. `landing:verify` covers it. The Greece crew
      trip and the Japan cluster come from it. The Railay viewpoint (both content files) and dinner
      stop lose the wrong pin and carry none until the geocoder re-pins them, and KI-2026-10-20-a
      is in `resolved/`. Test seen red.
- [ ] **The desktop sea:** at 1440 and 3440 the sea runs edge to edge with no dead side margins.
      The first screen of cells is in the server-rendered HTML. Only near-screen cells mount. The
      moments rise and the sea dims, with one screen of sea between them and the first screen held
      longer. Pricing is second to last, and the full-width closing cell is the last element. `/`
      stays static (ADR-078) and the landing makes no request (`LandingScreen.test.tsx`'s fetch
      spy). Tests seen red.
- [ ] **Every linked cell is a door:** each linked cell goes to its canonical day page, with no
      `?from=` and with prefetch off, and resolves to a real day in that environment's DB: seeded
      library days on previews (part 7), production days on production. Unlinked cells (the Japan
      cluster) are allowed. A linked cell shows a hover and focus ring. Keyboard focus reaches the moments
      and the CTAs without tabbing through every background card. `a11y.spec.ts` (axe) passes on
      `/`.
- [ ] **The links stay real:** a CI unit test checks that every href the landing sea renders
      resolves to a day the content importer creates from `content/`, using the importer's own
      slug/id code, not a copy (this settles PR 507's minor at `landing-demo.test.ts:141`), and
      that the Japan cells render no link. A CI step against the PR's Vercel preview, after part 7
      seeds it, requests every sea link and fails on any non-200. Both seen red.
- [ ] **Pricing ladder:** Free → Plus $9/mo → Premium $19/mo, with decision 6's copy. "Free"
      appears only as the plan name, and the page has no exclamation mark. Each *"Everything in X,
      and…"* line is computed from entitlement sets, never from price or order
      (`planVersions.noExtension.test.ts`'s warning).
- [ ] **The phone sea:** at 390 the tiled sea has the same rise and fade. `#pricing` still scrolls
      under the sticky header, the safe-area banner holds (`m39-installable.spec.ts`), and there is
      no sideways scroll at 390, 375 or 360.
- [ ] **The old landing's tests are replaced, not deleted silently:** every pin listed in the plan
      is rewritten or removed with a reason. KI-2026-10-19-d, -h and -i move to `resolved/`, and
      any replacement for the 900px assertion is seen red.
- [ ] **Names on stops:** a trip's stops show who is going, "Booked by" and *"Sam added this"*.
      `ActivityView.addedBy` is in the read model, the CHANGELOG and the committed `openapi.json`.
      The projection-rebuild golden test passes, the demo fixture exercises it and `pnpm
      seed:verify` is green. The rack reads "Booked by". Tests seen red.
- [ ] **Pick a day:** `AddToTripDialog` offers the chosen trip's days and "after the last day". A
      chosen day sends `startingAt` and the stops land on it. The dialog's copy states what it
      does. Unit and e2e (`m11b-playbooks.spec.ts` or `m11-saved-days.spec.ts`) seen red.
- [ ] **Make it your trip:** from the landing's moment, signed out: sign up → *Making your
      trip…* → a new undated trip named for the day, holding it. A signed-in return opens the
      add-to-trip choice (M50 decision 15). e2e seen red, via ci-like.
- [ ] **[walk]** Mitchell walks the preview at **390, 1440 and 3440**, with the mouse and with the
      keyboard only: the sea's first screen, each moment rising, a cell opening its day page,
      pricing, the closing cell, and *Make it your trip* through to a new trip. He also walks a
      trip's stops with names and the day picker.

A retro is appended at gate close. `pnpm milestone close M51` deletes the placed candidate.

## Risks

- **A prefetch storm that bypasses the day cache.** `DiscoverCard`'s links carry `?from=playbooks`,
  and any query forces the live library read for a signed-out visitor
  (`apps/web/src/lib/playbooksReader.ts`), which defeats ADR-063's cache. The sea's links must be
  canonical and query-less, with prefetch off.
- **Payload.** 148 cards are about 138 KB minified (about 24 KB gzipped). The snapshot is imported
  in exactly one client module and lazy where it can be, so it is not duplicated in the RSC
  payload.
- **Tab stops and axe.** 148 cards with 3–6 links each. Background cells need a focus rule, so
  only one link per cell, or `inert` until it is near, keeps the keyboard walk short.
- **The snapshot drifts from production**: a day hidden, pruned, re-covered or renamed. And `adds`
  is the bundle's ledger count. `landing:verify` cannot see production, so this is accepted, as
  it already is for the demo snapshots.
- **The ladder implies nesting.** Premium ⊇ Plus must never be read from price
  (`accountPlan.ts`). The pricing component computes each "Everything in" line per pair.
- **Previews have no library days today.** 147 of 148 sea links 404 on a preview; production
  returns 200 for 148 of 148 (import run 2026-10-11). Part 7 closes this for previews.
- **e2e has no library days.** The test DB runs no `content:import`, so clicking a sea cell in
  e2e would 404. e2e asserts the hrefs and seeds the one day it follows through
  `api/dev/saved-days`.
- **"Added by" names whoever re-emitted the add.** A revert or undo re-emits `ActivityAdded` under
  the reverter's actor. Part 4 states this in the CHANGELOG entry.
- **iOS momentum scroll** with many mounted cards inside the phone's scroller.
