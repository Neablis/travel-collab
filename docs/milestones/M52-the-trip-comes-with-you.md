# M52 — The trip comes with you: a notebook for today, and an assistant the group can ask

**Status:** **Scoped 2026-10-23 with Mitchell: every decision is answered** (the third review,
recorded under each decision below). The plan is `docs/plans/2026-10-23-M52-the-trip-comes-with-you.md`.
Proposed 2026-10-22 by Mitchell, placed after M51 and ahead of M49. His answers are below under *Answered*: what it is for, where it lives (a *During the
trip* notebook that Overview swaps to), five of the first set of recommendations, and the
assistant in the group chat. In a second review the same day he answered decisions 11, 12, 17
and 18, and each is marked **Answered** where it stands. The rest under *Open* are
recommendations, and none has been answered. Minted the same day (see `docs/milestones/README.md`, *2026-10-22 — minted: M52, the
trip comes with you*).

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

And the constraint: *"keep our principle of simple ui with functionality that expose itself to
you just when you need it."*

### What already exists (code survey, 2026-10-22)

| Need | What exists | What is missing |
|---|---|---|
| Know the trip's phase | `orderHomeTrips` bands trips as under way, upcoming, undated or past (`apps/web/src/lib/homeTripOrder.ts:64-73`). `tripHasEnded` drives the publish offer (`:18`). "Today" is the reader's calendar date (`lib/today.ts:19,39`). | A trip and its times carry **no time zone**: a `TimeWindow` is plain `HH:MM` (`packages/contracts/src/activity.ts:7`). The only zone is the server-derived `TripGlobalsDay.timeZone`, from the day's first stop with coordinates (`packages/contracts/src/globals.ts:86-89`, `server/timeZones.ts:33`). |
| Notebooks that change with the phase | **Overview is a notebook**, chosen in one place for the lens and the server read (`lib/overviewPage.ts`, `pickOverviewPage`). **Before you go** is seeded already: clocks, the sun, weather and country facts, for the week before leaving (`packages/pages/src/templates.ts:240-285`). A missing seeded notebook can be added to an existing trip (`packages/pages/src/defaultNotebooks.ts:46,69`, `instantiateMissingDefaults(…, only)`). | A notebook for the days *of* the trip, and a reason for Overview to show it. |
| A filter applied to every widget | **`ItemScope` and `narrow`** (`packages/pages/src/registry-types.ts:565-578`, `repeat.ts`): *"a filter the author did not have to set … applies it to a dimension the widget left unbound … and an explicit binding still wins."* A repeat uses it to hand each day to the widgets inside it. `WidgetContext.today` exists, read on the client (`registry-types.ts:~485-499`). | A page-level scope of *today*. |
| Countdown | `formatCountdown` already words every phase: "in N days", "starts tomorrow", "day X of Y", "ended N days ago" (`packages/pages/src/format.ts:90`). Home's hero shows a date countdown (`components/home/NextTripHero.tsx:232-249`). | A countdown to a **departure time**. The hero's badge reads "Next trip" even mid-trip (`NextTripHero.tsx:230`). |
| Flights | A transit stop has `mode: "flight"`, `location`, `endLocation`, and its `timeWindow` as departure and arrival (`activity.ts:276,304-308,622-630`). | Flight number and confirmation. M44's `booking` object is proposed, not built. |
| Directions | `Location` carries a name, `lat`/`lng`, an address and a `precision` (`activity.ts:81-177`). | No outbound map link anywhere. The app only *parses* pasted maps links (`lib/pasteToStop.ts:68,117`). |
| Assistant | The rail is a sheet on the phone. Its write tools cover every batchable command (`server/assistant/tools/planning.ts`), plus `find_free_time` and `search_places` (`tools/places.ts:146`). The tools offered on each step are chosen in `server/ai/handleAskRequest.ts:788-852` (`activeTools`). Quotas are per user (`server/quota.ts:156,238`). | **No date or time reaches it**: neither `server/assistant/prompt.ts` nor `context.ts` passes one. |
| Trip chat | **Built in M46** (ADR-073). `@` already mentions a person, a notebook, a day or a stop (`components/chat/TargetPicker.tsx:40-41`). | The assistant cannot be addressed from it. |
| Plans and AI | `free` holds no AI. `plus` and `premium` hold `ai.ask` and `ai.command`. `studio` holds `ai.ask` alone (`server/entitlements/planVersions.ts:190,213,248,286,324`). | — |
| Accepting a suggestion | Any editor can accept any pending change (`server/suggestions/accept.ts:57`). | A suggestion only its asker may accept. |
| Phone and PWA | Installable since M39. `public/sw.js` has no push handler and forbids a fetch listener (`:5-19`). | Push and offline. Both stay out (decision 7). |

## Where it lives (answered by Mitchell, 2026-10-22)

> *"Make this a base template ("During trip" notebook) that has some "Today" filter that is always
> applied to any widget that has a date picker automatically. And all the other experiences are
> built by introducing new widgets that give the rest of the functionality. Then its just the
> overview page swaps with this experience during trip, very simple."*

So the whole during-trip experience is **one notebook, a page-level Today scope, and new
widgets**. Nothing else in the chrome changes:

- **A seeded template, *During the trip*.** It is a notebook like *Before you go*. It can be
  edited, reset, and found in the notebook index.
- **A Today scope on the page.** Every widget on it with a day input left unset reads **today's
  day**, through the same `narrow` a repeat uses. A widget given an explicit day keeps it. So
  today's schedule, weather, sunset and spend are the existing widgets, scoped by the page, with
  no new versions of them.
- **New widgets for what is not there yet**: now and next, directions, flights, the group chat,
  and day-of prompts for the assistant (*Widgets*, below).
- **Overview swaps.** While the trip is under way, the Overview tab shows *During the trip*
  instead of the Overview notebook. `pickOverviewPage` is the one place that decides. Nothing else
  moves: the tab bar, Plan, Map, the Ask/Chat button and Home stay as they are.

**Interaction sketch (phone, day 3 of a Lisbon trip).** Open the trip from Home, whose badge
reads "Day 3 of 7". Overview shows *During the trip*:

1. **Now and next.** *"Now: Castelo de São Jorge, until 13:00. Next: lunch at Tasca do Chico in
   40 min. [Directions]"*
2. **Today's flight**, only on a day with one.
3. **The rest of today**: the itinerary widget, scoped to today.
4. Weather and sunset, scoped to today.
5. **The group chat**: the last few messages, with *Open chat*.
6. **Ask**: chips such as *Running late*, *Move dinner later* and *Something closed*. Each opens
   the assistant sheet with the prompt filled in.
7. A link to the full Overview.

Tapping *Directions* leaves for the maps app. Tapping a stop focuses it on the board, as chat
chips do.

## Decisions

### Answered by Mitchell, 2026-10-22

1. **It is for the days around and during the trip**: flight details and a countdown just before,
   today's overview with the next stop and directions during, the assistant for questions and
   changes, and the trip chat. *(His four bullets.)*
2. **Placed after M51**, as the next milestone. M51 stays current.
3. **Where it lives is the *During the trip* notebook with a Today scope**, its new widgets, and
   Overview swapping to it while the trip is under way (above). This replaces the earlier
   recommendation, which was Today cards on Overview and Home's hero.
4. **No live flight tracking.** No flight-status vendor, polling job or flight alerts. It is filed
   as a candidate.
5. **Flight details come in this milestone, on M44's `booking` object**: `booking: {
   confirmation?, provider?, url? }`, plus an optional `reference` for the carrier's code, labelled
   *Flight number* on a flight leg. M44 decision 2 comes with it: editors and up see a
   confirmation code, and share links and published days never do. M44 keeps containment only.
   *(Read from "Flight details: Agreed keep there", answering the recommendation to take
   `booking` into M52; confirm at scoping.)*

   **Superseded at scoping, 2026-10-23 (Mitchell): flight number only.** A transit stop gains an
   optional `flightNumber`, shown and edited on a flight leg. The `booking` object, the
   confirmation code and its access rule stay in **M44**. A flight number is not secret, so it
   travels wherever the stop does (share links, published days, the API, export).
6. **No device location.** Instead, **"nearby" means where the plan says you are now**. A tool
   that knows this is offered to the assistant **only while the trip is under way**, so no other
   turn carries it. Mitchell: *"make sure we have tools that understand 'Im on the trip, so when i
   say nearby it means the nearby location at this current time' and that tool is only included
   then rather than bloat before"*. Its shape is decision 13.
7. **Push notifications and offline are out.** Each is filed as a candidate. Offline is the
   stronger case: roaming is exactly when the plan is most needed.
8. **The assistant can be asked from the group chat**, by `@assistant` beside the existing
   person and notebook mentions. Mitchell: *"limit it to only work to those on paid tiers (so
   promotes paying), applies to that persons quota and the accepting the suggestion only applies
   to those that asked"*. So:
   - Only an asker whose own plan holds the assistant can use it. A free account holds no AI
     today.
   - The turn spends the **asker's** quota and is recorded against them in the ledger (M31).
   - **Only the asker may accept** what it proposes.

   The rest of its rules are decision 18.

### Open (recommendations, except where marked **Answered**)

9. **The template's name and seeding.** **Answered by Mitchell, 2026-10-22:** *"3 days sounds
   good to swap it in but it should be available always in the notebooks view if they want to
   modify what they get shown daily. The default should be the daily good default, but like
   everything it's flexible."* So:
   - It is titled **During the trip**, with seed key `during-the-trip` and
     **`seedIntoNewTrips: true`**: it comes with every trip, beside Overview, *Before you go*,
     *Bookings* and *Money*.
   - It is always in the notebook index, so anyone with edit access can change what their trip
     shows each day, at any time.
   - **Trips that already exist get it once**, by `instantiateMissingDefaults(…, only:
     "during-the-trip")`, the next time their notebook index loads. That is idempotent. A trip
     that deleted it is not given it again, and it can be re-added from the template gallery.
   - The seeded content is the default described above (*Where it lives*). The notebook is the
     trip's own copy after that, like every seeded notebook. A reset restores the default.
   - **The 3-day mark is when Overview swaps.** **Confirmed at scoping, 2026-10-23 (Mitchell):
     from 3 days before.** Overview shows *During the trip* from *soon* through the end date
     (decision 11 is amended to match). Before day 1 its widgets show their empty-today states,
     except the flights widget's countdown and *Add your flight*.
   - A trip whose *During the trip* notebook was deleted keeps its ordinary Overview throughout.
10. **What the Today scope is.** **Answered at scoping, 2026-10-23 (Mitchell): a general
    notebook setting, not a today-only hook.** *"Someday i want to have settings for a notebook,
    where we trigger 'is this dynamic (follows current date), scoped to some specific date, or
    all' … and that can trigger settings for some widgets … so maybe dont make it a hook that
    'just' does day scope, and more its a 'global', to the current notebook setting that we can
    reuse later."* So the page carries **`dateScope: "all" | "today" | { date }`**, default `"all"`
    (today's behaviour), read by every widget through **one resolver** that later notebook
    settings extend. The contract carries all three. This milestone builds and tests `"all"` and
    `"today"`. `{ date }` is accepted but has no settings control until a notebook settings panel
    exists. The template sets `"today"`. The rest below stands, with "the scope" meaning
    `dateScope: "today"`. *Earlier recommendation:* a page context flag (`scope: "today"`, beside
    `kind: "overview"`), which every new page can be given and the template sets. *Today* is the
    trip day whose date is today, by decision 12's clock. Every widget on the page with an unset
    `day` (or `dates`) input is narrowed to it, the way `repeat` narrows. The widget picker marks
    *"follows today"* on a widget it will scope.

    **Outside the trip's dates, answered by Mitchell, 2026-10-22:** *"like all other widgets they
    should know what to render if data is empty. So a day filter before trip should show lots of
    nothing today default values."* Today is always the real today. On a date that is not a trip
    day, each scoped widget is narrowed to *no day* and renders **its own empty state**: "Nothing
    planned today", "No flight today", and so on. Nothing is substituted for today (the earlier
    recommendation read day 1 before the trip), and there is no page-level banner. Every widget
    the template seeds, and every new widget (decision 15), therefore needs a written
    empty-today state, as the seeding rule already demands of an empty trip (`templates.ts:34`).
11. **When the swap happens, and what *soon* does.** **Answered by Mitchell, 2026-10-22: as
    recommended. Amended at scoping, 2026-10-23: Overview swaps from *soon*, not only under way**
    (decision 9). The *soon* bullet below is replaced by: Overview shows *During the trip*, whose
    flights widget offers *Add your flight* if the trip has none, and Home's badge counts down to
    the first departure.
    - **Under way** (start date to end date): Overview shows *During the trip*, with a quiet
      *Whole trip →* link to the usual Overview.
    - **Soon** (up to 3 days before): Overview stays as it is. The notebook is planted, and its
      flights widget offers *Add your flight* if the trip has none. Home's badge counts down to
      the first departure's time ("Flight in 2 days, 7 h").
    - **Ended**: Overview goes back to normal, and the publish offer stays.

    The alternative was swapping to *Before you go* during *soon*. It was not chosen, because
    that page's content is fixed per trip and is not rewritten on existing trips, so a flight
    widget added to it would reach new trips only.
12. **How *now* is computed when times carry no zone.** **Answered by Mitchell, 2026-10-22:
    every time is local time, as recommended.** A stop's `HH:MM` is local
    to **its day's zone** (`TripGlobalsDay.timeZone`), falling back to the device's zone. *Now*
    is the device clock converted into that zone. One pure function in `packages/domain`,
    `tripNow(trip, globals, now) → { phase, dayId, current, next }`, with the clock passed in
    (invariant 4). The Today scope, the now-and-next widget, Home's badge and the assistant all
    read it. Its property test covers midnight, a day with no zone, and a flight that lands in
    another zone.
13. **The *near me now* tool (decision 6).** **Answered at scoping, 2026-10-23: as recommended.** **`find_places_near_now`**, added to
    the offered tools in `handleAskRequest.ts`'s `activeTools` **only when `tripNow` says under
    way**. It resolves *here* in this order:
    1. the current stop's location;
    2. the last stop today that has passed;
    3. the next stop;
    4. the day's city.

    It returns that anchor ("near Castelo de São Jorge") beside the results, so the answer can say
    where it searched. It calls the same place search as `search_places`, so no second vendor or
    quota is involved. It is cheaper in tokens than teaching every turn's prompt about *here*. It
    is one more tool in the M33 evals, with a day-of case that must choose it, and a planning-phase
    case that must not see it.
14. **What else the assistant gains.** **Answered at scoping, 2026-10-23: as recommended.**
    - (a) Every turn on an under-way trip carries **now**: the local date and time, the phase, and
      today's current and next stops, from `tripNow`.
    - (b) **"We're 45 minutes late"** is one Accept-all suggestion of `UpdateActivity` time moves
      (ADR-067), not a new command. The conflict engine shows what no longer fits.
    - (c) **"X is closed, find something similar"** is `find_places_near_now` (or a search near
      the stop), filtered by the stop's tags, then a proposal that marks the old stop `pending`
      and adds the new one.

    There are two eval cases for (b) and (c).
15. **The new widgets.** **Answered at scoping, 2026-10-23: all five, as recommended.** each is a preset in `packages/pages/src/presets.ts` and
    reads well with no data, as the seeding rule demands (`templates.ts:34`):
    - **`trip.now`**, *Now and next*: the current and next stop, the time until it, and
      Directions. It re-renders each minute while visible. Today's widget context carries a date
      only, so this one gains `now` (decision 12), which only it reads, as `trip.countdown` alone
      reads `today`.
    - **`stop.directions`**, *Directions*: a link to the bound stop, or to *next* under the Today
      scope (decision 16).
    - **`trip.flights`**, *Your flights*: today's flights, or the next one. It shows the flight
      number, times in each end's local zone, the countdown to departure, and the confirmation for
      editors. With none, it offers *Add your flight*, which opens the stop editor prefilled as a
      flight.
    - **`chat.recent`**, *Group chat*: the last three messages and *Open chat*. It is absent on a
      trip whose chat the reader cannot see.
    - **`assistant.prompts`**, *Ask*: day-of chips that open the sheet prefilled. It is absent for
      a reader with no assistant, and per SPEC §27 nothing renders disabled.
16. **Which maps app Directions opens.** **Answered at scoping, 2026-10-23: Google Maps, as recommended.** Google Maps' universal URL
    (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`). It falls back to the name
    and address at `city` precision, and takes `travelmode` from the leg's `mode` when a transit
    stop leads in. It opens the app on Android and iOS when installed. There is no per-account
    preference until someone asks for one. The stop's own detail sheet also gets the link
    whenever the stop has coordinates. It costs one link and helps while planning too.
17. **Changes made during the trip are announced in the chat.** **Answered by Mitchell,
    2026-10-22: yes**, while under way only. An accepted change to today's or tomorrow's stops posts a system line ("Mitchell
    moved Dinner at Tasca to 20:30") that links the stop and cannot be edited. With decision 18,
    an `@assistant` change accepted in the chat says so in the same thread.
18. **How `@assistant` in the chat works (decision 8).** **Answered at scoping, 2026-10-23: as
    recommended**, with what it reads answered earlier:
    - **Store.** The answer is a message in `trip_messages`, with an author `kind` of
      `assistant` and a `requested_by` naming the asker. ADR-073 is amended. A migration adds the
      columns, and the same `kind` serves decision 17's system lines.
    - **Who can call it.** The asker's own plan decides, by the existing entitlements: `ai.ask`
      to answer, and `ai.command` to propose changes. A Studio asker gets answers. A free member
      sees `@assistant` in the mention list with *"Asking the assistant in chat comes with
      Plus"* and an upgrade link: an offer, not a disabled control. The asker's role on the trip
      still caps what the turn may propose, exactly as in Ask.
    - **What it reads. Answered by Mitchell, 2026-10-22:** *"keep in a config to play with, when
      I say '@assistant can you fix this problem?' It calls a tool that gets last x messages (we
      hard code x but it will be a variable for the tool call so we can make the tool more
      flexible in future) and try to understand what the problem was"*. So:
      - The chat is **not** put into the turn's context up front. A chat-started turn is offered
        a tool, **`read_chat({ limit? })`**, which returns the last `limit` messages: author,
        time and text, with `@day`/`@stop` targets resolved to names. The model calls it when it
        needs the conversation to understand the ask ("fix this problem", "find us lunch").
      - `limit` is a tool parameter from day one. Today the model is told to leave it unset, and
        it **defaults to `CHAT_CONTEXT_MESSAGES = 20`**. A hard ceiling, `MAX_CHAT_MESSAGES_READ`,
        caps any value it passes. Both are named constants in `server/assistant/limits.ts`, beside
        `MAX_DAYS_READ_PER_TURN`, so the number can be tuned without touching the tool.
      - The tool is offered **only on turns started from the chat**, on the same `activeTools`
        rule as `find_places_near_now` (decision 13). An Ask-tab turn never carries it.
      - Every member can see that the assistant read the chat, because its reply is in the
        thread. The M33 evals gain a chat case whose problem is stated only in earlier messages,
        and which therefore has to call `read_chat`.
    - **Accepting.** Its proposal appears in the chat as a card that **only the asker may accept
      or dismiss**. Everyone else sees *"Waiting on Mitchell"*. That is a new rule on a
      suggestion (`requested_by`), enforced in `acceptSuggestionChanges`, beside its editor check
      (`accept.ts:57`). The asker must also be an editor to accept, as today. A viewer's
      `@assistant` gets answers only.
    - **While it works.** The thread shows *"Assistant is thinking…"* and the reply lands whole.
      It is not streamed into the chat.
    - **Lapses.** When the owner's `trip.collaborators` lapses, the chat is read-only (M46
      decision 2), and so `@assistant` is unavailable.
19. **What "soon" means.** **Answered at scoping, 2026-10-23: as recommended.** 3 days before the start date, the "couple days before"
    of the ask.
20. **Who sees the notebook.** **Answered at scoping, 2026-10-23: as recommended.** every member, whatever their role. Reading today's
    plan is reading, and Directions is a link. A share-link reader sees it as read-only, without
    the chat or Ask widgets.

## Scope

- `tripNow` and the phase (decisions 12 and 19), and its ADR.
- The Today page scope (decision 10), and the *During the trip* template planted at *soon*
  (decisions 9 and 11).
- The Overview swap and Home's phase badge (decision 11).
- The flight number (decision 5, as amended): the contract, the domain, the editor, the card,
  the public API, and trip export (M25). The `booking` object stays in M44.
- The five widgets (decision 15) and Directions on the stop sheet (decision 16).
- The assistant's *now*, `find_places_near_now` offered only under way, and the eval cases
  (decisions 13 and 14).
- `@assistant` in the chat (decision 18), and the change lines (decision 17).

## Out of scope

- The `booking` object and confirmation codes (decision 5, as amended; M44).
- A notebook settings control, and `dateScope: { date }` behaviour (decision 10; the contract
  carries it).
- A live flight-status vendor, polling, and flight alerts (decision 4; a candidate).
- Push notifications, and offline access to the trip (decision 7; candidates).
- The device's location (decision 6).
- Parsing confirmation emails.
- Anything after the trip beyond today's publish offer.
- Multi-day restructuring on the phone (SPEC §10: that belongs on desktop).

## Exit gate

- [ ] **Every decision is answered and recorded here** (done at scoping, 2026-10-23), with:
      - ADR-080 for the phase, *now* and the notebook `dateScope`;
      - ADR-073 and ADR-067 amended for `@assistant`;
      - the contracts changelog entries for `flightNumber` and `dateScope`.
- [ ] **`tripNow` is right across zones and midnight**: a `fast-check` property over day zones,
      device zones and clock times, seen red with the zone conversion removed.
- [ ] **The Today scope narrows only unset days**: on a page with the scope, an unbound
      `day.detail` shows today, and one bound to day 1 still shows day 1. Seen red with the
      scope removed.
- [ ] **Overview swaps from *soon* through the end date**: a unit test over `pickOverviewPage`
      for a planning, soon, under-way and ended trip (decision 9, amended).
- [ ] **Every trip has *During the trip***: a new trip is seeded with it, and an existing trip
      gains it once on its next index load and not again after a delete. An integration test
      shows both.
- [ ] **Off a trip day, every widget on the seeded page renders its empty-today state**:
      `templates.test.ts`, which already renders every seeded widget against new trips, renders
      this page with a clock before the trip and after it. Seen red with one widget's empty
      state removed.
- [ ] **A trip replayed from a log written before `flightNumber` equals its stored projection.**
- [ ] **`find_places_near_now` is offered only while the trip is under way, and `read_chat` only
      on a chat-started turn**: a test of the offered tools for a planning trip, an under-way
      trip, an Ask turn and a chat turn. `read_chat`'s default and its ceiling are read from
      `limits.ts`, which a test changing the constant shows. The M33 day-of cases pass, at their
      stated cost.
- [ ] **Only the asker can accept an `@assistant` proposal**: an integration test is refused
      for another editor and accepted for the asker. **A free member's `@assistant` spends
      nothing**, and a paid asker's turn is recorded against the asker.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**, with a trip frozen
      mid-day: Overview shows *During the trip* with Now and Next; Directions has the right link;
      `@assistant push dinner back an hour` in the chat posts a reply and a card that the asker
      accepts.
- [ ] **[walk]** On a phone, against the PR preview, with a trip dated today: open it from Home,
      tap Directions, and ask `@assistant` in the chat to find lunch nearby. Accept as the asker,
      and see the change line from a second account, which could not accept it.
- [ ] A retro is appended at gate close.
