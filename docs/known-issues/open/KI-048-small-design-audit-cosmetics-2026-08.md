### KI-48 — Small design-audit cosmetics (2026-08-26)

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
  - **The day-chip rail clips its last chip mid-card** at 1440px with no
    scroll affordance (`DayChips.tsx`) — reads as a rendering error rather
    than as "scroll me". `MapRail`'s gearing already solves this shape.
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
  - **Trip settings' date editor covers "Total for the trip".** The Popover
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
