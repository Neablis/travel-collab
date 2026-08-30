### KI-48 — Small design-audit cosmetics (2026-08-26)

- **Severity:** cosmetic
- **Area:** `apps/web/src` (various)
- Collected small findings from the 2026-08-26 design-sync UI audit. Each is
  one file; none is worth its own entry.
  - **`1 travellers`** — `TripMetaPill.tsx:42,58` interpolates
    `detail.members.length` against a hardcoded plural, in both the visible
    label and the `aria-label`. Every solo trip's header reads
    ungrammatically. `NextTripHero.tsx:186` already does this correctly.
    Note SPEC §8 says travelers should come **off** this pill entirely, which
    would dispose of this instead of fixing it — settle that first.
  - **Three empty states for one empty day** — a day with no stops renders the
    design's `route` fallback ("No stops yet — add one, or drop a saved day
    onto it"), *then* "Nothing planned yet", *then* "Add the first stop"
    (`TimelineLens.tsx`; reproduce on the Rochester seed's Day 3). The design
    has one line and one button.
  - **The day-chip rail clips its last chip mid-card** at 1440px with no
    scroll affordance (`DayChips.tsx`) — reads as a rendering error rather
    than as "scroll me". `MapRail`'s gearing already solves this shape.
  - **The account menu renders an empty line** where the email goes, for
    dev-login users, who have none (`AccountMenu.tsx:92-99`). Preview-only,
    but it is in every preview review screenshot.
  - **Trip settings' date editor covers "Total for the trip".** The Popover
    is deliberate (`SettingsSheet.tsx:59` — the read-only dates row opens
    `TripDateControl` in one), but it opens downward over the budget input
    rather than expanding inline the way the design's row does. The editor
    itself is otherwise an exact match to SPEC §3, hint copy included.
  - **The signed-out home page renders `AppHeader`'s `Trips` and `Playbooks`
    nav** — links into authenticated routes shown to a signed-out visitor
    (`app/layout.tsx` mounts `AppHeader` unconditionally; `app/page.tsx`'s
    `unauthenticated` branch renders beneath it). The design's landing header
    carries only the logo and `Sign in` / `Start a trip`.
- **First noted:** 2026-08-26 (design-sync UI audit, A4/A6/A7/A8/B14/C3).
