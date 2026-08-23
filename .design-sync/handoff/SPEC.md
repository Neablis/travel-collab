# Spec — what the design file cannot say out loud

Companion to `design/Trip Planner Redesign.dc.html`. Current as of 2026-08-22.

## 1. Focus scope — the model behind the chrome

There is exactly one focus scope at any moment: **account → trip → day**. It decides what
the global header, the trip header and the assistant show. Nothing else should introduce a
competing notion of "current thing".

| Scope | When | Global header | Assistant context |
|---|---|---|---|
| account | trips list, Playbooks | `New trip` + avatar | "Looking at all three of your trips" |
| trip | inside a trip, no day selected | `Share`, `Quick add`, avatar | "Looking at Japan: Tokyo → Kyoto → Osaka" |
| day | inside a trip, a day explicitly selected | same as trip | "Looking at Day 6 · Kyoto" |

Rules that matter:

- **Trip actions never appear outside a trip.** No Share, no Quick add on the trips list.
- **Day scope is entered explicitly** (clicking a day chip, calendar cell, or map rail row)
  and **left by scrolling**. Programmatic scrolls from selection itself must not clear it —
  the design file locks for 900ms; the map rail already had this pattern (`_railLock`).
- **Calendar and Map are trip-scope views by definition** — they draw the whole trip, so
  entering one drops day scope and hides the day-chips row and the unscheduled rack.
- **The day-chip ring is not scope.** It marks the day most central to the screen and
  follows scroll (vertically in Timeline, horizontally in Day columns). Scope says what
  you're acting on; the ring says where you are. Keep them separate.

## 2. Save state

Three states, driven by the real save queue. Replaces the old "All changes saved" text.

- **saved** — 11px dot, `--color-success-ink`. No label.
- **saving** — dot in `--color-brand` with two haloes expanding to 2.1× on a staggered
  1.4s loop, plus a `Saving…` label in brand. Deliberately loud: it was too subtle before.
- **error** — dot in `--color-danger`, label "Couldn't save — retrying".

Note `--color-success` **does not exist** in the design system. Use `--color-success-ink`.
Defined: `--color-success-tint`, `--color-success-ink`, `--color-warning`, `--color-danger`.

## 3. Trip dates — start only

The Dates row in Trip settings is editable but **start-only**. Clicking the range reveals a
single `input[type=date]` for the start; the end is derived from the number of days in the
plan and shown beside it (`→ Oct 16, 2026`). Copy: "Pick the day you leave. The end follows
the N days in your plan — add or remove a day and it moves."

Changing the start rewrites every day's weekday and date from the new start, so day headers,
chips and the calendar all move together. There is never a range that disagrees with the days.

## 4. Calendar spans months

The calendar is built from the trip's **real date range**, not from one month. It renders one
**stacked block per month** the trip touches, each with a header (`November 2026`) and a note
naming the days it holds (`Day 8 – Day 14`). Each block shows only the weeks that matter —
lead-in days before the start, nothing trailing past the end. No month paging.

Days are matched by **full date**, never by day-of-month: matching on day-of-month scattered
a Nov 27 → Dec 10 trip's December days onto November's 1st–10th.

## 5. Component mapping — the "unnamed element" answers

The design system has **no `Hint` component**. A 12px slate helper line is one of:

- **inside a form row** → `FormField`'s `hint` prop (renders `Text variant="muted"`, and
  swaps to the error text when `error` is set);
- **standalone, e.g. beside a toggle** → `Text variant="muted"`.

Never hand-roll a 12px slate span. Same principle generally: an element described only by
size and colour is almost always a design-system component used plainly — check
`components/<group>/<Name>/<Name>.prompt.md` before concluding something is missing.

Other mappings worth stating: the sync-failure bar and the History preview banner are both
`Banner` (`danger` / `info`) — reuse `ConflictBanner`'s pattern rather than adding a second
banner treatment. Account menu and History are both `Popover`.

**Popover triggers and Banner `actions` must keep a stable element identity across renders.**
A fresh React element every render makes Radix re-render in a loop and hard-locks the main
thread. This actually happened in the design file; it is not hypothetical.

## 6. Decisions (2026-08-22)

| # | Decision | Owner |
|---|---|---|
| D1 | Product name is **Caesura** everywhere — `AppHeader` and `metadata.title` still say Trip Planner / travel-collab | code |
| D2 | Build the landing page + custom Google sign-in/sign-up, replacing NextAuth's default page | code |
| D3 | Account menu on the header avatar: **Your account** + **Sign out** only | code |
| D4 | First-run "Roughly when?" chips stay as a **`<Preview>` shell** — `CreateTrip` carries only a name | code |
| D5 | Trip header keeps everything the build already has: inline rename, status badge, sync state, undo/redo, History, Notebook link | done |
| D6 | Add a **start date to `TripSummary`** so home's "next trip" is real rather than `visibleTrips[0]` | code |
| D7 | One banner pattern — sync failure reuses `ConflictBanner`/`Banner` | done |

## 7. Deliberately not designed yet

- **Notebook / Pages** — next up. Agreed intent: a **trip journal** (written during and
  after), with macro blocks that stay **live** against the plan.
- **Travelers UI** — the traveler avatars were removed from the trip header's meta pill;
  travelers are reachable only through Trip settings until this exists.
- **History** beyond the popover, and the extra lenses (Itinerary, Schedule, DailyOverview,
  FullTripOverview, MapRail).
- Everything in `preview-registry.ts` — that registry, not this file, is the authoritative
  list of unbuilt surfaces.
