# ADR-080: A trip knows what day it is: one `tripNow`, and a notebook `dateScope`

**Status:** **Accepted — 2026-10-23.** Mitchell answered M52's decisions 9, 10, 11, 12 and 19
(2026-10-22 and at scoping on 2026-10-23). **Amended 2026-10-24** (twice, below; the second
reverses decision 4's "an explicit binding still wins").
**Deciders:** Mitchell (product); Claude — drafted
Related: ADR-073 (trip chat), ADR-067 (a multi-change turn is stored as suggestions), M52
(`docs/milestones/M52-the-trip-comes-with-you.md`).

## Context

Nothing in the app changes when a trip starts. M52 adds a during-trip experience, and four
readers need the same answer to *where are we in this trip, right now*: the Overview swap, a
notebook that follows today, Home's badge, and the assistant.

Two facts make that answer harder than it looks:

- **Times carry no zone.** A `TimeWindow` is plain `HH:MM` (`packages/contracts/src/activity.ts`).
  The only zone is server-derived, `TripGlobalsDay.timeZone`, from a day's first stop with
  coordinates.
- **"Today" was a calendar date**, read on the client (`lib/today.ts`), with no notion of the
  current stop.

Mitchell also asked that the day filter not be a one-off: *"someday i want to have settings for a
notebook, where we trigger 'is this dynamic (follows current date), scoped to some specific date,
or all' … so maybe dont make it a hook that 'just' does day scope."*

## Decision

1. **Every stop time is local to its day's zone.** A stop's `HH:MM` is read in
   `TripGlobalsDay.timeZone`, falling back to the device's zone when the day has none.
2. **One pure function answers *now*:** `tripNow(trip, globals, now) → { phase, dayId, current,
   next }` in **`packages/pages`**, with the clock passed in (invariant 4). It sits there, not
   in `packages/domain`, because client code may not import `@tc/domain`
   (`apps/web/eslint.config.mjs`) and `packages/pages` already holds the zone helper (`clock.ts`). The Overview swap, the
   notebook scope, Home's badge, the now-and-next widget and the assistant all read it, and none
   computes a phase of its own.
   **Which day is today** across zones: a day stays today until midnight ends it in its own
   zone, and the next day takes over only once that has happened and the next day's own midnight
   has also come. So a trip flying east does not turn the page early (day 1 in Lisbon, day 2 in
   Tokyo: at 17:00 in Lisbon it is still day 1). A day lying wholly inside the previous day's span
   (zones more than 24 h apart) is passed over.
3. **The phases are** `planning` (undated, or more than 3 days out), `soon` (up to 3 days before
   the start date), `underway` (start date through end date, in the trip's zone) and `ended`.
4. **A page carries `dateScope: "all" | "today" | { date }`**, default `"all"`. It is a notebook
   setting, not a widget's: one resolver turns it into the scope handed to every widget, through
   the same `narrow` a `repeat` uses, so it only fills a day (or dates) input the widget left
   unbound, and an explicit binding still wins. `"today"` resolves to `tripNow`'s `dayId`, or to
   *no day* off the trip's dates, where each widget renders its own empty state. `{ date }` is in
   the contract and has no control yet. Later notebook settings extend the same resolver rather
   than adding hooks of their own.
   **Amended 2026-10-24 (Mitchell; M52 part 11, PR 542): "an explicit binding still wins" is
   reversed.** A notebook setting now supersedes the widget's own param; see *Amendment —
   2026-10-24: notebook settings supersede widget settings*, below. The text above is kept as
   the rule that held from 2026-10-23 to 2026-10-24.
5. **Overview swaps to the seeded *During the trip* notebook while the phase is `soon` or
   `underway`.** `pickOverviewPage` is the one place that decides. A trip without that notebook
   keeps its Overview.

## Consequences

- One function to test across zones and midnight, with a property test, instead of four readers
  each guessing.
- A trip whose days have no coordinates runs on the device's zone. A traveller whose phone has not
  changed zone sees times in the zone they left from until a stop is placed. This is accepted.
- `dateScope` is stored on the page, so a reset of the seeded notebook restores `"today"`, and a
  copy of the page keeps it.
- Adding `{ date }` later is a control and a resolver branch, not a migration.

## Amendment — 2026-10-24: the zone fallback, as built (M52 part 10, PR 539)

Decision 1's "falling back to the device's zone" holds on the client, where `tripNow` is given
the device's own zone. The server has no device, so it reads `tripNow` through one helper,
`turnNowOf` (`apps/web/src/server/assistant/context.ts`), which the assistant's turns, the chat's
`@assistant` turns, `GET /v1/trips/{tripId}/today` and `GET /v1/trips?active=true` all share.
Its order:

1. **A day's own zone**, `TripGlobalsDay.timeZone`, from where its stops are placed.
2. **The asker's zone**, when the request brought one: the client's zone on an assistant turn,
   the poster's `PostChatMessage.timeZone` on a chat ask, `?timeZone=` on the `today` endpoint.
   It is read for that answer only and never stored.
3. **The trip's zone**: the first day, in order, that has one of its own.
4. **UTC**, when no stop on the trip has coordinates.

A zone the runtime does not know (`isKnownZone`) is passed over at each step, never an error,
except `?timeZone=` on the API, which answers 400 because the caller sent it. Steps 2 to 4 form
the fallback handed to `tripNow` as its `deviceZone`, so they decide which day is today on a trip
whose days have no zone. `?active=true` brings no asker's zone, so a trip there is under way by
its own zone, else UTC.

**`TurnNow.local.timeZone`** is the zone `local.date` and `local.time` are read in: today's day's
own zone while the trip is under way, otherwise the first day's own zone, and when that day has
none, the fallback above. The `today` endpoint reports it as `timeZone`, so a caller is told the
clock its `date` was read on rather than guessing it (`docs/contracts/CHANGELOG.md`, 2026-10-23,
part 10).

## Amendment — 2026-10-24: notebook settings supersede widget settings (M52 part 11, PR 542)

Mitchell, 2026-10-24, on the order in which settings apply: *"Notebook level settings > manually
set widget settings > defaults."* This reverses decision 4's "an explicit binding still wins".

- **One general mechanism.** `NOTEBOOK_SETTINGS` in `packages/pages/src/dateScope.ts` lists each
  notebook setting and the widget filters it takes over while it is set; `supersededParams` is
  its one reader. A superseded param is dropped from the widget's stored params when it renders
  (`withoutSuperseded`, in `renderMacro`) and is not offered in the widget's settings panel or a
  repeat's (`inputsFor`). A later notebook setting is a row in that list, not a hook.
- **`dateScope: "today"` supersedes `day` and `dates`** on any widget that selects by them, so on
  a Today page the date param disappears from widget settings and a day stored before is read as
  unset. A render with no reader's clock (the invite card) supersedes nothing, since the page
  scopes nothing there and dropping the stored day would leave the widget reading every day.
- **Weather and sunrise/sunset follow the real day.** Mitchell: *"the logic should not be 'before
  or after trip' just the day is locked to today. Having no events makes sense though."* On a
  Today page they show today's date before, during and after the trip, at the place of the trip
  day nearest today (today clamped into `[start, end]`, `nearestTripDay`); Mitchell: *"Good with
  that decision."* The device's location is still not read (M52 decision 6). Widgets of events
  keep decision 4's *no day* off the trip's dates and their empty states. The weather route
  gains one point dated today for this (`docs/contracts/CHANGELOG.md`, 2026-10-24, part 11).
- **The Today template's *Weather and light* becomes *Weather Report* and *Sunrise/Sunset*.**
  With no template-version tracking (M52 decision 9, amended 2026-10-24), an existing Today
  notebook keeps the old heading until it is reset.
