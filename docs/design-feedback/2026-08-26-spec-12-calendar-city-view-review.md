# Review — design sync `fd2edd6`, SPEC §12 (Calendar as a city view, account settings)

Merged into `claude/design-sync-ui-audit-ek6w4k` cleanly; the commit is design-only
(`DRIFT.md`, `README.md`, `SPEC.md`, two `.dc.html` files — no build code).

This is a review, not an implementation. The headline: **C1 is the big one and it is
blocked on a contract field that does not exist**, five items are already built, and
three more need a persistence concept the app has never had.

---

## 1. Already done — no work needed

Five of the nine DRIFT rows describe things this branch already ships. Worth saying so
before anyone budgets time for them.

| # | Design asks for | Status |
|---|---|---|
| C3 | Selection is persistent state, not a 780ms pulse; cell holds `inset 0 0 0 2px` | **Done** (`cd47304`, `00aa1cf`). The pulse never existed here; selection is `focusedDay`. The ring became `ring-inset` in `00aa1cf` — arrived at independently, because an outset ring was being clipped by the grid's `overflow-hidden`. The design and the bug pointed at the same answer. |
| C3b | "mirrored by the ring on the header day chip" | **Done.** One `focusedDay` drives chip, day column and calendar cell. |
| C4 | Clicking a calendar day selects in place, does not navigate to Timeline | **Done.** `CalendarLens` only calls `setFocusedDay`; there is no router call in the file. |
| C8 | Map hides the header day chips | **Done.** `TripBoardScreen.tsx:332` — `{lens !== "Map" && <DayChips …>}`. |
| — | The `Sheet` focus-ring design-system bug, "the durable fix belongs in the design system" | **Done** (`e750074`). `ui/sheet.tsx`'s scroll div carries `-mx-1 … px-1`, which is the horizontal padding the note asks for — not a per-consumer workaround. |

C9 (budget) is **mostly** done: `BudgetChip` already renders the remaining figure as a
`Badge` and `of {budget}` as slate mono. See §4 for the one part of C9 that conflicts with
earlier feedback.

---

## 2. C1 — the city-card calendar. Blocked on one missing field.

The presentation is buildable. The two mechanics that decide *what goes in each card* are
not, and both depend on the same absent thing: **a stop has no `kind`.**

`ActivityView` (`packages/contracts/src/detail.ts:7-15`) is `activityId`, `title`,
`timeWindow`, `location`, `notes`, `anchors`, `cost`. There is no `booked`/`hold`/`idea`/
`transit` anywhere on it.

The seed knows this and works around it — `db-seed.ts:195-205`:

> Folds status/who metadata (**not modeled by the domain** — see AddActivity in
> packages/contracts/src/activity.ts) into the notes field instead of dropping it.

which is why cards read `(transit)` and `(idea) (Sam K + Jonah M)`. The stop kind exists
only as free text inside someone's note.

That blocks both load-bearing rules of the new Calendar:

- **"Travel days split at the LAST transit stop."** There is no way to find the last
  transit stop without regex-ing `(transit)` out of prose a user can edit. Without the
  split there is no departing-city strip and no arriving-city card — i.e. no travel day.
- **"Counted as unbooked: every stop whose kind is neither `booked` nor `transit`."**
  Same. The `2 to book` flag is the card's one actionable line and cannot be computed.

`docs/known-issues.md` already records this exact gap, under KI-47's "Adjacent, same
shape" note — including that the home hero's designed "7 not booked" tile is blocked on
it. What changed today is the **severity**: it was one cosmetic tile; SPEC §12 now makes it
the mechanic of an entire lens.

**This is a contract change and wants a decision, not a workaround.** Parsing kinds back
out of note text would be the wrong fix twice over — it would make a display concern
depend on prose, and it would break the moment someone edits a note.

Also blocked, same family: **"Tag focus at this zoom" (`2 of 6 match`)** needs the `tags`
field KI-47 is actually about.

### What *is* buildable in C1 today

City name and accent (`dayAccents`/`cityFor` exist), the 7am–11pm span bar, `4 stops`,
day cost (`costSubtotal` is on the day), and the `10:30am–8:30pm` window. So a
non-travel-day cell could be built now and would be most cells. I would not ship a
half-Calendar that silently mis-renders every travel day — the Japan seed has five.

---

## 3. C5 / C6 / C7 — account settings need storage that does not exist

The schema (`apps/web/src/server/db/schema.ts`) is four tables: `events`,
`trip_summaries`, `trip_details`, `pages`. **There is no account or user table.**

- **C5 Account settings** (name, home airport) — nowhere to persist either.
- **C6 Distance units, account scope** — "a trip does not have a unit, a person does" is
  right, and there is no person to hang it on. The `kmLabel` helper itself is trivial
  (`MapRail`, `MapFocusCard`, `mapRailData`, `TimelineLens` all hardcode `km` today); the
  *preference* is the blocker.
- **C7 Home time on hover** — the spec says so itself: needs `trip.tz` and a tz for the
  home airport. Also correctly argues against a global display mode; no disagreement.

This is a bigger call than it looks in an event-sourced app: trip state lives in events,
and account preferences are not trip state. Worth deciding deliberately (a small
`user_settings` table? a claim on the session?) rather than discovering it mid-build.

---

## 4. One conflict with your earlier feedback — needs your call

SPEC §12 Trip header: *"The budget pill sat slightly above its sister pill; the row is
`align-items: center` now."*

That row is `items-stretch` in the build, and deliberately — it is your PR #55 comment:

> "The Budget card should be same height, and aligned with the left side Date / Days /
> Stops / cities Card"

`items-stretch` is what makes them **equal height**; `items-center` would centre them
vertically and let them go back to different heights. The two asks pull opposite ways.

I have not changed it. Which did you mean — equal height (keep `items-stretch`), or
centred (take `items-center` and drop the equal-height ask)?

---

## 5. C2 — buildable now, and it partly un-does recent work

"Stop-level drag is gone from Calendar — there are no activity chips left to grab."

Calendar never had stop-level drag in this build (no lens registers a drop target), so
there is nothing to remove. But it interacts with a decision from this morning: the
Unscheduled drawer is now gated on `lensAcceptsDrops`, built precisely so the drawer
returns to a lens when that lens *gains* drop targets. C2 says Calendar will not gain
stop-level ones — so the drawer stays off Calendar permanently, and the four rack/lens
gaps in `TODO.md` shrink to Timeline only. Worth recording rather than leaving the TODO
implying Calendar is coming.

Day-level reorder (drag a day's header onto another date) is a new capability the build
does not have.

---

## Suggested order

1. **Decide the stop-`kind` contract field.** Everything interesting in §12 is behind it,
   and so are two things already filed (`NextTripHero`'s "not booked" tile, the design's
   `act.badge`). Nothing else in C1 is worth starting first.
2. **Answer the `items-stretch` vs `items-center` question** — one line, but it is a
   direct contradiction between two pieces of your own feedback.
3. **Decide whether account-scope storage exists** before C5/C6 are scheduled.
4. Then C1's presentation, which is a good-sized but unblocked piece of work.
