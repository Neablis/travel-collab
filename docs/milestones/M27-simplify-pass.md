# M27 — The simplify pass: fewer things on screen, the invite landing, Cass, and actions that look like actions

**Status: GATE CLOSED 2026-09-23, 8 of 8 (walked by Mitchell on production after
#205 merged). Minted, scoped and PLACED 2026-09-23 by Mitchell ("Big
new Design pass in the handoff … just go ahead and make all the changes and
offer the PR when done, documenting any decisions you make"), ahead of M12.**
M12 is unblocked by this and stays next. It's the same placement argument M26
made: M12 adds ratings to surfaces this pass reshapes (Discover's filter menu
and the new-trip Playbook-day turn), and it's cheaper to reshape them once.

The design pass is `.design-sync/handoff/SPEC.md` §35 (commit `3363027`,
2026-09-22), and §35.10 is its build list. This file does three things: it
records how each §35 item maps onto the build, **every call the build made where
the design and the code disagree**, and what is deliberately left out.

---

## How it was scoped

Five read-only surveys (2026-09-23) compared §35 and the design-file diff with
the working tree, one each for §35.1–2, §35.3, §35.4/5/7, §35.6 and §35.8–9. What they found that the
spec text does not say:

| Finding | Consequence |
|---|---|
| No theme picker exists and no look is stored anywhere. `layout.tsx` already hard-sets `data-look="ledger"` | §35.1 is CSS and comments only; no contract or migration |
| Trips list newest-first, so a newly created trip **becomes the hero** — and §35.2 filters the hero out of *Other trips* | `createEmptyTripViaWizard` (used by ~12 e2e specs) waits on the trip's name link, which the hero now carries too — because parallel e2e workers share one account, whether a new trip is the hero or a card is a race |
| Trip lifecycle (Duplicate / Delete / Leave) lives only on `TripCard`'s menu | Filtering the hero out of the grid would orphan it on Home for a one-trip account |
| `CreateTrip.name` is `min(1)` — the domain refuses a nameless trip | The design's *create an empty one* link has no name to send |
| There is no `shiftTrip`; the command is `SetTripStartDate` (moves the start, keeps the day count) | The dates-pill popover dispatches that, exactly as Trip settings does |
| The day rail shows on Plan, Calendar **and** desktop Overview today | Moving it into Plan removes it from two tabs, which is what §35.3 intends |
| No rating or review count exists anywhere (M12's) | Discover's Filters menu cannot hold Rating; the Playbook-day turn cannot filter on rating |
| The public invite read is not public (401 without a session) and discloses nothing about a spent or revoked link by policy (#71 review §7) | The invite landing needs a new unauthenticated read |
| `trip_invites` has no note column and no expiry | Two of the landing's inputs do not exist |
| `AssistantProposal` carries only `changes[].text` | A card's title / detail / button / done line must be derived, or the contract widened |

---

## Decisions

Each one is a place where a competent engineer could reasonably have chosen
differently. Mitchell can overturn any of them. Where there is an obvious
alternative, it is named.

**D1 — One look is a deletion, not a refold.** The `nightdesk` and `airmail`
blocks go from `globals.css`. `@theme` stays as the base, and `data-look="ledger"`
stays hard-set on `<html>`. *Alternative:* fold Ledger's values into `@theme` and
drop the attribute. That changes every generated OG asset (the generator reads
the first `--color-*` match) for no visible gain.

**D2 — The hero's button stays *Open trip*.** The design says *Open plan*.
Mitchell's review comment on #196 said *"'Open trip' not open plan"*, and it
went to the trip, not to the Plan lens. A direct instruction outranks a label
redrawn in a pass that did not mention it.

**D3 — The hero keeps the trip's lifecycle menu.** Filtering the hero out of
*Other trips* would leave a one-trip account with no Duplicate / Delete / Leave
on Home. §35's own rule is *"nothing orphaned"*, so the hero carries the same
`⋯` menu the cards do.

**D4 — *create an empty one* sends a name.** It uses whatever the person typed
or answered for *where*, otherwise **"Untitled trip"**. The domain refuses an
empty name, and loosening `CreateTrip` would be a contract change to save one
word.

**D5 — The dates-pill popover is its own small control over `SetTripStartDate`.**
It is not a reuse of `TripDateControl`, whose copy (*Pick the day you leave…*,
clear-date ✕) is the settings version. The popover carries §35.3's copy and
commits on Enter, blur or close, not on change: Chromium emits a valid date per
typed year digit (0002-…, 0020-…), which would each have moved the trip.

**D6 — `docFrom` is a query parameter.** Overview's **Edit** links to
`/trips/:id/pages/:pageId?from=overview`, which opens the page in edit mode. The
breadcrumb's first crumb reads `← <Trip> overview` and returns to Overview. From
anywhere else it reads `← <Trip>` and returns to the trip. Overview's Edit is now
hidden for read-only viewers; before this it showed.

**D7 — Account keeps `?tab=tokens` as the tokens sub-view's URL.** It is not a
tab: two tabs render, and on the sub-view neither is selected. A deep link to
`?tab=tokens` still lands on the tokens surface, and so does Plans' back link.
**The *Home time on hover* row is not built.** It was amended out of M17
because there is no home-airport timezone, so only Distance's help text changes.

**D8 — Discover's Filters menu holds Budget and Length, and the intro drops
"and rated".** Rating is M12's. The design's intro, *Days other people planned
and rated*, would claim a rating nobody can give yet. It reads *Days other
people planned. Find one for your city and drop it into your trip.* M12 puts
the words back when it puts the ratings in. *There were never shape bars in
the build*, so that half of §35.5 is already true.

**D9 — The invite landing ships `valid`, `revoked` and `member`. `expired`
waits for an expiry model.**
- Invites have never expired: `InviteStatus`'s own comment says so. Adding a
  14-day lifetime would kill every live link older than two weeks the day it
  deploys. That is a product call with a migration, so it is not made from a
  design annotation.
- **Ask Dana for a new link** also has no channel to send on, because nothing
  in the app sends mail.
- `expired` is recorded as owed, not drawn half-working.

**D10 — The revoked state does not name the inviter.** The design's *Dana took
this invite back* reverses the nondisclosure rule the #71 review put on spent
and revoked links. The screen reads *This invite was taken back*. The
`valid` state does name the inviter and the crew: the token is the credential
(ADR-026), and a valid holder can join and see all of it anyway.

**D11 — There is no invite note.** `trip_invites` has no note column and the
invite form has no field for one. The blockquote is drawn only when a note
exists, and today none does. Adding a note means a migration plus a field in
Travellers, which is wider than a design parity pass.

**D12 — *Have a look first* is a token-keyed read-only view, the same shape as
the demo.** A pending invite's token grants a synthetic **viewer** on exactly
that trip, on the same read routes `allowDemo` opens. It never writes and never
reaches another trip. It is carried as a request header by the one screen that
renders it. The banner's action is **Join the trip**, which goes through sign-in
and back to the landing.

**D13 — The Playbook-day turn ranks by *adds*, not rating.**
- There are no ratings (M12). The turn offers up to three published days for
  the answered city, most-added first, with at least one add, and it is
  skipped when there are none or when the read fails.
- Its copy says what the number is: *People planning Kyoto keep adding these
  days*, and the meta reads *Added to 12 trips*, not *★ 4.9 · 214 reviews*.
- M12 swaps the ranking and the copy. Its file carries the note.
- The chosen days are inserted into the trip after it is created, through the
  existing `POST /api/trips/:id/saved-days/:savedDayId`.
- This is the first network read inside the new-trip turns. It is a read, it
  is never a model call, and it can never block the script, so §30.2's billing
  argument is unaffected.

**D14 — The typing row is built, and §30.2's "no fake delay" is superseded by
§35.8.** The tests that asserted the opposite are rewritten, not worked around.
The row is presentation over the local script; nothing waits on the network.
Reduced motion turns the dots' animation off. It does not shorten the pause.

**D15 — The design's `who` acknowledgements have no turn to attach to.**
Mitchell dropped `who` on 2026-09-15, so they are not built.

**D16 — Proposal cards derive their words from the proposal. The contract is
not widened.**
- **Title:** the single change's text, or *N changes*.
- **Detail:** the remaining changes, or the skipped line.
- **Accept:** *Make the change*.
- **Done:** the server's apply message.
- *Alternative:* add `title` / `yes` / `done` to `AssistantProposal` and have
  the model write them. That is a contracts change for words the client can
  already compose.

**D17 — Undo on an accepted card is offered only while nothing has happened
since.**
- Undo dispatches the trip's `UndoLastChange`, which undoes the last batch.
  Once anyone else has written, that would undo *their* change.
- So Undo shows only while the apply is still the trip's last change. After
  that the card says so, and points at History (§35.10's conflict path).
- **Enforced server-side, not only at render** (#205 review). The client's
  history can be a poll interval old, so the card's Undo sends
  `UndoLastChange { undoesBatchId }` naming its apply batch. If anything else
  is on top when the server decides, it refuses **`undo-target-changed`**
  (409), appends nothing, and the provider refetches; the card then reads
  *Changed since — undo it from History.* Contracts changelog, 2026-09-23.

**Smaller calls made during the build** (recorded so they are not rediscovered):
- `UnderlineTabs` accepts `value: null`. With nothing selected, the first tab
  keeps the tab stop, because Account's tokens sub-view selects no tab.
- The tokens sub-view's `← Profile` and H3 live in `AccountScreen`, not in
  `TokensSection`, which renders nothing until its fetch lands. The panel there
  is a `region` labelled by the H3, not a `tabpanel`.
- Discover's phone sheet button reads `Filters · N` too (was `Filters (N)`), so
  one state is not worded two ways.
- The keep dialog's toast reports the count (*Kept in your Playbooks*,
  *N days kept in your Playbooks as one*). A stop with no time shows an empty
  time cell in the preview.
- The hero's trip name is a link to the trip, like a card's. With the hero out of
  the grid, it is the only place the name appears on Home.
- First run keeps its own Playbook and import links and adds only *Or create an
  empty one*, so no link appears twice. Deleting the Create empty button would
  otherwise have left first run with no way to an empty trip.
- `ImportTripButton` is now only a quiet link; no button call site was left.
  Exactly one picker is mounted per page, and the sheet's link drives it.
- **The invite landing's calls:**
  - The public read is the existing `GET /api/invites/[token]`, made public,
    not a second endpoint. Two reads of one token would mean two copies of
    the nondisclosure rule.
  - A link used by someone else shows *unavailable* with *This invite has
    already been used*, not *revoked*, whose copy would be false.
  - There is no `?join=1`: a URL that joins whoever opens it is the `?clone=1`
    hole removed on 2026-09-01. A signed-out Join leaves a localStorage marker
    naming the token, and the landing finishes the join on return.
  - The inviter's avatar is initials, because the CSP's `img-src` cannot load
    a Google photo.
  - **What a look-first token holder can read** is what a pending viewer
    could: the trip, and its `/access` member list (names and emails). That
    is the D12 trade, stated so a reviewer can refuse it.
- **Cass's calls:**
  - A typed answer that no chip covers is acknowledged with *Got it.*, not
    with a chip's line.
  - With a chosen Playbook day, the closing line says *X is already in place;
    the rest is yours to fill* mid-sentence. Appended after *The days are
    empty*, it would contradict itself.
  - A chosen day that fails to insert keeps the conversation on screen,
    naming the day, instead of navigating past the only place that says so.
  - The composer also shows on the multi-select turns, because the hint
    promises *or type your own*.
  - Answer pills keep the 44px phone floor; the design shows 40px.
  - The Playbook-day cards' radius is 12px, not 10px, until `cn`'s merge
    config learns the `a-*` tokens.
  - The first name is read only by the first-run conversation, so the sheet
    makes no extra session request.
- **The proposal card's calls:**
  - Undo compares the apply's recorded batch with the trip's history at
    render time *and* at click time. The card's state is always read from
    history, never set by the click.
  - Known limit: a notebook save after an accept hides the card's Undo, even
    though the undo itself would skip that save.
- **Link 10's finding: the single-day map was never missing in code.**
  - Walked in Chromium at 1280px and 390px on locally imported content:
    - a one-day Playbook drew its map (7 pins);
    - a three-day one drew 24;
    - three more one-day Playbooks, opened from Discover, all drew.
  - `m26-shared-day-map.spec.ts` already asserts a map on a one-day Playbook.
  - The only Playbooks with no map are those with fewer than two located
    stops: 5 of the 148 content Playbooks, and production's one 5-day row,
    which has none. §16's list-only rule still holds for those.
  - What did differ between one-day and multi-day was layout: a Window rail
    row only on one-day Playbooks, and the map as a plain box. Both are gone.
    Every Playbook now uses the design's framed map (focus card, legend,
    dotted ride legs, *Show route* on a phone), the same stop rows, and the
    same card. The day picker is the only structural difference.
- **Link 10, second finding: §16's list-only rule is superseded.**
  - The trigger: *"Shouldnt there be a map here?"* on the preview's "M23
    three-day walk" (3 days, 14 stops). Every stop there is `{ name, city }`
    with no coordinate, so the two-located-stops floor drew nothing.
  - The rule now, from Mitchell: a Playbook has a map whenever there is
    anything to place.
  - His follow-up: the map frame always renders at full height, so the page
    never reflows. The frame holds one of five things:
    - the route (two pins or more);
    - *places*: a lone pin, or one disc per city, with no line and a note
      saying why;
    - a pulsing moss ground while the server pins the stops;
    - the offline state;
    - *Nothing to map yet* ("None of these stops has a place pinned to it, so
      there's no route to draw."). Only this state is left with nothing to
      place.
  - A stop whose coordinate is `precision: "city"` is no longer a route
    point, because five of them are one centroid. They draw as that city's
    disc instead.
- **The read-time backfill** (`server/savedDayPins.ts`,
  `savedDayPinBackfill.ts`):
  - The shared-day read (`GET /api/saved-days/:id`) schedules a pass with
    `after()`, so the response never waits on the vendor. It answers
    `pinning: true` on the response envelope, not in the `SavedDay`
    contract, which is unchanged. The page then re-reads every 4 s, at most
    8 times.
  - What a pass does, one city at a time:
    - looks the city's centre up;
    - looks each stop up as `"<name>, <city>"` inside a 50 km box around the
      centre, accepting only a match that `placeNameVerdict` does not call a
      mismatch (KI-39);
    - otherwise pins the stop at the centre as `precision: "city"`.
  - Every stop attempted leaves with a coordinate, so each is looked up once
    and the next read has nothing to do. The exceptions are a thrown vendor
    call (retried on a later read) and a city the vendor cannot find (its
    stops are left alone).
  - It never replaces the author's name or city.
  - The write is Community CRUD (saved days are not event-sourced) and runs
    only over the exact jsonb it read, so an overlapping pass loses as
    `raced`. The result is parsed with `SavedStop` first.
  - Any reader may trigger it, not only the owner: a looked-up coordinate is
    not an authored change. The owner-only v1 API read does not trigger it.
  - The budget:
    - at most `MAX_PIN_LOOKUPS_PER_READ` = 12 lookups per read, paced at
      `MIN_INTERVAL_MS` (about 8 s in the background), so a 14-stop Playbook
      takes two reads;
    - each lookup is charged one unit of the reader's `geocodeQuota()`, and
      the pass stops at the first refusal;
    - one pass per day per instance, and a day whose pass placed nothing is
      left alone for 10 minutes.
  - With no `LOCATIONIQ_API_KEY` (local, e2e) nothing is scheduled and the
    page never waits.
- Text sizes snap to existing tokens where the design uses half-pixel sizes
  (15px → `text-base`, 12.5px → `text-xs`), because the lint wall bans
  arbitrary sizes.
- Plan's day rail no longer scrolls itself to follow a selection while it is off
  screen. Now that the rail scrolls with Plan rather than sitting in the sticky
  header, following would yank a reader halfway down the columns back up to it.
- A trip with no dates still gets the dates pill as a button (*No dates set*),
  and its popover opens empty.
- The Overview letter is `.tc-overview-letter` with a `--shadow-letter` token.
  Its 4px radius is written out because the Ledger look zeroes the radius scale.

---

## Out of scope, on purpose

- Rating anywhere: Discover's filter, the Playbook-day turn's threshold, and
  *★ reviews* meta. **M12.**
- Invite expiry and *Ask for a new link*: **D9**. The invite note: **D11**.
- The paid half of the new-trip fork (§30.3's live redraw). It stays M9's
  `wizard-assistant-draft` Preview.
- Renaming the in-trip assistant panel to Cass. §35.8 says explicitly not to.

---

## Links

| # | Link | §35 | Owner files (roughly) |
|---|---|---|---|
| 1 | One look | 35.1 | `globals.css`, `layout.tsx`, `transcriptLook.test.ts` |
| 2 | Your trips quieter; new-trip sheet links and footer on demand | 35.2 | `app/(app)/page.tsx`, `components/home/*`, `e2e/helpers.ts` |
| 3 | The trip page: rail into Plan, dates pill, Overview letter, breadcrumb | 35.3 | `TripHeader`, `TripMetaPill`, `TripBoardScreen`, `OverviewLens`, `PageScreen` |
| 4 | Account has two tabs | 35.4 | `components/account/*` |
| 5 | Discover has one Filters menu | 35.5 | `components/playbooks/*` |
| 6 | The invite landing and *having a look* | 35.6 | `server/access/*`, `packages/contracts/src/access.ts`, `app/(front)/invite/**`, `proxy.ts` |
| 7 | Keep several days: the preview and the city label | 35.7 | `KeepDayDialog`, `KeepDayFlag`, `Board` |
| 8 | Cass, the typing row, the Playbook-day turn, answer pills | 35.8, 35.9 | `newTripScript`, `NewTripWizard`, `Transcript` |
| 9 | Proposal cards | 35.9 | `ProposalCard`, `TripBoardScreen` |
| 10 | Every Playbook has its map; Playbooks surfaces styled to the design | §15, §16, §33 | `components/playbooks/**` |

**Link 10 was added 2026-09-23 on Mitchell's request, made while the pass was
being built:** *"make sure the playbooks get correctly styled? Every playbook
should have maps for instance, not just the multi day ones"*. It is not in §35.
It is the parity of the Playbooks surfaces as a whole (§15/§16/§33), plus the
root cause of single-day Playbooks drawing no map.
Mitchell's follow-up sets the rule for it: *"Multiday and single day playbooks
should mostly look the same other than the day picker on map, don't treat them
different."* So one layout serves every Playbook. The day picker renders only
when there is more than one day. The only other difference allowed is copy
that is genuinely about the count (*Add all 3 days to a trip*).

## Exit gate

- [x] Links 1–9 merged; `pnpm check` green; `test:e2e:ci-like` green (or each
      failure named with its KI)
- [x] **[walk]** Home with two trips: the header has **New trip** only; the hero
      shows one actionable line and no tiles; *Other trips* does not repeat the
      hero
- [x] **[walk]** A trip's header is the same height on Overview, Plan, Calendar
      and Map; the dates pill moves the trip's start
- [x] **[walk]** Overview's **Edit** opens the page, and the first crumb returns
      to Overview
- [x] **[walk]** A signed-out visitor opening an invite link sees the landing;
      **Have a look first** shows the trip read-only; **Join** lands in the trip
- [x] **[walk]** New trip for a city with published days offers them after the
      city, and a chosen day is on the created trip
- [x] **[walk]** A single-day Playbook from the content library shows its map
      (desktop, and behind *Show route* on a phone)
- [x] **[walk]** Asking the assistant for a change shows a card; accept, then
      Undo, puts the trip back

## Retro — 2026-09-23

**Closed the day it opened.** Merged as #205 (`57922bd`) with CI green, walked by
Mitchell on production, gate ticked 8 of 8 on that walk.

**What shipping it took beyond the merge** (the operator steps are not part of
the merge, so they are written down here):
- `migrate-production` applied `0025_reviews_and_moderation`. That migration is
  M12's backend (#206) and came in with main, not from this milestone; production
  showed 25 of 26 applied beforehand, checked by hash.
- `import-content-production` dry run, then the real run: 0 trips created, 4
  already present, 2 stop locations moved, 148 Playbook days written. That
  delivers #207's 16 hand-corrected coordinates: 2 in the Thailand demo trip,
  14 across 8 Playbook files. Both moves and a Playbook fix were then read back
  from the production database.
- **Expect 2 moves, not 16.** The dry run's *stop locations it would move* counts
  only stops in already-imported **trips**. The Playbook corrections are inside
  *would write N playbook day(s)*, because each run rewrites every Playbook day
  from its file.

**What was found and filed, not fixed:**
- the Home hero's reflow on phones (`KI-2026-09-23-e`);
- the card's Undo is hidden by a notebook save and can record the wrong batch
  (`KI-2026-09-23-f`);
- the wall tests write fixtures into `apps/web/src` (`KI-2026-09-23-g`);
- the Playbook pin backfill joins the unpaced LocationIQ callers (added to
  `KI-2026-09-17-b`);
- `PageScreen`'s bare `Loading…` is still there after this pass (already
  `KI-2026-09-20-e`).

The *Buenos Aires Sunday* stop geocoded about 30 km off was **Feria de San
Telmo**, and #207 corrected it. There is nothing to file.

**Lesson:** a fan-out of five read-only surveys before writing a line was what
made seventeen decisions recordable instead of discovered in review. Every
place where the design and the code disagreed was found before the build rather
than during it.

