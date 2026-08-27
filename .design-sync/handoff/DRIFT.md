# Design ↔ build drift — Caesura / travel-collab

Design: `Trip Planner Redesign.dc.html` (desktop + phone surfaces, landing, auth, first run).
Build: `Neablis/travel-collab@main`, read from the attached working tree, 2026-08-26.

This is a **current-state** document. It replaces the append-only log that ran
2026-08-22 → 08-26; everything already closed is condensed into §5 rather than kept
in full. Two files are authoritative on the build side and are not restated here:
`apps/web/src/lib/preview-registry.ts` (18 shelled-but-unwired surfaces, each with a
milestone) and `docs/known-issues.md` (KI-nn). Preview-wrapped UI is *designed and
shelled, not missing* — it is not a design gap.

---

## 1. Open drift — code and design disagree

| # | Thing | Code | Design | Call |
|---|---|---|---|---|
| **D1** | Product name | `AppHeader` says **Trip Planner**; `metadata.title` is `travel-collab` | **Caesura** | Design wins. Still unchanged in code — the oldest open item on this list. |
| **D2** | Unauthenticated home | `app/page.tsx` renders a bare heading + a link to NextAuth's default page | Full marketing landing page, custom sign-in / sign-up | Design wins. **Rewritten this turn — see §2.** |
| **D3** | Trip status badge | `TripHeader` renders a status `Badge` | No badge | Code wins; design should add it back or the build should drop it. Only survivor of the old D5 list. |
| **D4** | New-trip "roughly when?" chips | `CreateTrip` (`contracts/src/trip.ts`) carries **name only** | First-run screen offers date-range chips | Shipped as a Preview-wrapped shell with a dashed border reading "needs a `CreateTrip` field". Contract change, or delete. |
| **D6** | "Next trip" | `TripSummary` has no dates, so `nextTrip` is `visibleTrips[0]` | Upcoming-by-date hero + "in 47 days" countdown derived from `TODAY` / `NEXT_TRIP_START` | **= their KI-34, still open**, and worse than first written: with nothing to sort by, the hero can surface the *wrong trip*, not just the wrong date. Countdown is honest in design and unbuildable until the field lands. |
| **D8** | Landing page has no route | nothing — the unauthenticated branch is four lines | A full screen with a rotating hero and three feature blocks | New with §2. Needs a real marketing route, not a conditional inside `page.tsx`. |

D5 and D7 are closed (§5).

## 2. New this turn — the landing page

`startScreen: landing` is a complete surface with **no counterpart in code at all**.
What a build would have to carry:

- **Rotating hero.** Three views of a Japan trip — Day 5 Notebook, Day 6 Map, Day 7
  Timeline — on a 10s cycle. Clicking a day pill jumps and restarts the timer.
  **The content is hardcoded marketing fixture data, not a live trip.** The page is
  unauthenticated and must render with no session, no fetch and no backend — it looks
  like the product, it is not connected to it. Keep the fixture in the marketing route,
  not imported from the seed importer, so a data-model change can never break the
  front door.
- **Three feature blocks, equal height:** *Together* (live timeline: a lifted stop,
  a comment thread, travel gaps), *Notebook* (prose with an inline, borderless cost
  table — activity / who / cost, Day 6 total $596), *Playbooks* (a borrowed Phuket
  beach day, 4.8★, "Shared 214 times", dropping in as Day 2).
- **Positioning constraints, deliberate:** no "free", no "open source", no "no credit
  card". The only footnote is **Early access**. If marketing copy re-enters, it should
  not re-enter through these claims.

**It is buildable today** — static fixture, no dependency on anything in §3 or §4, and
**deliberately ahead of the build**. Two blocks show functionality that does not fully
exist yet: the Notebook block shows prose with live macro values (SPEC §7, which
`packages/pages/src/templates.ts` contradicts) and the Playbooks block shows a shareable,
rateable day (`playbooks-route`, `insert-playbook`, `add-saved-day` are Preview shells).

**That is the intent, not drift.** A landing page states where the product is going; it
does not wait for the last shell to be wired. Do not file these as blockers and do not
water the page down to what ships today. The one thing that would be a real problem is a
*claim* the product will never honour — the copy makes none, and "Early access" is the
footnote that covers the rest.

Design-file note: decorative SVG layers in the hero are `pointer-events: none` so the
day pills stay clickable. Same trap will exist in any real implementation.

## 3. Designed, shelled in code behind `<Preview>`

From the registry, unchanged this sync. **Blocked on a missing field:**
`rack-provenance` (who parked a stop, which day it came from), `cost-estimate-state`
(confirmed vs estimate), `budget-breakdown` (Booked/Holds/Travel/Other),
`trip-invites` (`TripMember.role` is the literal `"owner"`), `map-legend-modes`
(transport mode per leg).

**Blocked on a feature, not a field:** `home-worth-attention`, `home-decisions`,
`home-playbooks-strip`, `assistant-suggestions`, `assistant-quick-asks`,
`timeline-ghost`, `keep-day-flag`, `keep-day-dialog`, `playbooks-route`,
`insert-playbook`, `share-button`, `add-saved-day`.

Add to that list, from KI-47: **there is no `tags` field**, which blocks the tag chips
and dim-in-place filtering on five designed surfaces — including the phone's filter
chips.

## 4. Real in code, absent from design

- **Notebook / Pages — an entire feature.** `packages/pages` (macro registry,
  templates, inline + block macros), `NotebookScreen`, `PageScreen`, `PageEditor`
  (TipTap), `MacroNodeView`, `ComposePanel`, `ItineraryDayBlock`, `ItineraryTripBlock`,
  `CostsTableBlock`, routed at `/trips/[tripId]/pages`. **Blocked, not queued:** SPEC §7
  says prose with live macro chips; the build removed macro authoring in M8 and seeds
  templates with no macro nodes. Nobody should design or build to §7 until that is
  settled. It is also why the phone Notebook stays unstarted.
- **Trip lifecycle.** Delete → undo toast → `RestoreTrip`, and `duplicateTrip`. The
  optimistic pattern (drop the row on confirm, re-add on failure) has no design.
- **Dev login.** `dev-login` credentials provider behind `AUTH_DEV_LOGIN` — the only
  non-Google way in. Probably intentionally undesigned.

History & time travel came off this list on 2026-08-25 (designed). The "extra lenses"
bullet is struck permanently — `ItineraryLens`, `DailyOverviewLens` and
`FullTripOverviewLens` no longer exist.

## 5. Closed — kept as one line each

- **D5 / R6 rename.** No pencil, no ⚙, no inline rename on either surface; the trip
  title *is* the settings button and renaming happens only in Trip settings. Build
  still owes the `TripHeader.tsx` deletion and the two test updates.
- **D7 sync failure.** One banner pattern — reuses `ConflictBanner`'s vocabulary.
- **Rules pass (2026-08-25).** Header is account scope only; drawer renders only where
  things can be dragged; save state lives on the logo; filter row removed; undo/redo
  folded into History; Notebooks is a menu; Map keeps its day rail and hides the header
  chips.
- **Calendar (2026-08-26, SPEC §12).** Cells are city rollups, not activities; day
  selection is persistent and does not navigate; stop-level drag removed. Calendar's
  retirement question is answered — it is the city/shape view.
- **Two files became one.** `Trip Planner Mobile.dc.html` is deleted; the phone is a
  `surface` prop on the desktop file, sharing trips, accent hash, focus, tag filter and
  the edit sheet. Every mobile defect that pass fixed — stale October dates, blue
  Hakone, the leftover ⚙, a 25-vs-60-day countdown — was a copy drifting, not a design
  decision. Answers **KI-46** from the design side.
- **Seed data dated once.** Sep 20 – Oct 3, 2026, all 14 days with real weekdays.
  `japan-trip-seed.json` previously said Oct 3 – 16 — entirely inside October — so the
  preview's demo reset could never produce the two-month calendar SPEC §4 protects.
- **One handoff folder** (`design-sync/handoff/`); dated snapshots deleted.
- **DS findings moved out** to `design-sync/handoff/DS-UPSTREAM.md` (U1–U6). They belong
  to the design-system package, not this app.

## 6. Build-check list — things a build engineer should verify

Carried forward because each one is a bug the design already hit:

1. **Day labels derive month from start date + day index**, never from the trip start.
   Check `CalendarLens`, `MapRail`, every day chip.
2. **Accents are `oklch` and most non-CSS consumers cannot read them.** MapLibre parses
   CSS Color 3 only and silently falls back to black; canvas `fillStyle` and
   `getComputedStyle` both *preserve* `oklch()` verbatim, so they look like a fix and
   are not. Convert arithmetically wherever an accent reaches a map paint property, a
   chart library or an SVG attribute. Hue ramp has a 35° minimum gap.
3. **One `focus` per trip, but derivation is per surface.** The phone must not run the
   timeline's scroll-spy — a capture-phase `document` scroll listener will otherwise
   overwrite the phone's day selection from a still-mounted desktop timeline.
4. **The tab is the route.** The phone client must not hold tab state independent of
   the router; "am I in a trip" belongs to the route alone.
5. **Maps inside conditional markup need a container-identity guard** — remount leaves
   the instance bound to a detached node and the style load aborts silently.
6. **Gesture handlers go on the element, not `document` with `capture: true`.**
7. **Saving a stop must actually move it** (keep duration, snap to 15 min, re-sort the
   day). This was a live desktop bug found only via the phone.

## 7. Their open items that touch design

| KI | Meaning for us |
|---|---|
| **KI-34** | = D6. Blocks the countdown and correct next-trip selection. |
| **KI-43** | `Board.tsx` stacks one full-width `Banner` per conflict — 12 on the Japan seed, board below the fold. Design puts conflicts inside the card, which `Column.tsx` already does. Design is right; the fix is theirs. |
| **KI-44** | `.tc-page-editor` is applied to every page and defined nowhere, so Notebook prose has no typography. Cheapest real fix in their audit. |
| **KI-45** | `Preview size="container"` covers host content, including a currency amount in Trip settings. |
| **KI-47** | No `tags` field. Blocks five designed surfaces. Don't design more tag UI until it lands. |
| **KI-48** | Six one-file cosmetics, including `1 travellers`. Our copy says "4 travelers". |

## 8. Still open, on our side

- **The phone has no conflict state.** Offline / sync-fail landed (map tiles time out
  after 2.6s with *Try again* / *Open Plan*); conflict is still missing, and project
  rule 6 requires all three of every screen.
- **The landing page needs no empty / offline / conflict state.** Rule 6 is satisfied
  trivially: static fixture data, no session, no network — there is no state where it
  can fail to render. Noted so it is not re-raised.
- **Day 6's phone Plan cards** still carry times and an ordering that predate the seed,
  and one uses an estimate treatment for a stop the desktop has as `booked`. Content
  pass, not a token pass.
- **Whether a day column sorts by start time** the way the design does (their audit D3).
  Their `db-seed.ts` reverse-order bug is fixed and never reached the preview, but the
  product question is unanswered.

## Suggested order

1. Settle **D1** (rename to Caesura in code) — it is trivial and a year stale.
2. Settle **SPEC §7 vs `templates.ts`**. It blocks Notebook on both surfaces *and* the
   landing page's second feature block.
3. Land **KI-34** so the home hero can be honest.
4. Design the phone **conflict** state; that is the last of rule 6.
5. Then §4's undesigned lifecycle work.

Build status, for planning: M10 Wave 2 Phases 5–8b are merged; **Phase 9 is M10's exit
gate and is the next work**. Nothing in this document holds it.
