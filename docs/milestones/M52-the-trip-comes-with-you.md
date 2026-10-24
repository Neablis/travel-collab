# M52 — The trip comes with you: a notebook for today, and an assistant the group can ask

**Status (2026-10-24): gate 10 of 13.** Parts 1–10 are merged (PRs 530–537, 539, 540, and
PR 541, part 9's follow-up). **Part 11** (PR 542, `claude/m52-part11-today-weather-settings`:
Today's weather on the real day, *Weather Report* and *Sunrise/Sunset*, notebook settings
supersede widget settings) is in review, from Mitchell's 2026-10-24 decisions (decisions 9 and
10, amended); it reopened the Today-scope box. Three boxes are open: that one (part 11's merged
CI), the live M33 day-of eval and the [walk] (*Exit gate*); `pnpm milestone close M52` refuses
until they are ticked.
**Scoped 2026-10-23 with Mitchell: every decision is answered** (the third review,
recorded under each decision below). The plan, `docs/plans/2026-10-23-M52-the-trip-comes-with-you.md`, was deleted at the close (it is in git history; what it held worth keeping is in the retro's *Leftovers*).
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
  day**, through the same `narrow` a repeat uses. A widget given an explicit day keeps it
  (*reversed 2026-10-24: the notebook's setting wins; decision 10, amended*). So
  today's schedule, weather, sunset and spend are the existing widgets, scoped by the page, with
  no new versions of them.
- **New widgets for what is not there yet**: now and next, directions, flights and the Trip chat
  card (*Widgets*, below; the day-of prompts for the assistant were dropped, decision 15).
- **Overview swaps.** While the trip is under way, the Overview tab shows *During the trip*
  instead of the Overview notebook. `pickOverviewPage` is the one place that decides. Nothing else
  moves: the tab bar, Plan, Map, the Ask/Chat button and Home stay as they are.

**Interaction sketch (phone, day 3 of a Lisbon trip).** Open the trip from Home, whose badge
reads "Day 3 of 7". Overview shows *During the trip*:

1. **Now and next.** *"Now: Castelo de São Jorge, until 13:00. Next: lunch at Tasca do Chico in
   40 min. [Directions]"*
2. **Today's flight**, only on a day with one.
3. **The rest of today**: the itinerary widget, scoped to today.
4. Weather and sunset, scoped to today (*amended 2026-10-24, decision 9: two sections,
   Weather Report and Sunrise/Sunset, on the real day*).
5. **Trip chat**: the last few messages, with *Open chat* (on a solo trip, *Add other travelers
   to see the trip chat*; decision 15 as amended).
6. ~~**Ask**: chips such as *Running late*, *Move dinner later* and *Something closed*. Each opens
   the assistant sheet with the prompt filled in.~~ Dropped by Mitchell, 2026-10-23 (decision 15).
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
     **Amended by Mitchell, 2026-10-24: no template-version tracking.** A reset restores the
     *current* default. There is no restoring a specific earlier version, and no notice or roll
     forward when the default changes after a trip got its copy. Pages keep only `seedKey`.
   - **The 3-day mark is when Overview swaps.** **Confirmed at scoping, 2026-10-23 (Mitchell):
     from 3 days before.** Overview shows *During the trip* from *soon* through the end date
     (decision 11 is amended to match). Before day 1 its widgets show their empty-today states,
     except the flights widget's countdown and *Add your flight*.
   - A trip whose *During the trip* notebook was deleted keeps its ordinary Overview throughout.
   - **Amended by Mitchell, 2026-10-23: it cannot be deleted**, like Overview (`page-undeletable`).
     So every trip has it: new trips are seeded with it, and every existing trip gains it once on
     its next notebook-index load (no "was deleted" skip). The bullet above no longer applies.
     It is titled **Today** (seed key `today`), confirmed by Mitchell 2026-10-23; this replaces
     *During the trip* / `during-the-trip` above.
   - **Amended by Mitchell, 2026-10-24 (part 11, PR 542): the *Weather and light* section is
     split into two, *Weather Report* and *Sunrise/Sunset*.** Existing Today notebooks keep the
     old heading until someone resets them: there is no template-version tracking (the
     amendment above), so a reset is the only way a trip's copy picks up the new default.
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

    **Amended by Mitchell, 2026-10-24 (part 11, PR 542): weather and sunrise/sunset follow the
    real day, not the trip's dates.** *"the logic should not be 'before or after trip' just the
    day is locked to today. Having no events makes sense though."* On a Today notebook, the
    weather and sunrise/sunset widgets show **today's** date before, during and after the trip;
    the itinerary-style widgets keep their empty-today states off the trip's dates, as above. The
    place is the trip day nearest today (today clamped into `[start, end]`; `nearestTripDay`,
    `packages/pages/src/dateScope.ts`). Mitchell: *"Good with that decision."* The device's
    location is not read (decision 6). The weather route gains one point for that (the contracts
    changelog, 2026-10-24, part 11).

    **Amended by Mitchell, 2026-10-24 (part 11, PR 542): a notebook setting supersedes a widget
    setting.** *"Notebook level settings > manually set widget settings > defaults."* This
    reverses *"an explicit binding still wins"* above and ADR-080 §4 (amended there, dated). One
    general mechanism does it: `NOTEBOOK_SETTINGS` and `supersededParams`
    (`packages/pages/src/dateScope.ts`) name the widget params each notebook setting takes over,
    and those params are dropped from the widget's stored params when it renders and are not
    offered in its settings panel (or a repeat's). Under `dateScope: "today"` a widget's day
    (and dates) param therefore disappears from its settings, and a stored day no longer
    applies. A page rendered with no reader's clock (the invite card) supersedes nothing, so a
    stored day stands there. Later notebook settings add a row to `NOTEBOOK_SETTINGS` rather
    than a hook.
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
    is the device clock converted into that zone. One pure function in `packages/pages` (moved from `packages/domain` at scoping: the client may not import the domain; ADR-080),
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
      flight. **As built (part 7, PR 536):** the flight number, the route, the departure time in the leg's
      zone and the countdown; no arrival time, because a flight stop's window is one day's
      `HH:MM` and cannot cross midnight (KI-2026-10-23-b, home M44), and no confirmation, which
      stayed in M44 with `booking` (decision 5, as amended).
    - **`chat.recent`**, *Trip chat* (first written as *Group chat*; amended below: a mini chat
      card, N a setting): the last few messages and *Open chat*. On a solo trip it shows *Add
      other travelers to see the trip chat* instead. It is absent only for a reader the chat
      refuses (a share link's).
    - ~~**`assistant.prompts`**, *Ask*~~ (**dropped by Mitchell, 2026-10-23; see the amendment below**): day-of chips that open the sheet prefilled. It is absent for
      a reader with no assistant, and per SPEC §27 nothing renders disabled.
    **Amended by Mitchell after walking part 8's preview, 2026-10-23:** the *Ask* widget is
    dropped (no widget prefills the AI assistant); *Group chat* is a mini chat card, the last N
    messages (a setting, default 3) in the chat's own message style with an *Open chat* row, the
    whole card one control that opens the chat where it lives. Under the Today scope an unbound
    Weather widget shows only today.
    **Amended by Mitchell, 2026-10-23 (later the same day):** the notebook page's assistant
    panel gets the board's *Chat | Ask* switch, and the card opens that Chat tab in place
    (`?chat=open` is gone). **A solo trip has no chat anywhere**, board and notebook alike: no
    Chat tab, no ⌘K *Open chat*, no chat card that opens a chat, only the assistant (the card's
    solo empty state is the 2026-10-24 amendment below). This reverses M46's solo Chat tab on
    the board.
    **Amended by Mitchell after walking part 8's preview, 2026-10-24:** the widget is titled
    **Trip chat** (not *Group chat*; preset key `chat.recent` unchanged). It always renders:
    on a solo trip it shows an empty state, *Add other travelers to see the trip chat*, and is
    not a chat control; on a trip with chat but no messages it shows the chat card with
    *No messages yet* and still opens the chat.
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
    **Amended by Mitchell, 2026-10-24: only a change that comes from the chat posts a line**: a
    suggestion accepted there, or an `@assistant` change made there. A direct edit (moving or
    retiming a stop on the board or a notebook) posts nothing. *"If people are chatting, post to
    chat; if someone is chatting with AI in chat, post to chat. Otherwise don't."* That is how
    it is built (part 7), so no code changes.
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
      or dismiss**. Everyone else sees *"Waiting on Mitchell"* (as built in part 6, PR 535: editors
      and the owner read it on the card while it is pending; a viewer or suggester reads *"Only
      Mitchell can accept this"*). That is a new rule on a
      suggestion (`requested_by`), enforced in `acceptSuggestionChanges`, beside its editor check
      (`accept.ts:57`). The asker must also be an editor to accept, as today. A viewer's
      `@assistant` gets answers only.
    - **When the asker can no longer accept. Answered by Mitchell, 2026-10-23:** the trip owner
      can always **dismiss** an asker-only proposal, so one whose asker left the trip or lost edit
      access does not sit on the board for 90 days. Only the asker can ever accept it.
    - **The Ask tab gets the same `ai.command` gate. Answered by Mitchell, 2026-10-23: fix inside
      M52** (part 5). Before M52 the Ask tab never checked `ai.command`, so a Studio account could
      propose changes there; the chat route checks it, and Ask turns now do too.
    - **While it works.** The thread shows *"Assistant is thinking…"* and the reply lands whole.
      It is not streamed into the chat.
    - **Lapses.** When the owner's `trip.collaborators` lapses, the chat is read-only (M46
      decision 2), and so `@assistant` is unavailable.
19. **What "soon" means.** **Answered at scoping, 2026-10-23: as recommended.** 3 days before the start date, the "couple days before"
    of the ask.
20. **Who sees the notebook.** **Answered at scoping, 2026-10-23: as recommended.** every member, whatever their role. Reading today's
    plan is reading, and Directions is a link. A share-link reader sees it as read-only, without
    the Trip chat widget (the Ask widget was dropped, decision 15).
21. **The trip under way, over the public API.** **Added and answered by Mitchell, 2026-10-23.**
    Two endpoints, not one: **`GET /v1/trips?active=true`** filters the existing list to the trips
    whose `tripNow` phase is `underway` (today, in the trip's own zone, by ADR-080's fallback, falls
    within its dates; an undated trip is never active), and **`GET /v1/trips/{tripId}/today`**
    (`trips:read`, `viewer`) answers today's date and zone, the phase, the day (or none), today's
    stops in order in the shape the API already uses for a stop, and which stop is **now** and which
    is **next**, computed by `tripNow`, so the API and the *Now and next* widget agree. An optional
    `?timeZone=` is ADR-080's asker zone: validated, never stored. Off a trip day it answers 200 with
    the phase and no stops. Its own part (10), independent of part 9.

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
- The trip under way over the public API: `?active=true` and `/today` (decision 21).

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

- [x] **Every decision is answered and recorded here** (done at scoping, 2026-10-23), with:
      - ADR-080 for the phase, *now* and the notebook `dateScope`;
      - ADR-073 and ADR-067 amended for `@assistant`;
      - the contracts changelog entries for `flightNumber` and `dateScope`.
      *Evidence:* decisions 1–21 above, each marked answered; `docs/architecture/ADR-080-a-trip-knows-what-day-it-is.md`;
      `ADR-073-trip-chat-is-its-own-store.md:94` and `ADR-067-a-multi-change-assistant-turn-is-stored-as-suggestions.md:67`
      (*Amendment — 2026-10-23 (M52)*); `docs/contracts/CHANGELOG.md:41` (`dateScope`) and `:94` (`flightNumber`).
- [x] **`tripNow` is right across zones and midnight**: a `fast-check` property over day zones,
      device zones and clock times, seen red with the zone conversion removed.
      *Evidence:* `packages/pages/src/now.test.ts:194-212` (arbitraries over day zones, a null zone,
      device zone and clock); PR 530's body: zone conversion removed in `now.ts` → "9 of 12 failed";
      CI run 39881259798 green on its head `dc128f6`, merged `e50669c`.
- [ ] **The Today scope supersedes a widget's day** (reworded 2026-10-24, decision 10 as
      amended: *"Notebook level settings > manually set widget settings > defaults"*): on a page
      with the scope, an unbound `day.detail` shows today, **and so does one bound to day 1**;
      the day param is not offered in the widget's settings there. Seen red with the supersede
      removed. On a Today page, weather and sunrise/sunset show today's date off the trip's dates
      too, at the nearest trip day's place.
      *Reopened 2026-10-24:* this box first read "one bound to day 1 still shows day 1" and was
      ticked on PR 533 (`registry.test.ts:727`; CI run 39913262997 green on `d386be6`, merged
      `7485b3f`). Mitchell reversed that rule; the new rule is part 11's (PR 542, in review). It
      ticks on part 11's merged CI and the red-first edit in its body.
- [x] **Overview swaps from *soon* through the end date**: a unit test over `pickOverviewPage`
      for a planning, soon, under-way and ended trip (decision 9, amended).
      *Evidence:* `apps/web/src/lib/overviewPage.test.ts:20-25` (planning and ended → Overview, soon
      and under way → Today); PR 540, CI run 40029849919 green on `c30298d`, merged `a06fe13`.
- [x] **Every trip has *During the trip***: a new trip is seeded with it, and an existing trip
      gains it once on its next index load and not again after a delete. An integration test
      shows both.
      *Evidence (as amended, decision 9: titled Today, undeletable, so "not again after a delete"
      became "refused, and restored on a log that shows it deleted"):*
      `apps/web/src/server/defaultNotebooks.int.test.ts:120` (seeded into a new trip), `:129` (gained
      once by an older trip), `:149` (refuses delete; comes back under its old id), `:178` (resets);
      PR 540, CI run 40029849919 (`test / integration` green) on `c30298d`, merged `a06fe13`.
      Not seen on production: the backfill and the missing delete control wait on the [walk] box.
- [x] **Off a trip day, every widget on the seeded page renders its empty-today state**:
      `templates.test.ts`, which already renders every seeded widget against new trips, renders
      this page with a clock before the trip and after it. Seen red with one widget's empty
      state removed.
      *Evidence:* `packages/pages/src/templates.test.ts:399` "renders every widget on Today as its
      empty-today state, before the trip and after it"; PR 540's body: deleting the no-day line in
      `renderMacro` → `- "day.detail": "Nothing planned today"` / `+ "day.detail": "no days yet"`
      (it removed every scoped widget's empty-today state at once, not one widget's); CI run
      40029849919 green on `c30298d`.
- [x] **A trip replayed from a log written before `flightNumber` equals its stored projection.**
      *Evidence:* `packages/domain/test/m52-flight-number.test.ts:39` "replays to the trip its stored
      projection says"; PR 531, CI run 39885558036 green on `5d30d79`, merged `15f0d38`.
- [ ] **`find_places_near_now` is offered only while the trip is under way, and `read_chat` only
      on a chat-started turn**: a test of the offered tools for a planning trip, an under-way
      trip, an Ask turn and a chat turn. `read_chat`'s default and its ceiling are read from
      `limits.ts`, which a test changing the constant shows. The M33 day-of cases pass, at their
      stated cost.
      *Open (2026-10-24 close):* the tests are in — `apps/web/src/server/assistant/admission.test.ts:528`
      (`read_chat` on chat turns only) and `:548` (`find_places_near_now` only under way),
      `tools/chat.test.ts:12-13` (default and ceiling from a mocked `limits.ts`) — but the M33 day-of
      cases have run only on the simulated model (PR 534). The live eval is Mitchell's to run from
      `main`; this box ticks on its result and cost.
- [x] **Only the asker can accept an `@assistant` proposal**: an integration test is refused
      for another editor and accepted for the asker. **A free member's `@assistant` spends
      nothing**, and a paid asker's turn is recorded against the asker.
      *Evidence:* `apps/web/src/server/suggestions/suggestions.int.test.ts:673` "refuses another
      editor a change a chat asker requested, and accepts it from the asker" (and `:490`);
      `apps/web/src/server/quota.int.test.ts:452` "spends nothing for a free member" and `:463`
      "charges and records a paid asker's turn against the asker"; PR 532, CI run 39909692730 green
      on `4605670`, merged `81ed56d`. Not seen on production: Auth.js `auth()` inside `after()` (the
      reply is written after the response) waits on the [walk] box.
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**, with a trip frozen
      mid-day: Overview shows *During the trip* with Now and Next; Directions has the right link;
      `@assistant push dinner back an hour` in the chat posts a reply and a card that the asker
      accepts.
      *Evidence:* `apps/web/e2e/m52-today.spec.ts:50` (clock frozen at noon `:53`, Now/Next `:72-74`,
      the Google Maps link `:78`, `@assistant move dinner back an hour` and Accept `:92-100`);
      PR 540's body: ci-like "2 passed (setup + spec), no retry", and red with `null` phase; CI run
      40029849919 (`test / e2e (1/2)` and `(2/2)` green) on `c30298d`, merged `a06fe13`; still green
      after the follow-up, CI run 40065856615 on PR 541's `9f9b202`, merged `fd00d7f`.
- [x] **The API answers *now* (decision 21)**: an integration test lists a trip under way for
  `GET /v1/trips?active=true` and not a planning, *soon*, ended or undated one (and one whose zone
  is already tomorrow where UTC is still today), and `GET /v1/trips/{tripId}/today` names the same
  now and next as `tripNow` at a frozen clock, answers a viewer, and refuses a non-member; the
  OpenAPI version and fingerprint move with a changelog line.
  *Evidence:* `apps/web/src/server/public-api/today.int.test.ts:136` (under way listed; planning,
  soon, ended, undated not), `:141`/`:146` (its own zone either side of UTC), `:193` (same now and next
  as `tripNow`), `:225` (a viewer), `:233` (a non-member refused); `API_VERSION = "1.23.0"`
  (`server/public-api/openapi.ts:43`); `docs/contracts/CHANGELOG.md:16`. PR 539, CI run 39996552313
  green on `1934399`, merged `dbf7041`. Not called on a deployment: Mitchell checks (the [walk] box).
- [ ] **[walk]** On a phone, against the PR preview, with a trip dated today: open it from Home,
      tap Directions, and ask `@assistant` in the chat to find lunch nearby. Accept as the asker,
      and see the change line from a second account, which could not accept it.
      *Open (2026-10-24 close), Mitchell's.* Also waiting on him, and folded into this box:
      - a two-member trip with no messages shows *No messages yet* and opens the chat (not walked:
        a free preview account cannot invite, 402);
      - ~~Today cannot be deleted, and an existing trip gains it, on production~~ **Seen by
        Mitchell, 2026-10-24:** *"Today can't be deleted on production now."* (He did not say
        separately that an older trip gained it; a Today on a pre-part-9 trip that cannot be
        deleted implies it.)
      - `@assistant`'s reply, written in `after()`, reads the session with Auth.js `auth()` on
        production (part 3; not seen on a deployment);
      - ~~`GET /v1/trips?active=true` and `/today` called with a token on a deployment (part
        10)~~ **Done by Mitchell, 2026-10-24:** *"Confirmed the api works."*
      - no browser walk of PR 537 at its final head `4301073`, or of PR 541 (Trip chat on Today).
- [x] A retro is appended at gate close. *Evidence:* *Retro*, below (2026-10-24).

## Retro — written 2026-10-24 (11 of 13 boxes ticked)

Written at the close on part 0 (PR 529), with two boxes open and both Mitchell's: the live M33
day-of eval and the [walk]. `pnpm milestone close M52` refuses until they are ticked; the boxes
above say what each waits on.
*Since (2026-10-24):* Mitchell reversed the Today scope's precedence and moved Today's weather to
the real day (decisions 9 and 10, amended), so the Today-scope box is reopened for part 11
(PR 542) and the gate stands at 10 of 13. His same-day word covers two [walk] items: Today
undeletable on production, and part 10's API on a deployment.

### What went well

- **Ten parts and a follow-up merged in about 33 hours**, 2026-10-23 05:49 UTC (PR 530, `e50669c`)
  to 2026-10-24 14:46 UTC (PR 541, `fd00d7f`). Every part's `ci` run was green on the head that
  merged: PR 530 run 39881259798, 531 39885558036, 532 39909692730, 533 39913262997, 534
  39964482034, 535 39967673321, 536 39976895832, 537 40051346313, 539 39996552313, 540
  40029849919, 541 40065856615.
- **Four migrations reached production the day they merged**: `0062`–`0064` (PR 532) by
  `migrate-production` run 39910676118 at 06:18 UTC, and `0065` (PR 533) by runs 39966013831 and
  39967934976 from `25a06b6`. PRs 534–541 added none.
- **The gate tests carry their red evidence in the PR bodies**: PR 530 (zone conversion removed,
  9 of 12 properties failed), PR 533 (the scope removed from `renderMacro`), PR 540 (the no-day
  line deleted from `renderMacro`; the e2e red with a `null` phase), PR 531 (two review rounds of
  red-first `flightNumber` cases).
- **One pure function answers *now* everywhere.** `tripNow` (`packages/pages/src/now.ts`) feeds
  Home's badge, the Today scope, the Now and next widget, the assistant's *now* line and the API's
  `/today`, and `today.int.test.ts:193` checks the API against it at a frozen clock.
- **Dollars per 1,000 lines added: $11.5** by the guideline's rule (see *Spend*), against M51's
  $38.6.

### What could be better

- **PR 537 (part 8) took 18 review rounds**, the most of any part (PR 535 took 6, PR 536 took 4).
  Its scope moved under it three times on Mitchell's walks of the preview (decision 15's
  amendments of 2026-10-23 and 2026-10-24: the Ask widget dropped, *Group chat* became a mini
  card titled *Trip chat*, and a solo trip lost its chat everywhere). Each ruling restarted
  review on new UI. The change: walk a UI part's interaction sketch with Mitchell before review
  round 1, not on its preview after several rounds.
- **A part was walked on a preview that lacked the part it depended on.** Mitchell saw a
  deletable Today on PR 537's preview; undeletable Today is part 9's (PR 540), which that
  preview did not contain. Nobody rechecked after PR 540 merged, so the box stays open. A walk
  item should name the part that delivers it and be walked only once that part is in the
  preview.
- **The build sessions' spend blocks were not generated before their hand-offs.** Each hand-off
  carried a few figures (requests, cache reads, agent counts) instead of the block that
  `writing-a-retro.md` asks for, so the per-type tables, orchestrator share and builder context
  cannot be computed for five of the six build sessions (*Spend*). The change is the one the
  guideline already states: run `pnpm -s session-metrics --milestone` before every hand-off and
  paste the block.
- **Once-only reds with no cause.** E2E went red once on PRs 533 and 537 and passed on re-run
  (KI-2026-10-24-c); `prompt.test.ts` and a part 8 test failed once each (two occurrences added
  to KI-2026-10-14-c); `MacroView`'s paragraph sweep fails about one local run in four
  (KI-2026-10-24-d); `noRawSyntax` hit its 5 s timeout once (KI-2026-10-24-e). None was re-run to
  a cause, because job logs cannot be read from the cloud proxy (KI-2026-10-13-f).
- **Part 10's API was never called on a deployment.** A token has to be minted on the preview,
  and no session did it (PR 539's body: "Not called against the preview"). Mitchell called it
  himself afterwards (2026-10-24: *"Confirmed the api works."*).

### Leftovers

- **The live M33 day-of eval** (box 8): Mitchell runs it from `main`; PR 534 ran the cases only on
  the simulated model.
- **The [walk] and the items still folded into it** (two-member *No messages yet*, `auth()`
  inside `after()` on production, PR 537's final head and PR 541 unwalked): Mitchell's. Today
  undeletable on production and the API on a deployment were confirmed by him on 2026-10-24.
- **Part 11** (PR 542): merge it, then tick the reopened Today-scope box on its merged CI.
- **Per-row Accept still reads `useSessionUser`**, not `useKnownSessionUser`
  (`apps/web/src/components/board/SuggestionActions.tsx:28`, checked on `main` at the close;
  `useAcceptAll.ts:39` and the chat already use `useKnownSessionUser`). Part 6's review round 6
  called it minor: the swap is neutral under the provider, but the per-row tests mount none and
  would all change. Optional; Mitchell's call.
- **Known issues filed during M52:** KI-2026-10-23-a (an applied library day insert posts no
  change line), KI-2026-10-23-b (a flight stop cannot cross midnight or record its arrival, home
  M44), and KI-2026-10-24-a to -j.
- **From the plan, kept here because the plan is deleted:** a page's `context` (so `dateScope`)
  is not editable through events (`EditPage`/`PageEdited` carry none,
  `packages/contracts/src/pageEvents.ts`); it is set when a template is instantiated and restored
  by a reset. A notebook settings control for `dateScope` therefore needs an edit path first.
  `dateScope: { date }` is in the contract with no control (decision 10, *Out of scope*).

## Spend
<!-- session-metrics:milestone v1 -->

Seven sessions. The six build sessions' transcripts went with their containers and none ran
`session-metrics --milestone` before its hand-off, so their lines are **the figures carried in
the hand-off text, summed by hand, not generated blocks**. The seventh is this close, whose block
was generated in its own container and is pasted below unchanged. Recorded dollars are
`list_sessions` → `external_metadata.usage.cost_usd`, read 2026-10-24.

- `7e2bc2ed`: 54 model requests; cache write 591,774, cache read 7,144,496 (≈ 1.45M units without
  input); 8 dispatches: 3 `part-reviewer`, 2 `phase-implementer`, 2 `general-purpose` (1 stopped
  early), 1 `phase-verifier`.
- `902eb9ce`: 101 requests, 18.04M cache read.
- `2a2984e3`: 91 requests, 16.5M cache read.
- `298ccf04`: 113 requests, 20.5M cache read.
- `9ba33ff6`: 107 requests, 18.85M cache read.
- `a3966077`: 19 agents, 16.65M units.
- Summed, where the figures allow: 466 requests and 81.03M cache read over the first five.
  Units cannot be summed across all six: four report cache reads only, and their cache writes
  and input are unknown.
- Recorded cost of the six build sessions (`session_012kApmh…` $59.37, `session_01Lb8nz…` $61.56,
  `session_01PNNS2…` $52.22, `session_01GkaTE…` $39.17, `session_015dhvK…` $60.84,
  `session_01QANgL…` $16.32): **$289.48**; their recorded usage is 85.97M units (input + 1.25 ×
  cache write + 0.1 × cache read). Which transcript id above belongs to which session id was not
  carried, so the per-session pairing is not stated.
- This close, `session_019uYS9r…` (the block below covers its transcripts at the time it ran; its
  recorded cost was $2.28 at that point and grew after):

2 agents, 52 API calls, 881k units. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `general-purpose` | 1 | 48 | 125k | 165k | 788k | 89.4% |
| `orchestrator` | 1 | 4 | 101k | 104k | 93k | 10.6% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units |
|---|---|---|---|---|---|
| Close M52 gate on part 0 | `general-purpose` | 48 | 125k | 165k | 788k |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | Share of orchestrator | Idle |
|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 0 | 0 | 0.0% | – |
| Subagent finished | 0 | 0 | 0.0% | – |
| Harness | 0 | 0 | 0.0% | – |
| Human | 3 | 93k | 100.0% | – |
| Other (unrecognised frame) | 0 | 0 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

None recorded.

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | met | 10.6% |
| No phase-implementer averaging > 250k context | not measurable | no phase-implementer transcripts |
| GitHub wakes per merged part < 5 | met | 0 / 10 = 0.0 |
| Dollars per 1k lines added < 20 | not measurable | needs --cost-usd and --lines-added |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

M51 has no block (closed with `--no-spend`), so it compares on recorded dollars only: the three M51
build sessions `list_sessions` shows (`session_013GYZSS…` $68.57, `session_01SL6xKY…` $69.48, `session_01RjW6kg…`
$220.74, read 2026-10-24) are $358.79 for about 9,300 lines. Lines added for
M52, by the guideline's rule (PRs 530–537 and 539–541 by GitHub's per-file count, without
`docs/`, `*.generated.json` and `pnpm-lock.yaml`): 25,222, of which 14,516 are Drizzle snapshots
in `apps/web/drizzle/meta/`; 10,706 without them.

- **Dollars per 1,000 lines added (under 20):** met by the rule, $11.5 ($289.48 / 25.2k; M51
  $38.6). Missed without the four migration snapshots, $27.0, which is the fairer reading (as M47
  read its own).
- **Orchestrator's share (under 15%):** not measured. Estimated from the carried figures: at least
  10% (cache reads alone) and about 19% if `7e2bc2ed`'s write-to-read ratio holds for the other
  four, against the six sessions' 85.97M units, and leaving out `a3966077`'s orchestrator. Read as
  probably missed. The close session's own block measures 10.6% (met), but it is one session.
- **A builder's average context (none over 250k):** not measurable; no `phase-implementer`
  transcript survived.
- **GitHub wakes per merged part (under 5):** not measurable for the build sessions; 0 in the
  close.
- **Cache re-writes after a coordinator message (2 or fewer):** not measurable for the build
  sessions; 0 in the close.
