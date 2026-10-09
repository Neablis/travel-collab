### KI-48 — Small design-audit cosmetics (2026-08-26) — RESOLVED

- **Severity:** cosmetic
- **Area:** `apps/web/src` (various)
- Collected small findings from the 2026-08-26 design-sync UI audit. Each is
  one file; none is worth its own entry.
  - ~~**`1 travellers`** — `TripMetaPill.tsx:42,58` interpolates
    `detail.members.length` against a hardcoded plural~~ — **CLOSED BY
    REDESIGN** (checked 2026-09-25 overnight sweep): the pill states the dates
    and nothing else since SPEC §35.3 and the 2026-08-30 pass
    (`TripMetaPill.tsx:99-103`; `TripMetaPill.test.tsx` "states the dates and
    nothing else" / "shows no member avatars"), so there is no traveller count
    left to pluralise. Every remaining traveller count pluralises
    (`TripCard.tsx:201`, `NextTripHero.tsx:245`, `SharedTripScreen.tsx:153`);
    `grep -rnE "\} travell?ers" apps/web/src --include=*.tsx` finds none.
  - ~~**Three empty states for one empty day** (`TimelineLens.tsx`)~~ —
    **CLOSED BY REDESIGN** (checked 2026-09-25 overnight sweep):
    `TimelineLens.tsx` no longer exists (`components/lenses/` has Calendar, Map
    and Overview only). An empty day column (`board/Column.tsx:280-290`) draws
    one dashed `+ Add` and nothing else; "Add the first stop" and "add one, or
    drop a saved day onto it" occur nowhere in `apps/web/src`.
  - ~~**The day-chip rail clips its last chip mid-card** at 1440px with no
    scroll affordance (`DayChips.tsx`) — reads as a rendering error rather
    than as "scroll me".~~ — **FIXED** (M39 Part 1, PR #363, decision 7:
    an edge fade plus snap). The row tracks which edges have chips past them
    (scroll + `ResizeObserver`), exposes it as `data-fade-start` /
    `data-fade-end`, and masks that edge 2rem; `snap-x snap-mandatory` with
    `snap-start` chips brings a scroll to rest on a whole chip.
    **Proof:** `DayChips.test.tsx` "fades only the edges that have chips
    beyond them" and "does not fade a row that fits" — with the `data-fade-end`
    attribute wired to the wrong side, red: `expected { start: false, end:
    false } to deeply equal { start: false, end: true }`; with the end test
    off by one, red: `expected [ false, true ] to deeply equal [ false, false
    ]`; green restored. The history of this item, kept: `MapRail`'s gearing already solves this shape.
    **Still holds** (2026-09-25 overnight sweep): `DayChips.tsx`'s row is a
    bare `overflow-x-auto` of fixed 92px chips with no fade, arrow or snap.
    **Left open:** the affordance is a design choice (edge fade that tracks
    `atStart`/`atEnd`, arrow buttons, or snapping to whole chips), none is
    drawn in the handoff, and every option needs overflow state rather than a
    class — not a one-line cosmetic.
  - ~~**The account menu renders an empty line** where the email goes, for
    dev-login users, who have none (`AccountMenu.tsx:92-99`)~~ — **FIXED**
    (2026-09-25 overnight sweep): `AccountMenu`'s `email` is `string | null`
    (`AccountMenuFor` passes `user.email ?? null`, not `""`) and the line
    renders only when there is an email. Reproduced first by the new
    `AccountMenu.test.tsx` case "draws no email line for an account without an
    email" — red on the old render (`expected [ <span …(2)></span> ] to have a
    length of +0 but got 1`), green after; re-broken by dropping the guard,
    red again for the same reason.
  - ~~**Trip settings' date editor covers "Total for the trip".**~~ —
    **FIXED** (M39 Part 1, PR #363, decision 8): the Popover is gone; the
    Dates row is a disclosure (`aria-expanded` / `aria-controls`) that
    expands `TripDateControl` inline beneath it, and the sheet closing resets
    `datesOpen`. **Proof:** `SettingsSheet.test.tsx` "expands the date editor
    inline, as a disclosure" — red on the popover (`Unable to find an element
    by: [data-testid="trip-dates-editor"]`); "collapses the editor when the
    sheet closes" — with the reset removed, red: `expected 'true' to be
    'false'`. `e2e/m3-place-and-time.spec.ts` now asserts opening the editor
    pushes the total down by at least the editor's height — on the popover,
    red: `Expected: >= 62, Received: 0`. (Its first version asked whether the
    total was covered at all, and passed on the popover: at 1280px the
    right-aligned popover misses the total. That is why it measures the push.)
    See the PR for which e2e lane that ran on. The history of this item, kept: The Popover
    is deliberate (`SettingsSheet.tsx:59` — the read-only dates row opens
    `TripDateControl` in one), but it opens downward over the budget input
    rather than expanding inline the way the design's row does. The editor
    itself is otherwise an exact match to SPEC §3, hint copy included.
    **Still holds** (2026-09-25 overnight sweep): `SettingsSheet.tsx:215-246`
    is still a `Popover`. **Left open:** swapping it for an inline disclosure
    is a structural change, not a class, and `e2e/m3-place-and-time.spec.ts`
    depends on the popover's outside-click dismiss — it closes the sheet with
    Dates open and clicks Dates again after reopening, so an inline version
    must also reset `datesOpen` when the sheet closes, and only a browser run
    of that spec proves it.
  - ~~**The signed-out home page renders `AppHeader`'s `Trips` and `Playbooks`
    nav**~~ — **CLOSED BY REDESIGN** (checked 2026-09-25 overnight sweep):
    `app/layout.tsx` no longer mounts `AppHeader`; only `app/(app)/layout.tsx`
    and `app/admin/layout.tsx` do, and the signed-out front door
    (`app/(front)/`) has its own header. Inside `AppHeader` the nav is
    `HeaderSessionChrome` (`AccountMenu.tsx:251-253`), which returns `null`
    with no session.
- **First noted:** 2026-08-26 (design-sync UI audit, A4/A6/A7/A8/B14/C3).
  **Narrowed:** 2026-09-25 (overnight KI sweep) — four of six items struck;
  open are the day-chip scroll affordance (A7) and the inline date editor
  (B14).
  **Resolved:** 2026-10-08 (M39 Part 1, PR #363) — A7 and B14 fixed,
  as above; every item is now struck.
