# Design ↔ build UI audit — 2026-08-26

Full screen-by-screen comparison of the running app against the
**2026-08-24 design handoff** (`.design-sync/handoff/`, commit `9b8681a`),
run before M10's Phase 9 exit gate.

Read `DRIFT.md` in the handoff first — it is design's own reconciliation and
it is still broadly accurate. **This document is the build side of the same
question**, produced by actually rendering every screen rather than reading
code, and it therefore reports things `DRIFT.md` could not: what looks wrong
on screen, not just what disagrees on paper.

`apps/web/src/lib/preview-registry.ts` remains the authoritative list of
*deliberately* unbuilt surfaces. **Nothing already in that registry is
reported here as missing.** Every `Preview · Mn` chip in a screenshot below
is a designed shell working as intended.

---

## How this was produced

- Local Postgres 16 on `:5433`, `pnpm --filter web db:migrate`, `db:reseed`,
  `pnpm dev` on `:3001`, signed in as the `alice` dev-login user.
- Seeded data: the three `[Seed]` trips from `apps/web/scripts/db-seed.ts` —
  Japan (14 days / 68 stops / 4 backlog), Rochester→Niagara (4 days, one
  deliberately empty), Portland (2 days).
- Headless Chromium screenshots of every route × lens × overlay at **1440×900**,
  **1100×800** and **402×844**, plus every sheet, popover and drawer that has a
  trigger in the UI.
- **Not verified locally:** the MapLibre canvas. `tiles.openfreemap.org` is
  blocked by this sandbox's egress proxy, so the Map lens rendered its rail,
  focus card and legend but a blank canvas. Every Map finding below is about the
  chrome around the map (rail, focus card, legend, day chips); **the map canvas
  itself is the one thing this audit could not look at, and wants a pair of eyes
  on the preview.**

---

## Verdict

The **trip surfaces are close**. Timeline, Calendar, the day-chip rail, the
map rail, the trip header, Trip settings, the Playbooks route, the New-trip
wizard, the Unscheduled rack and the End-of-trip block all read as the design
intends, several of them near-exactly (Trip settings' start-only date editor
matches SPEC §3 word for word, including its hint copy).

Three things are not close, in descending order of how much they cost:

1. **Notebook / Pages** is a designed feature (SPEC §7) against a build that
   has no design applied to it at all — including one CSS class that is
   referenced but never defined, so page prose renders with zero typography.
2. **Mobile** is the desktop layout at 402px. The handoff's mobile file is a
   different product (SPEC §10) and none of it exists.
3. **The Day-columns lens** is fighting a conflict-banner wall that pushes the
   actual board a full screen below the fold.

Everything else is small. One defect found along the way is already fixed in
this PR (A1, the local seed's stop ordering); it never affected the preview.

---

## Status — 2026-08-26, end of the PR #55 review round

Fifteen preview comments from Mitchell were worked through on this branch, plus
the design's own rules pass. What that closed, and what it did **not**:

**Closed against the design (`RULES.md` / `DRIFT.md` "Rules pass — 2026-08-25"):**

| Rule | Change | Where |
|---|---|---|
| R6 | Trip title *is* the settings button; pencil and ⚙ gone; renaming moved into Trip settings | `TripHeader.tsx`, `SettingsSheet.tsx` |
| R7 | Undo/redo relocated into the History popover | `UndoRedoControls.tsx` |
| R4 | Trip-header save dot removed; **the logo carries save state** | `SaveLight.tsx` (new), `AppHeader.tsx`, `layout.tsx` |
| R1 | Signed-out header is the logo only — no links into pages you cannot open | `AccountMenu.tsx` |
| — | "Worth your attention" removed from the trips list | deleted, incl. its `preview-registry` entry |

**Closed as defects:** A1 (seed ordering), **A2 in part** — see KI-43 below — A4
(`1 travellers`), the three "cut-off border" reports (one root cause: an
`overflow-x-auto` container clipping on all four sides, in `ui/sheet.tsx` and
`DayChips.tsx`), the day-chip transition printing its destination twice, the
board's width, city day-counts, and the drag-from-rack time gap.

**Both open questions were put to Mitchell and answered on 2026-08-26:**

1. **R2 — "Drawer renders in Day columns only." → apply the rule, and
   generalise it.** `RULES.md` 2 reversed a decision `STATUS.md` recorded the
   day before (the rack stays on Timeline and Calendar for its day-assign
   `NativeSelect`). Mitchell decided for the rule, with a general form that
   outlives this instance:

   > Lets remove for now, but follow the more general rule from now on. If the
   > drawer element has page interactions (Almost always a drag / drop onto the
   > page) then add it back. We have some designs about dropping onto
   > timelines, and calendars, and complex logic how that works, but we can
   > delay that to later, and when its added, we add back the drawer to those
   > pages.

   Built as `board/lensAcceptsDrops.ts` — a question about drop targets, not a
   lens list — so closing any of `TODO.md`'s four rack/lens gaps brings the
   drawer back to that lens by changing one function. The reversal is recorded
   in `STATUS.md` beside the decision it overturns rather than replacing it,
   and `TODO.md`'s drag-scope entry now notes that the drawer follows it.

2. **The save light's failed state → keep the mark as the retry button for
   now; the popover is a nice-to-have.** SPEC gives the failure a colour and no
   way out, and this queue only retries when asked (KI-36), so the shipped mark
   doubles as Retry while a send has failed. That does put an *action* in the
   top bar, spending the "status, not an action" justification SPEC itself used
   against `RULES.md` 1 — accepted deliberately for this milestone. The
   status-only mark with a popover carrying the failure detail and Retry is
   filed under `TODO.md`'s candidate ideas.

**Still open from the rules pass, not started:** R4 (`Travel` chip suppressed on
transit stops), R5 (filter row removed; tag chips become the control — blocked
on C4's missing `tags` field), R7 (Notebooks becomes a menu at the far right of
the view row), R2 (map day rail restored, clicking jumps).

**Unchanged and still the headline gaps:** C1 (Notebook/Pages has no design
applied), C2 (mobile is the desktop layout at 402px), C4 (no `tags` contract
field blocks five designed surfaces). None of these are close to done, and none
were in scope for this round.

---

## A. Fix — built, and wrong

These are defects, not design disagreements. Each is filed as a KI.

| # | What | Where | Why it matters |
|---|---|---|---|
| **A1** | **Local seed only.** Day columns and calendar cells listed stops newest-first — Day 1 read Nightcap 21:00 → Dinner 19:00 → Check-in 17:00 → Land 14:30. | `apps/web/scripts/db-seed.ts` moved every seeded activity with `position: 0`, reversing insertion order. `Column.tsx:121` and `calendarData.ts:104` render `day.activityIds` verbatim — neither sorts by time — so nothing corrected it. Timeline was unaffected (`timelineData.ts` sorts). | **Fixed in this PR** at the seed, and re-verified. **The Vercel preview was never affected**: its "Reset to demo data" path (`japanTripImporter.ts:231-259`) emits `AddActivity` with a `dayId`, and `ActivityAdded` appends (`evolve.ts:90`), so it always reproduced the export's order. The bug was local dev and e2e fixtures only. The *second* half — whether a day column should sort by start time the way the design does — is untouched and is a real decision, see D3. |
| **A2** ✅ *summary half fixed (KI-43), in-card half open* | The **conflict wall**. `Board.tsx:201` renders one full-width `Banner` per undismissed conflict, unbounded, above the columns. The Japan seed has 12, ≈700px of stacked warning that puts the board below the fold. | `apps/web/src/components/board/Board.tsx:201` | The design never stacks conflicts: Timeline attaches `act.conf` under the activity, Day columns puts a one-line `act.confShort` chip *inside* the card. `Column.tsx` already renders that in-card treatment, so the wall is **redundant with it**, not a substitute. |
| **A3** | `.tc-page-editor` is applied to the TipTap editor but **has no CSS rule anywhere in the repo**. | `apps/web/src/components/pages/editor/PageEditor.tsx:41` | Every notebook page renders headings, paragraphs and lists at the reset's default size and weight. "Overview" and the sentence under it are visually identical. This is the single cheapest fix on this list. |
| **A4** ✅ *fixed* | `1 travellers`. | `apps/web/src/components/trip/TripMetaPill.tsx:42,58` (both the visible label and the `aria-label`) | Every solo trip's header reads ungrammatically. `NextTripHero.tsx:186` already does the plural correctly — the pattern exists. |
| **A5** | `Preview · Mn` chips cover the content they annotate. Confirmed on Trip settings (M11 chip over Booked's `$4,088.25`), Who-is-invited (M13 chip over "Invite someone"), New-trip wizard (M11 chip over the "Back to Kyoto" chip), the Unscheduled rack cards, and the mobile Playbooks strip. | `apps/web/src/components/ui/preview.tsx:94-100` | `size="compact"` reserves a `pr-6` gutter and is fine. `size="container"` deliberately does not (`preview.tsx:79-85`: "landing on the dotted border itself rather than on whatever content sits beneath") — which holds only while the host's own top-right corner is empty. In all five cases above it isn't, and the chip hides a real number. |
| **A6** | An empty day renders **two** empty states: the design's `route` fallback ("No stops yet — add one, or drop a saved day onto it") *and* "Nothing planned yet", *and* "Add the first stop". | Rochester trip, Day 3 — `TimelineLens.tsx` | Three affordances for one condition. The design has one line and one button. |
| **A7** ⚠️ *the focus-ring clipping half is fixed; the missing scroll affordance is not* | The day-chip rail clips its last chip mid-card at 1440px with no scroll affordance. | `apps/web/src/components/trip/DayChips.tsx` | Reads as a rendering error rather than as "scroll me". The design's chip row has the same overflow but the map rail's gearing pattern already solves it elsewhere in this codebase. |
| **A8** | The account menu renders an **empty second line** where the email goes for dev-login users (dev-login has no email). | `apps/web/src/components/AccountMenu.tsx:92-99` | Preview-only cosmetic, but it is what Mitchell will see in every preview review. |

---

## B. Drifted — built, but disagrees with the design

Design's call vs the build's, with a recommendation. **Code wins** here more
often than it loses; several of these are deliberate and documented.

| # | Thing | Build | Design | Call |
|---|---|---|---|---|
| B1 | Home hero meta | `Created Aug 26, 2026` + planned-of-budget | `Sep 20 – Oct 3, 2026 · 14 days · 6 cities`, badge `in 60 days` | **Design.** `TripDetail.startDate` now exists and the hero already fetches the detail (it draws the sparkline from it) — day and city counts are derivable there. `DRIFT.md` D6's "needs a server field" is now only true of the *grid* cards, not the hero. |
| B2 | Home hero stat tiles | `1 traveler` / `0 days planning` / `12 open conflicts` | `68 stops planned` / `7 not booked` / `2 need a decision` | **Split.** Tile 1 and 3 are fine. `0 days planning` is a real problem: it is `createdAt → now`, so a freshly seeded 14-day trip reports zero. `NextTripHero.tsx:192`'s own comment says it stands in for "stops planned", which the hero *can* now count. Swap it. |
| B3 | Trip-grid cards | name, `Created …`, planned-of-budget, avatar, `Active` | colour spine, name, **trip dates**, one-line summary, budget line, avatars + `68 stops`, `Planning`/`Booked` badge | **Code wins for now** — `TripSummary` (`packages/contracts/src/trip.ts:238-244`) carries `tripId/name/status/members/createdAt` and nothing else, so dates, stop counts and a real lifecycle state all need contract fields. This is `DRIFT.md` D6 unresolved. The badge reading `Active` (the delete-state) where the design means a planning stage is the part most worth naming as a contract gap. |
| B4 | Trip header meta pill | dates · days · stops · cities · **`1 travellers`** | dates · stops · cities | **Design.** SPEC §8 explicitly removed travelers from this pill ("travelers are reachable only through Trip settings until [the Travelers UI] exists"). The build kept them. Removing it also disposes of A4. |
| B5 | Trip header layout | `← Your trips  Notebook` together on the left; `⚙ Share [Add stop] ● ↺ ↻ History` on the right | `← Your trips` left; `Notebook →` **top-right**, above the action row; `Add stop` the rightmost primary | **Low stakes, design.** The build's ordering puts the primary action in the middle of the cluster. |
| B6 | Day meta line | `4 stops · Tokyo` | `4 stops · Shibuya → Ebisu → Nishi-Azabu · 4.2 km on foot` | **Design.** The route line is the day header's whole point — it is the one place the plan tells you the day's shape. `mapRailData.ts` already computes per-day distance (the map rail prints `18.6 km`), so the km half is reachable today; the area chain needs an `area`, which the seed carries in its own row shape but which **`Location` does not have** — `packages/contracts/src/activity.ts:34-46` is `name` / `lat` / `lng` / `city`, and `db-seed.ts` folds the area into `location.name` as free text. So the km half is buildable now and the area chain is another field gap. |
| B7 | Activity card, right column | who → cost → Ask/Edit | cost (+`est`) → who → Ask/Edit | Design. Cosmetic. |
| B8 | Activity card, "who" | raw `dev-alice` | a display name (`Sam`) | **Design.** A raw user id on every card is the most obviously unfinished thing on the Timeline. |
| B9 | Activity cards carry no tags | — | tag chips on every card, a tag filter row beside the TabStrip, and (SPEC §10) the only way to thin a mobile column | **Blocked**, see C4. Not a fix. |
| B10 | Add-a-stop sheet | `What or where` → Example match (M9) → **`Place name` + `Search`** → Day/Start/How long → Cost → Who → Notes | one `What or where` field whose own matches fill in the address | **Design, eventually.** The separate manual geocode row is a real second step the design folds into the first field. Worth leaving until M9's grounded search lands and then deleting both. |
| B11 | Add-a-stop sheet has **no Tags block** | — | Tags with "Pick as many as fit" + per-tag power hint, above Notes | Blocked, see C4. |
| B12 | Edit-activity uses `End time` | `End time` | `How long` (a duration select) | **Code wins.** End time is more precise and the resulting `Fits 9 pm–10:30 pm…` banner already matches the design's `addSlotNote` exactly. |
| B13 | Trip settings has `Duplicate trip` / `Delete trip`; has no "Changes save as you type" footer | | design has the footer note + a `Done` button, no lifecycle actions | **Code wins** on the actions (see D2 — they are real and undesigned). The missing "Changes save as you type" line is worth adding; the sheet gives no feedback that edits persist. |
| B14 | Trip settings' date editor opens as a **floating popover** that covers "Total for the trip" | | inline, pushing the section down | Fix when convenient. The editor itself is otherwise an exact match to SPEC §3. |
| B15 | Account menu | name + (empty) email + `Sign out` | name + email + `Your account` + `Sign out` | **Code wins, documented** — `AccountMenu.tsx:40` says "omitted a third item rather than ship one that did nothing". Correct call. Fix the empty line (A8). |
| B16 | Assistant | a 356px docked rail, always open above 1180px, `Hide` to dismiss; a `◎ Assistant` pill below it | SPEC §9: one panel, three presentations — **bubble** (default) / **floating** (draggable) / **docked** | **Already scoped** as M16 (ADR-022, `docs/milestones/M16-assistant-read-agent.md`). No action for M10. |
| B17 | Day-chips row and the Unscheduled rack are shown on Calendar; chips shown on Map | | design drops both on trip-scope views | **Settled for the header/rack half** — Mitchell rejected SPEC §1 wholesale on 2026-08-26 and the rack-on-Calendar decision is recorded in `STATUS.md`. **Still open:** `DRIFT.md`'s separate review-pass note that the *chip row* should come off the Map, because the map rail is already a full-height day selector. One decision, not covered by the §1 rejection. |

---

## C. Missing — designed, and nothing in the build

Excluding everything in `preview-registry.ts`.

### C1 — Notebook / Pages has no design applied (SPEC §7) — **the biggest gap**

`DRIFT.md` §3 called Notebook "undesigned"; the 2026-08-24 handoff **designed
it**, and the build has not moved. Against SPEC §7 the page surface is missing:

- The **Reading / Editing** segmented control. There is no reading mode.
- **Macro chips.** SPEC §7's premise is "pages are prose with live values" —
  a tinted, faintly-underlined chip that re-resolves from the trip on every
  render. `packages/pages/src/templates.ts:15-18` says the opposite out loud:
  seeded templates deliberately plant **no** macro nodes, because "macro
  authoring left the primary editing surface in M8". Both prebuilt pages are
  therefore static placeholder prose. **This is a direct contradiction
  between the spec and a deliberate build decision and needs settling before
  anyone builds to §7.**
- The **"Insert from the plan" Sheet** — search, scope (account / trip / this
  day) × shape (all / one value / block / repeats), live counts, resolved
  previews, `needs a field` badges.
- **Repeaters** ("a line for every day/stop/city"). SPEC §7 says outright the
  registry cannot express this yet and that its macro-param schema "is the
  main engineering decision the Notebook creates".
- The **info Banner** naming what a page follows after a rebind.
- The page **Card** shell, title/subtitle, and any typography at all (A3).
- The list screen: the design has a back link to the trip, a description, per-
  page **bind badges**, blurbs, and a **"Start from a template"** section.
  The build has a plain two-row list with `Rename`/`Delete` and raw
  `8/26/2026, 4:18:30 AM` timestamps.
- Present in the build and **not** in the design: `Bind to day` (labelled with
  the internal term, and always shown rather than only when day-bound) and an
  **"Ask AI to draft this page"** panel.

### C2 — Mobile is unbuilt (SPEC §10)

`Trip Planner Mobile.dc.html` is a five-screen companion design — Plan, Edit
stop, Map, Notebook, Trips — with a bottom tab bar, a pinned non-collapsing
day-rail spine, a tag filter row, 44px targets, stop cards that drop the 92px
time gutter and move time inside in mono, and an explicit list of what gets
cut (Day columns, Calendar, drag-to-reschedule, the History popover).

**None of it exists.** At 402px the build renders the desktop layout
unchanged. Observed:

- The trip header alone consumes ~1130px of an 844px viewport before any plan
  content: the meta pill wraps `Sat, Sep 5 – Fri, Sep 18` across five lines
  inside its rounded pill, and the title wraps to two lines at full desktop
  size.
- Stop cards collapse — the title wraps, the right-hand cost column crushes
  into it, and `Ask`/`Edit` overlap the note box.
- All four lenses are still offered, including the two the design cuts.
- No bottom tab bar; the assistant is a "show the rail" pill.

At **1100px** the app is fine — the header cluster reflows to one row and the
timeline reads well. The breakpoint story between 1100 and 402 is the gap.

### C3 — Landing, sign-in and sign-up (design D2, SPEC §6 D2)

Signed out, `/` renders `<Heading>Caesura</Heading>` and a `Sign in` link
(`apps/web/src/app/page.tsx`, the `unauthenticated` branch), and sign-in is
NextAuth's default page. The design has a full landing hero ("Plan the trip
together, not in twelve group chats."), a live trip-card illustration, proof
chips, and custom sign-in/sign-up screens.

Also a real bug in the meantime: the signed-out page still renders `AppHeader`
with **`Trips` and `Playbooks` nav links** to authenticated routes. The
design's landing header carries only the logo and `Sign in` / `Start a trip`.

There is **no first-run screen** either (design's `isFirstRun`: "What are you
planning, Sam?"). `first-run-when` is the **only** `data-preview-id` in either
design file, and it has no entry in `preview-registry.ts` — because the screen
that would host it does not exist. Worth an entry anyway, so the registry stays
the single list it claims to be.

### C4 — Tags have no contract field, and five designed surfaces depend on them

`packages/contracts/src/activity.ts` has no `tags`. That single absence blocks:
tag chips on stop cards (B9), the tag filter row beside the TabStrip (B9),
the Add/Edit-stop tag picker (B11), the Notebook repeater's tag filter (C1),
and SPEC §10's "the filter row is the only way to thin a 402px column".

Same class as, and arguably ahead of, the field gaps already registered for
`rack-provenance` / `cost-estimate-state` / `budget-breakdown`. **Worth a
registry entry and a contract decision** rather than sitting unlisted.

Related: the seed encodes `status` (`booked` / `hold` / `idea` / `transit`)
and per-stop `who` **into the note text**, which is why cards read
`(transit)` and `(idea) (Sam K + Jonah M)`. The design's `act.badge`
(Booked/Hold/Idea) has no field behind it either.

---

## D. Undesigned — real in the build, absent from the designs

`DRIFT.md` §3 listed these; the 2026-08-24 pass designed Notebook and left the
rest. Still outstanding:

- **D1 — History & time travel.** `HistoryPanel` + `UndoRedoControls` exist and
  the popover matches the design; *preview a past version* (read-only banner)
  and *revert to state* do not appear in the design beyond that popover.
- **D2 — Trip lifecycle.** Delete → undo toast → `RestoreTrip`, and
  `duplicateTrip`, both live in Trip settings. The optimistic-delete
  interaction (drop the row on confirm, re-add on failure) has no designed
  counterpart.
- **D3 — Whether a day column sorts by time.** The design's Day-columns view
  is chronological; the build's is a hand-orderable list you drag, whose order
  a stop's own time never touches. These are different products, and A1's seed
  fix only stops the question being asked by accident. Pick one deliberately.
- **D4 — Dev login**, deliberately.

`DRIFT.md` §3's "extra lenses" bullet is **stale and can be struck**:
`ItineraryLens`, `DailyOverviewLens` and `FullTripOverviewLens` no longer
exist in the tree (only `TripBoardScreen.test.tsx` still mentions the names),
and `LENSES` (`LensRouter.tsx:12`) is exactly `Board | Map | Schedule` per
KI-20. `MapRail` is real and still undesigned; the rest of that bullet is not.

---

## E. Send back to design

Small inconsistencies inside the handoff itself:

1. **The handoff dates the same trip three different ways, and none of the
   three produces the case SPEC §4 exists to protect.**
   - SPEC §4: *"Japan runs **Sep 20 – Oct 3, 2026**: eleven days in September,
     three in October, so the two-month case is the default thing you see
     rather than an edge case nobody looks at."*
   - `data/japan-trip-seed.json` — the export the preview's "Reset to demo
     data" actually imports — says `startDate: 2026-10-03`,
     `endDate: 2026-10-16`, `datesLabel: "Oct 3 – Oct 16, 2026"`. **Entirely
     inside October.**
   - `Trip Planner Mobile.dc.html` agrees with the JSON (`Oct 3 – 16`), not
     with SPEC.

   So the preview's demo trip renders **one** month block, and the local seed
   (`db-seed.ts:203`, `isoDateInDays(10)` — relative to today, which is better
   for "next trip" framing) only straddles a boundary by luck; today it renders
   Sep 5 – Sep 18, also one block. **The multi-month calendar SPEC §4 designs at
   length is the one thing no seed in this repo shows.** Pick a start date that
   forces the boundary and make all three agree.
2. SPEC §4 warns that day labels must derive from *start date + day index*, not
   the trip's month. **The build is already correct here** — `calendarData.ts`
   matches on full date and the day rail prints the month at boundaries. The
   warning can be retired.
3. `DRIFT.md` §3's "extra lenses" bullet is stale — see §D.

---

## Suggested order

1. **Land the rest of A.** A1 is done. A3 and A4 are minutes each. A2 (the
   conflict wall) is the one that changes how the Day-columns lens reads.
2. **Settle the two contract questions** — tags (C4) and `TripSummary`'s dates
   (B3/`DRIFT.md` D6). Both gate more than one designed surface, and both are
   registry entries, not code.
3. **Settle SPEC §7 vs `templates.ts`** before anyone builds Notebook. The spec
   assumes live macro chips; the build removed macro authoring on purpose in
   M8. That contradiction is the actual blocker, not the UI.
4. **Then pick between** Notebook (C1) and mobile (C2). Both are whole
   workstreams. Neither belongs in M10.
5. **B's drift list is a polish pass** — most items are one file each and could
   ride along with Phase 9.

Nothing in A–B is a reason to hold M10's gate. A2 is the one worth landing
before it, because the gate's own Day-columns screenshot is otherwise mostly
warning banners.
