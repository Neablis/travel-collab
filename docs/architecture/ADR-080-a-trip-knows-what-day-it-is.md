# ADR-080: A trip knows what day it is: one `tripNow`, and a notebook `dateScope`

**Status:** **Accepted — 2026-10-23.** Mitchell answered M52's decisions 9, 10, 11, 12 and 19
(2026-10-22 and at scoping on 2026-10-23).
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
