# Design ↔ build drift — Caesura / travel-collab

Source: `Neablis/travel-collab@main` (tree `44dda6f5b911`), read 2026-08-23.
Design: `Trip Planner Redesign.dc.html`.

The repo already answers the "what isn't built" question itself:
`apps/web/src/lib/preview-registry.ts` is a single registry of 18 not-yet-functional
surfaces, each with a milestone, and a sync test keeps it honest against actual
`<Preview id>` usage. **Treat that registry as the authoritative unbuilt list** — I've
used it as the spine of this report rather than guessing.

`<Preview>` itself (`components/ui/preview.tsx`) wraps real markup with real fixture
data, shields pointer events, and stamps a `Preview · M9` badge. So Preview-wrapped UI
is *designed and shelled, not wired* — not a design gap.

---

## 1. Drifted — code and design disagree, you pick

| # | Thing | Code | Design | My call |
|---|---|---|---|---|
| D1 | Product name | `AppHeader` says **Trip Planner**; `metadata.title` is `travel-collab` | **Caesura** | Design wins — you gave me the name this turn. Change both in code. |
| D2 | Unauthenticated home | Bare `<Heading>travel-collab</Heading>` + a `Sign in` link to NextAuth's default page | Full landing hero + custom sign-in/sign-up screens | Design wins — this is the new work from this turn. |
| D3 | Global header contents | Logo, `Trips`, `Playbooks`. No account control. "Quick add" deliberately omitted (needs a trip) | Logo, nav, **avatar that signs out** | Design wins on the avatar (you can't sign out anywhere today). Code is right to omit Quick add. |
| D4 | New-trip flow | A `Dialog` with **one field: name**. `CreateTrip` in `packages/contracts/src/trip.ts` carries *only* a name | My new first-run screen adds **"Roughly when?" chips** | **Code wins** — my chips have no contract field. Either drop them or treat as a contract change. Flagged as my error. |
| D5 | Trip header actions | Also has inline rename, status `Badge`, `SyncIndicator`, Undo/Redo, **History popover w/ version preview + revert**, `Notebook` link | Undo/redo now live in History; Notebooks is a menu; save state moved to the logo; **inline rename is gone** | ~~Code wins~~ **Superseded by the rules pass (see R4, R6, R7 below).** Only the status `Badge` is still code-wins. |
| D6 | Home "next trip" | `TripSummary` has **no start date**, so "next trip" is just `visibleTrips[0]` | Design implies real upcoming-by-date | Code wins for now; needs a server field to do it honestly. |
| D7 | Sync failure | `SyncIndicator` (pending dot) + `board/ConflictBanner` | My new **persistent sync-failure banner** | Design wins per your "banner" answer — but it should reuse `ConflictBanner`'s vocabulary, not a second pattern. |

## 2. Unbuilt — designed, shelled in code behind `<Preview>`

Straight from the registry. Everything I designed in the last several turns lands here,
which is the honest answer to why the rack "hint" copy had nowhere to come from:

**Blocked on a missing data field** (the registry says so explicitly):
- `rack-provenance` (M11) — who parked a stop and which day it came from. My "Was on Day X" tag has **no field behind it**.
- `cost-estimate-state` (M11) — confirmed-vs-estimate per cost. My "est" treatment has **no field**.
- `budget-breakdown` (M11) — Booked/Holds/Travel/Other. My settings breakdown has **no field classifying a cost**.
- `trip-invites` (M13) — `TripMember.role` is the literal string `"owner"`. My invite list with roles is **entirely ahead of the model**.
- `map-legend-modes` (M9) — transport mode per leg, no field.

**Blocked on a feature, not a field:** `home-worth-attention`, `home-decisions`,
`home-playbooks-strip`, `assistant-suggestions`, `assistant-quick-asks`,
`timeline-ghost`, `keep-day-flag`, `keep-day-dialog`, `playbooks-route`,
`insert-playbook`, `share-button`, `add-saved-day`.

Nothing to do in design for these — they're built as shells against the designs already.

## 3. Undesigned — real in code, absent from the designs

This is the biggest surprise and where I'd spend the next pass:

- **Notebook / Pages — an entire feature.** `packages/pages` (macro registry, templates,
  inline + block macros), `NotebookScreen`, `PageScreen`, `PageEditor` (TipTap),
  `MacroNodeView`, `ComposePanel`, and blocks (`ItineraryDayBlock`, `ItineraryTripBlock`,
  `CostsTableBlock`), routed at `/trips/[tripId]/pages`. Zero design coverage.
- **History & time travel.** `HistoryPanel` + `UndoRedoControls`, with *preview a past
  version* (read-only banner) and *revert to state*. Real, shipped, undesigned.
- **Extra lenses.** Code has `ItineraryLens`, `ScheduleLens`, `DailyOverviewLens`,
  `FullTripOverviewLens` beyond the four views the DC shows, plus a substantial
  `MapRail` (19KB, with focus + tuning modules).
- **Trip lifecycle.** Delete → undo toast → `RestoreTrip`, and `duplicateTrip`. The
  optimistic delete pattern (drop the row on confirm, re-add on failure) is a real
  interaction with no designed counterpart.
- **Dev login.** A `dev-login` credentials provider behind `AUTH_DEV_LOGIN`. Probably
  intentionally undesigned, but it's the only non-Google way in.

---

## Decisions (2026-08-22)

| # | Call | Status in design |
|---|---|---|
| D1 | **Caesura everywhere** — code should change | Done in the DC |
| D2 | **Build** landing + custom sign-in/sign-up | Designed |
| D3 | Avatar with a menu — **Your account + Sign out** only | Designed |
| D4 | Keep the when-chips as a **Preview-wrapped shell** | Done — own treatment, dashed border + "needs a CreateTrip field" |
| D5 | **All of them** — match the code exactly | Done: Notebook link, inline rename, status badge, sync label, undo/redo, History popover |
| D6 | Keep upcoming framing — **add a start date to TripSummary** | Contract change for code |
| D7 | **Reuse ConflictBanner** — one banner pattern | Done — sync failure now uses `Banner variant="danger"` |

## Review pass — comment resolutions

- **Day rail in Map: removed.** Earlier call kept it in all four views for header
  stability. Map already carries a full-size day rail down its side, so the header
  strip was a second selector for the same job; Map now gets that height back.
  Timeline / Day columns / Calendar keep the strip unchanged.
- **Rail bars: no grey.** Ride legs were tinted, which read as "disabled" next to
  solid stop legs. Ride legs are now the same city colour at 3px instead of 6px —
  travel reads as thinner, not weaker. Day totals inherit the day's ink.
- **Budget meter moved into its own header row**, so a long city list and the meter
  can't collide in the same grid cell.
- **Mobile cards: colour spine is now flush.** The city stripe was an inset rounded
  bar inside padded cards; it now runs edge to edge as a real spine (card padding
  moved inward), matching the desktop timeline.
- **Trip-list rows** rebuilt on the same flush-card structure for consistency.
- **Mobile day-header gradient** now holds solid surface until the last 34px, so
  scrolled content doesn't ghost through the title.

Next: Notebook / Pages — a **trip journal** (written during and after), with **live** macro blocks that always reflect the plan.

## Suggested order

1. You settle D1–D7 (only D4 is a real correction to my work).
2. I design §3 — Notebook first, since it's a whole feature; then History, then the
   extra lenses.
3. I refresh the handoff so `AGENT-PROMPT.md` points at the registry instead of
   restating unbuilt features as if they were pending design.

## Design pass — 2026-08-24

- **Assistant re-presented as a floating bubble** that drags anywhere and expands into a
  floating panel, with the old side rail kept as an explicit **dock** mode (SPEC §9). The
  rail is no longer the only way to have the assistant, and it is no longer evicted on
  narrow windows.
- **Seed trip moved to Sep 20 – Oct 3, 2026** so the multi-month calendar is the default
  view, not an edge case. This surfaced a real bug worth flagging to the build: date labels
  took their month from the *trip*, so October days rendered as September. Fixed in the
  design by deriving every label from start date + day index — **check the build for the
  same assumption** (`CalendarLens`, `MapRail`, any day-chip label).
- **Mobile scope stated out loud** (SPEC §10): retrieval and small edits on the trip, not
  planning. Recorded so future mobile screens don't drift back toward a second planner.

## Rules pass — 2026-08-25

Six project rules were adopted (`RULES.md`, SPEC §11) and the desktop design was
reconciled against them. Build-side consequences:

| # | Change in design | Build check |
|---|---|---|
| R1 | `Share` / `Quick add` / `New trip` removed from the header | `components/AppHeader.tsx` — header should hold account scope only; Share moves to `trip/TripHeader.tsx` |
| R2 | Drawer renders in Day columns only | `trip/rackDisclosure.ts` — gate on the columns lens, not `timeline || columns` |
| R4 | Trip-header save dot removed; logo carries save state | `trip/SyncIndicator.tsx` moves to the header logo; remove the in-trip instance |
| R4 | `Travel` chip suppressed on transit stops | wherever stop tags render — transit already shows a badge |
| R5 | Filter row removed; tag chips are the control, dim not hide | `lenses/CalendarLens.tsx` must stop filtering cells; needs an opacity pass keyed on the focused tag |
| R7 | Undo/redo relocated into History | `board/UndoRedoControls.tsx` + `board/HistoryPanel.tsx` — both were on the *undesigned* list and now have a design |
| R7 | Notebooks menu at the far right of the view row | `components/pages/NotebookScreen.tsx` entry point; new menu is not in code |
| R2 | Map day rail restored, clicking jumps | `lenses/MapLens.tsx` + `lenses/MapRail.tsx` — reverses the 2026-08-23 removal |
| R6 | Trip title *is* the settings button; **pencil icon and ⚙ removed, inline rename removed** | `trip/TripHeader.tsx` — delete the `Pencil` import, the `renaming` state, and the `Rename trip` icon button; the `<h2>` becomes the button that opens `SettingsSheet`. `trip/SettingsSheet.tsx` — the trip-name row stops being read-only and becomes the one place renaming happens (its comment on L152 is now stale). Update `TripHeader.test.tsx` (`describe("TripHeader rename")`) and `e2e/m8-make-it-real.spec.ts` (`getByRole("button", { name: /rename trip/i })`) to drive rename through settings. **Supersedes D5's "code wins".** |

Carried forward from 2026-08-24 and still true: **day labels must derive their month from
start date + day index**, not from the trip start — check `CalendarLens`, `MapRail`, and
every day chip.

Design-system note for implementers: arbitrary Tailwind utilities (`max-h-[min(420px,80vh)]`)
are inert against the precompiled bundle used by the design file. In the real app the JIT
will compile them, so this is a design-file constraint, not a product one — but any value
copied *out of* the design file may be an inline style for that reason.

Removed this pass: the Trips page's **"Worth your attention"** panel (nudge rows). There
was no code counterpart; it is now gone from the design too.

## Calendar / account settings pass — 2026-08-26

Build-side consequences of SPEC §12.

| # | Change in design | Build check |
|---|---|---|
| C1 | Calendar cells render **city cards**, not activities | `lenses/CalendarLens.tsx` — cell content is now a per-city rollup (name, 7am–11pm span bar, stop count + cost, window, unbooked flag). Needs a day→cities split helper keyed on the LAST `transit` stop |
| C2 | Stop-level drag removed from Calendar | drop handling for calendar cells keeps day reorder only; the stop-drag source is gone |
| C3 | Calendar day selection is persistent, not a pulse | remove the flash-on-jump animation; selected cell holds `inset 0 0 0 2px <accent>`. Calendar keeps day focus across view switches (Map still clears it) |
| C4 | Clicking a calendar day no longer navigates to Timeline | it selects in place |
| C5 | **Account settings** Sheet is real | new surface off the avatar menu: name, email (read-only), home airport, Display section. `Your account` currently has no destination in code |
| C6 | Distance units are account scope | one formatter owns every distance; do not add a per-trip unit field |
| C7 | Home time on hover, default off | needs `trip.tz` and a tz for the account's home airport. Do **not** implement as a global display mode — see §12 |
| C8 | Map hides the header day chips | `lenses/MapLens.tsx` — supersedes the R4 tension logged 2026-08-25 |
| C9 | Budget: "left" is the emphasised value | `trip/TripHeader.tsx` — Badge (`success`/`warning`) for what's left, slate mono for spend-of-total |

### Design-system bug — belongs upstream, not in consumers

`Sheet`'s body is `<div className="flex-1 overflow-y-auto">`. `overflow-y: auto` forces
`overflow-x: auto`, making it a scroll box that clips paint outside its padding edge.
`Input`'s `outline-2 outline-offset-1` draws 3px outside its border box, so **every
full-width input in every Sheet loses its left and right focus ring.** The design works
around it per-Sheet; the real fix is horizontal padding on `Sheet`'s scroll div in the
design-system package. Same class of bug in any Dialog scroller with one-sided padding.

### Resolved since 2026-08-25

- **D5 / R6 (trip rename).** Confirmed: no pencil, no inline rename anywhere in the design.
  The dead `startRename`/`commitRename` handlers that made this ambiguous have been
  deleted from the design file. Renaming happens only in Trip settings.
- **Calendar's future** (§11 "Still open"). Resolved by C1 — Calendar earns its place as
  the city/shape view. No retirement path needed.
- Dead values removed from the design file with no template reference: `dragHint`,
  `mapIntro`, `sugHeading`, `suggestions`, `sugCount`, `blHint`, `fabBottom`.
  The per-tab drag hints and the "What I noticed" feed are gone from the UI.
- The Unscheduled drawer no longer force-opens mid-drag, which was shifting the whole
  bottom of the page (and the assistant with it). It stays where the user left it.
