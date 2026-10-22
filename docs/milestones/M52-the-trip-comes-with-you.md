# M52 — The trip comes with you: what's next today, and what to do when plans change

**Status:** **Proposed 2026-10-22 by Mitchell, placed after M51 and ahead of M49. Not scoped
yet.** What it is for and where it lives are his (below, *Answered at minting*). Every other
decision is a recommendation and none has been answered. Minted the same day (see
`docs/milestones/README.md`, *2026-10-22 — minted: M52, the trip comes with you*).

## Why this exists

Mitchell, 2026-10-22: *"Right now we have lots of functionality to plan the trip, and we have
some functionality for after the trip. But nothing during the trip. We know when the trip
starts, so lets build the during trip experience."*

He listed four things:

1. A couple of days before the trip: add flight details, and track the flight and a countdown to
   the trip.
2. During the trip: an overview of the day and the next activity, with a link into Google Maps
   (or similar) for directions.
3. Ask the assistant during the trip to answer questions about it, or to change it as plans
   change: a delay, moving dinner later, finding something similar when an activity is cancelled.
4. A trip chat, so the group can organise and talk during the trip.

And the constraint: *"I dont know where this will live, how we expose this to the user, and keep
our principle of simple ui with functionality that expose itself to you just when you need it."*

### What already exists (code survey, 2026-10-22)

Much of this has a foundation already. The gap is that **nothing changes when the trip starts**.

| Need | What exists | What is missing |
|---|---|---|
| Know the trip's phase | `orderHomeTrips` bands trips as under way, upcoming, undated or past (`apps/web/src/lib/homeTripOrder.ts:64-73`). `tripHasEnded` drives the publish offer (`:18`). "Today" is the reader's calendar date (`lib/today.ts:19,39`). | A shared phase (soon, under way) that surfaces can read. A trip and its times carry **no time zone**: a `TimeWindow` is plain `HH:MM` (`packages/contracts/src/activity.ts:7`). The only zone is the server-derived `TripGlobalsDay.timeZone`, taken from the day's first stop with coordinates (`packages/contracts/src/globals.ts:86-89`, `server/timeZones.ts:33`). |
| Countdown | Home's `NextTripHero` badge says "in 47 days" (`components/home/NextTripHero.tsx:232-249`). The notebook widget `trip.countdown` already has phase wording: "starts tomorrow", "day X of Y", "ended N days ago" (`packages/pages/src/format.ts:90`). | A countdown to a **departure time**, not just a date. The hero's badge reads "Next trip" even while the trip is under way (`NextTripHero.tsx:230`). |
| Flights | A transit stop has `mode: "flight"`, a departure `location`, an `endLocation`, and its `timeWindow` as departure and arrival (`activity.ts:276,304-308,622-630`). | Flight number, carrier, confirmation. M44's `booking` object (confirmation, provider, url) was proposed for this and is not built. There is **no flight-status vendor**. |
| Today and what's next | Overview, Plan, Calendar and Map (`components/trip/TripViewTabs.tsx:7`). On a phone, the trip's tabs are Overview / Plan / Map / Notebook (`components/nav/PhoneTabBar.tsx:20-25`). | No now line or current-stop marker anywhere. Nothing opens on today. |
| Directions | `Location` carries a name, `lat`/`lng` (geocoded when left out), a structured address and a `precision` (`activity.ts:81-177`). | No outbound map link anywhere. The app only *parses* pasted Google and Apple Maps links (`lib/pasteToStop.ts:68,117`). |
| Assistant | The rail (`components/assistant/AssistantRail.tsx`) is a sheet below 1100px, so it is on the phone already. Its write tools cover every batchable command, including moving a stop's `timeWindow` (`server/assistant/tools/planning.ts`). It has `find_free_time` and `search_places`, which is biased to where the trip is (`tools/places.ts:146,179`). A multi-change turn becomes one suggestion that is accepted whole (ADR-067). | **The assistant does not know today's date or the time.** Neither `server/assistant/prompt.ts` nor `context.ts` passes it, so "push dinner back an hour" and "what's next" have no *now* to stand on. |
| Trip chat | **Built in M46** (ADR-073): the Chat tab of the same rail, the unread dot, `@day`/`@stop` links, and presence. | Nothing. During the trip it only has to be quick to reach. |
| Phone and PWA | Installable since M39. `public/sw.js` has only install and activate handlers, and its comments forbid a fetch listener: no push, no offline trip. | Push and offline each need their own ADR (`sw.js:5-19`). |
| After the trip | `PublishTripOffer` once `tripHasEnded` (`components/trip/PublishTripOffer.tsx:44-79`). | Out of scope here. |

So of the four asks, **chat is already built**, the **assistant** needs to know what time it is
plus a few prompts and tools, the **day overview and directions** are new UI on existing data, and
**flights** are the only real contract change.

## Where it lives: the answer to "how do we expose this"

**No new tab, route or mode.** The trip's surfaces stay the same and **change what they lead with
when the trip's phase changes**. This is SPEC §10's rule, which predates this milestone: *the
phone is "retrieval and small edits while you are on the trip, not trip planning"*
(`.design-sync/handoff/SPEC.md:347-358`). Each piece shows up when it is useful and is absent
otherwise. Per SPEC §27, *nothing renders disabled*.

A trip has four phases, computed from its dates, the day's time zone and the clock:

| Phase | When | What changes |
|---|---|---|
| **Planning** | More than 3 days before the start | Nothing. Today's product. |
| **Soon** | Up to 3 days before the start | Home's hero counts down to the first departure ("Flight to Lisbon in 2 days, 7 h"). If the trip has no flight leg, one quiet line offers **Add your flight**. It opens the ordinary stop editor, prefilled as a flight on day 1, and disappears once a flight exists or is dismissed. |
| **Under way** | Between the start and end dates | The trip opens on **Today**: the top of Overview becomes a *Today* card showing **Now** (the current stop, if any), **Next** (the next stop, time until it, and a **Directions** button), and the rest of today, collapsed. Home's hero becomes the same card in miniature. Plan opens scrolled to today. The Ask/Chat button stays where it is, and the assistant now knows it is mid-trip. |
| **Ended** | After the end date | Today's behaviour: the publish offer (`PublishTripOffer`). |

**Interaction sketch (phone, under way):** opening the trip shows Overview, with *Today* on top.
Tapping **Next** focuses that stop on the board, the same focus M46's chat chips use. Tapping
**Directions** leaves the app for the maps app, with the stop as the destination. Tapping
**Ask** opens the assistant sheet with the input focused. Its starters are now day-of ones
("Running 45 min late", "Move dinner later", "X is closed, find something similar"). A change it
proposes appears as the ordinary proposal card or Accept-all suggestion. When it is accepted, a
one-line notice goes to the trip chat ("Mitchell moved Dinner at Tasca to 20:30"), so the group
learns of it where they are already talking.

**Desktop** gets the same *Today* card at the top of Overview while the trip is under way, and
nothing else. During a trip, the phone is the main surface.

## Decisions

**Answered by Mitchell at minting, 2026-10-22:**

1. **It is for the days around and during the trip**: flight details and a countdown just before,
   today's overview with the next stop and directions during, the assistant for questions and
   changes, and the trip chat. *(His four bullets.)*
2. **Placed after M51**, as the next milestone (*"record that as a upcoming milestone to do
   next"*). M51 stays current.

**Open (recommendations; none answered):**

3. **Where it lives.** *Recommended:* as above. Phase-driven content on the existing Home hero and
   Overview, with no new tab or route. The alternative, a fifth phone tab *Today* that exists only
   during a trip, is easier to find but makes the tab bar change shape. SPEC §22 says that bar is
   the router.
4. **What "soon" means.** *Recommended:* 3 days before the start date, the "couple days before" of
   the ask. The countdown on Home already exists for every upcoming trip. What 3 days changes is
   the flight prompt and the switch from a date countdown to a departure-time countdown.
5. **How "now" is computed when times carry no zone.** *Recommended:* a stop's `HH:MM` is the local
   time of **its day's zone** (`TripGlobalsDay.timeZone`). If that is null, use the reader's
   device zone. "Now" is the device clock converted into that zone, so a traveller whose phone
   still says home time sees Lisbon's next stop correctly. One pure function, `tripNow(trip,
   globals, now) → { phase, dayId, current, next }`, in `packages/domain`. The clock is passed in
   (invariant 4), and its property test covers midnight, a day with no zone, and a flight that
   lands in a different zone.
6. **Flight details: where they live on the stop.** *Recommended:* **take M44's `booking` object
   into this milestone**, as `booking: { confirmation?, provider?, url? }`, and add an optional
   `reference` for the carrier's code (e.g. `TP 1351`). It is shown on any transit stop and
   labelled *Flight number* when the mode is `flight`. M44 decision 2 comes with it: a
   confirmation code is seen by editors and up, never through share links or published days.
   M44 keeps only containment. The alternative is a flight-only object (`flight: { number,
   terminal, seat }`). It is narrower, and a train or ferry ticket would ask for the same fields
   next.
7. **Tracking the flight.** *Recommended:* **no live-status vendor in this milestone.** The flight
   card shows the scheduled times in each end's local zone and the countdown to departure, plus
   **Flight status ↗**, which opens a search for the flight number on the carrier or a tracker.
   Live status (delays, gate, a push when it changes) needs a paid vendor (FlightAware,
   AeroDataBox, Cirium), a polling job and push notifications. It goes to `docs/candidates.md` as
   its own entry. The alternative is to integrate one vendor now, read-only, refreshed when the
   card is opened, behind `EXTERNAL_DATA_OFFLINE` like weather. That would add a key, a cost line
   and a terms-of-use review to this milestone.
8. **Which maps app Directions opens.** *Recommended:* Google Maps' universal URL
   (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`, or the name and address when
   the precision is `city`). It opens the app on Android and iOS when installed, and the web
   otherwise. `travelmode` comes from the leg's `mode` when a transit stop leads into the stop.
   The alternative is Apple Maps on iOS, or a per-account preference in Account. The
   recommendation is no preference until someone asks for one.
9. **Directions appear on any stop, or only in Today.** *Recommended:* in the stop's detail on
   every surface whenever the stop has coordinates (it is useful while planning too, and costs one
   link), and **prominently** only in Today's *Next*.
10. **"Near me."** *Recommended:* **no device location in this milestone.** "Find something
    similar nearby" searches near the cancelled stop, or the current or next one, which is where
    the traveller is, or nearly. This avoids a permission prompt and a privacy decision. Asking
    for the location once, on a "near me" request, is the follow-up if this falls short.
11. **What the assistant gains.** *Recommended:*
    - (a) The trip context carries **now**: the reader's local date and time, the trip's phase,
      today's day, and the current and next stop (from decision 5's function). The prompt says what
      to do with them.
    - (b) Day-of starter prompts on the sheet while the trip is under way.
    - (c) **Shifting the rest of today** ("we're 45 minutes late") is one Accept-all suggestion of
      `UpdateActivity` time moves, built from existing commands (ADR-067), not a new command.
      `find_free_time` and the conflict engine show what no longer fits.
    - (d) **Replacing a cancelled stop** is `search_places` near it, filtered by its tags, then a
      proposal that marks the old stop `pending` and adds the new one.

    No new write command, and no new tool unless the evals show the model cannot compose (c) from
    what exists. The M33 eval set gains a day-of case for each of (c) and (d).
12. **Changes made during the trip are announced in the chat.** *Recommended:* yes, while under
    way only. An accepted change to today's or tomorrow's stops posts a system line to the trip
    chat ("Mitchell moved …"), naming who accepted it and linking the stop. It is not a message
    anyone can edit. It needs a `kind` on `trip_messages` (a migration) and a line in ADR-073. The
    alternative is nothing: the group learns from the plan, if they look at it.
13. **The assistant inside the chat** (writing "@assistant, find us lunch" in the group chat).
    *Recommended:* **not in this milestone.** It mixes ADR-073's store with the assistant's, and it
    raises whose model budget a group question spends. Chat and Ask stay neighbouring tabs of one
    sheet. If wanted, it becomes a candidate.
14. **Push notifications and offline** ("leave in 15 minutes", today's plan with no signal
    abroad). *Recommended:* **out of scope.** Each needs an ADR, because `sw.js` forbids a fetch
    listener and has no push handler. Both go to `docs/candidates.md`. *Offline today* is the
    stronger case of the two: roaming is exactly when the plan is most needed.
15. **Who sees the during-trip surfaces.** *Recommended:* every member with the trip, whatever
    their role. Reading today's plan is reading, and Directions is a link. Editing still follows
    roles and the lapse rules, the chat still follows M46's entitlement, and the assistant still
    follows its own tiers. A share-link reader sees *Today* too, but without the chat or the
    assistant's write verbs.

## Scope

- The phase and *now* function (decision 5), and every surface that reads it.
- *Soon*: the departure-time countdown on Home's hero, and the *Add your flight* prompt.
- Flight details on a transit stop (decision 6): the contract, the domain, the editor, the card,
  the Money notebook's booked list, the public API, and trip export (M25). Their access rule.
- *Under way*: the *Today* card on Overview and on Home's hero, Plan opening on today, and the
  hero's badge naming the phase.
- Directions links (decisions 8 and 9), and the *Flight status ↗* link (decision 7).
- The assistant's knowledge of now, day-of starters, the two eval cases (decision 11).
- Change notices in the chat, if decision 12 is answered yes.

## Out of scope

- A live flight-status vendor, and anything that polls one.
- Push notifications, and offline access to the trip.
- The device's location.
- The assistant inside the group chat.
- Parsing confirmation emails (also out of M44).
- Anything after the trip beyond today's publish offer, such as photos, memories or a recap.
- Multi-day restructuring on the phone (SPEC §10: that belongs on desktop).

## Exit gate

- [ ] **Decisions 3–15 are answered and recorded here**, with an ADR for the phase and *now* rule
      (decision 5) and the contracts changelog entry for decision 6.
- [ ] **`tripNow` is right across zones and midnight**: a `fast-check` property over day zones,
      device zones and clock times. It was seen red with the zone conversion removed.
- [ ] **A trip replayed from a log written before the flight fields equals its stored
      projection**, which a test shows.
- [ ] **A confirmation number never reaches a share link or a published day**: an integration
      test reads both.
- [ ] **Under way, the trip opens on Today**, and *Next* names the right stop for a frozen clock,
      including a stop after midnight and a day with no zone.
- [ ] **Directions opens the right destination**: a unit test over a venue, a city-precision stop
      and a stop reached by train, seen red with the coordinates dropped.
- [ ] **The assistant answers "what's next?" and "we're running 45 minutes late" correctly** on
      the M33 eval set's day-of cases, at their stated cost.
- [ ] **Nothing renders when it does not apply**: a planning-phase trip and an ended trip show no
      *Today* card and no flight prompt. The e2e spec shows both.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: a trip frozen mid-day shows
      Today with Now and Next, Directions has the right link, and a change accepted from Ask
      appears in the chat (if decision 12 is yes).
- [ ] **[walk]** On a phone, against the PR preview, with a trip dated today: open it from Home,
      tap Directions, ask the assistant to push dinner back, accept, and see the chat line from a
      second account.
- [ ] A retro is appended at gate close.
