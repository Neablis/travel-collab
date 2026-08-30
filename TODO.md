# TODO — high-level roadmap for agents

How to use this file: find the first unchecked item — that is the current
work. Read its milestone file in `docs/milestones/` before planning anything.
Check items off only when the milestone's exit gate passes (not when code
merges). Never start an item while an earlier one is unchecked without
Mitchell's explicit say-so. Full process: `docs/guidelines/`.

**Right now that say-so has been given and the list is out of order on
purpose**, so read the marker, not the position: **M18b is the current work**,
per the order set on 2026-08-29 when Mitchell placed two of the three
approved-but-unplaced milestones: `M18b → M17 → M12 → M13 → M14 → M9`.
**M11b Playbooks stays unplaced** — unlike the other two it has no scope and
no exit gate written yet, and authoring those is a product decision.
Whichever item carries `← current milestone` is the current work; when that marker and the first
unchecked item disagree, the marker names a recorded Mitchell decision and the
milestone file it cites is the evidence.

**One item is approved but deliberately unplaced, and it is not "next" just
because it appears unchecked:** **M11b Playbooks** (carved out of M11's gate
2026-08-28), which needs its own scope and exit gate written before it opens —
a product decision, not something to pick up by position. *(M18b and M17 were
the other two until 2026-08-29, when Mitchell placed both; M17 needed a
re-scope to be placeable and got one in the same decision.)*

**Scope for each milestone lives in `docs/milestones/README.md`** (the table),
and the detail plus exit gate in that milestone's own file. This file is the
checklist only — deliberately not a second copy of the scope, because two
copies drift.

Where the work actually stands right now: `docs/STATUS.md`.

## Phase 1 — Full single-player product

*Phase gate: Mitchell plans a real trip end-to-end and needs no other tool.*

- [x] **M0 Walking skeleton** → `docs/milestones/M0-walking-skeleton.md`
- [x] **M1 Planning core** → `docs/milestones/M1-planning-core.md`
- [x] **M2 History & time travel** → `docs/milestones/M2-history-time-travel.md`
- [x] **M3 Place & time** → `docs/milestones/M3-place-and-time.md`
- [x] **M4 Money & lenses** → `docs/milestones/M4-money-and-lenses.md`
- [x] **M5 Design foundations** → `docs/milestones/M5-design-foundations.md`
- [x] **M6 Atomic changes** → `docs/milestones/M6-atomic-changes.md`
- [x] **M7 Solo delight** → `docs/milestones/M7-solo-delight.md`
      *(Trip templates moved to M11 during this milestone.)*
- [x] **M8 Make it real** → `docs/milestones/M8-make-it-real.md`
      *(Gate closed 2026-08-08. Wave A merged 2026-08-07 via PR #21; Wave B
      (anchors/timezone/macro subtraction) merged the same day; Wave C's
      ergonomics tasks and Wave D's first-run/empty-state tasks trimmed from
      scope 2026-08-07 — see Candidate ideas below; C4 (KI-5 sync indicator)
      and D3 (e2e gate script) closed the gate.)*
- [x] **Phase 1 gate review with Mitchell** — done 2026-08-08. The 2026-07-28
      review had deferred this behind M8 (a trip could not be renamed or
      deleted); M8 closed that floor and the dogfood review passed.

## Phase 2 — A product worth using

- [x] **M10 Visual craft pass** → `docs/milestones/M10-visual-craft.md`
      *(Brought forward ahead of M9, 2026-08-08 — see ADR-018. Wave 1's gate
      closed 2026-08-10 on PR #23, then **reopened 2026-08-14** by an external
      design review: the handoff had moved two generations since Wave 1 was
      built, and Wave 1's own assistant rail introduced three blocking defects.
      Wave 2 closed the delta, findings at
      `docs/design-feedback/2026-08-14-M10-redesign-external-review.md`.
      **Gate widened on 2026-08-23** by the design sync, recorded in the
      milestone file: **Phase 8b** (Caesura rename, working sign out,
      three-state save indicator, sync-failure banner, calendar month blocks,
      and the trip start picked with the end derived) and **Phase 1b** (the
      header adopts the focus-scope model, an explicit revisit of the merged
      Phase 1). **Phase 1b was CANCELLED 2026-08-26, unbuilt** — `SPEC.md` §1's
      focus-scope model is rejected; the global bar carries nothing trip-scoped.
      Phase order to the gate was: 5, 6, 7, 8, 8b, 9.
      **Wave-2 gate closed 2026-08-27** — full DoD green, e2e 31/31 twice
      against a production build, every surface walked at 1280/1100/820px with
      the assistant rail shown and hidden. The walk found and fixed one real
      defect the automated suites are structurally blind to (the assistant
      launcher never cleared the unscheduled rack — it overlapped without ever
      blocking a click). Retro, evidence and the promoted rules are in the
      milestone file; the phase plans were deleted in the gate-close commit per
      `docs/plans/README.md`.)*
- [x] **M18 A stop knows what kind of thing it is** — **gate closed 2026-08-29**
      → `docs/milestones/M18-stop-kind.md`
      *(Two PRs. **PR 1, the contract change, landed 2026-08-27 via PR #63** —
      `ActivityKind` and `ActivityTag` real on both commands, both V1 event
      payloads and `ActivityView`, with no migration. **PR 2+ landed the
      surfaces 2026-08-29**: `act.badge`, tag chips, a kind picker and a tag
      picker in the stop editor, the home hero's "not booked" tile, `N to book`,
      and the Calendar's city grouping. Gate closed the same day — eight of
      eight boxes, e2e 46/46 against a production build, and both fields set on
      a trip created from scratch and read back off the API.
      **The Calendar rule changed at the gate.** SPEC §12's travel-day transit
      split was built, walked, and removed the same day: it fired on one of
      seven travel days and got that one wrong, because its output depended on
      how the fixture tagged cities — *"I don't think the shape of the fixture
      should drive functionality, that's how we get drift."* Grouping is by city
      alone now, equal cards plus an untitled bucket, and the day-to-day
      transition moved to the day label. **Tag focus was carved out as M18b.**
      Retro and evidence in the milestone file.)*
- [ ] **M18b Tag focus** ← **current milestone** — placed 2026-08-29,
      **built 2026-08-30, gate not yet closed.**
      The piece carved out of M18's gate.
      *(All six exit-gate behaviours are implemented and green on
      `pnpm --filter web test:e2e:ci-like`; **no flag was flipped** because the
      checklist's trigger is a *deployed* demo and no unattended session can
      reach a protected preview until `VERCEL_AUTOMATION_BYPASS_SECRET` exists.
      Closing it is one preview walk, Mitchell's — same shape as M16's close
      after PR #88. Evidence in the milestone file.)*
      → `docs/milestones/M18b-tag-focus.md`
      *(Carved out 2026-08-29 when M18's gate was amended: M18 lands both
      fields, every surface that reads `kind`, and tag chips that render and
      can be set — but not the behaviour the chips drive. SPEC §11's tag focus
      dims off-tag stops to 32% across Timeline, Day columns, Calendar and Map,
      with Calendar showing `N of M match` instead. It is the only piece of
      M18 needing shared state above the lens switch, its Calendar rule is a
      second design, and no M18 exit-gate box measured it — the same three
      arguments that carved Playbooks out of M11 the day before. Note for
      whoever opens it: the **filter row it replaced is gone**, and our own
      KI-47 cited it for four days after SPEC §11 deleted it.)*
- [x] **M16 The assistant answers questions** — **gate closed 2026-08-29**
      → `docs/milestones/M16-assistant-read-agent.md`
      *(Ten of eleven boxes ticked and the eleventh moved, not waived:
      **"recorded transcripts replay in CI" went to M9's gate**, by Mitchell's
      explicit decision — it was PR #88's Task 7, dropped rather than
      half-landed, M9's gate already carried the identical criterion, and M9
      is where the write agent it measures lives. **KI-11 stays open and is
      now M9's to close.** Implementation landed in PR #88, which correctly
      flipped no status flag because everything in it ran simulated; the gate
      closed afterwards on Mitchell's live confirmation. One caveat recorded
      in the milestone file rather than smoothed over: Vercel holds exactly
      one real-model `ai.ask` record, and the four acceptance assertions were
      confirmed locally, so Wave 3's box rests on one record plus a human
      pass. Approved 2026-08-25, **ADR-022**. Placed right after M10's Wave-2 gate
      and ahead of M15 — but M15 in fact closed its own gate first (2026-08-26),
      M18 was then scheduled ahead of M16 (2026-08-26), and **M11 was scheduled
      ahead of both on 2026-08-27**. So M16 now runs after M11 and M18.
      Three waves: the sidebar styled to `SPEC.md` §9's docked
      presentation with both `<Preview>` blocks deleted; a **read-only
      tool-using agent** on a new `/ask` endpoint — one question, one answer,
      scoped to the selected day or the whole trip; then analytics on which
      tools get called and how many calls an answer costs. The existing command
      path is untouched. It exists because `/ai` derives its reply from
      committed commands and the envelope carries no time windows, so a question
      like "where is the most free time" is unanswerable twice over.)*
- [ ] **M17 Account customization** — **re-scoped and placed 2026-08-29, after M18b**
      → `docs/milestones/M17-account-customization.md`
      *(Approved 2026-08-26 out of SPEC §12 and **never scheduled**. It was
      absent from this file entirely until 2026-08-28, which in a file whose
      rule is "first unchecked item = current work" meant an approved milestone
      nobody could see. It is listed here so it is visible, **not** to claim a
      slot: placing it is Mitchell's call. Two facts that call needs — its
      central deliverable, *"a `users` table, and the decision of what it keys
      on"*, was **already decided and shipped by M11 link 1** (ADR-025), leaving
      only the preferences half (name, home airport, account-scope distance
      units via one `kmLabel`, home-time-on-hover, and resolving `who` to a
      display name); and nothing downstream is blocked on it, so it can go
      anywhere. Re-scope it before scheduling it.)*

## Phase 3 — Outward

- [x] **M11 Sharing, invites, and a trip you can hand to someone** —
      **gate closed 2026-08-28**
      → `docs/milestones/M11-sharing-and-invites.md`
      *(**Scheduled 2026-08-27 ahead of M18's remaining surfaces and ahead of
      M16**, by Mitchell's call — the explicit say-so this file's ordering rule
      requires. It **absorbed M13's invites/roles/revocation scope** in the same
      decision; M13 keeps only near-real-time sync and its transport ADR.
      Links 1-6 landed 2026-08-28 via PR #71 with remediation in PR #78
      (users/identity, roles and access, invites, pinned shares,
      clone-with-lineage, saved days); migrations 0006-0010 are dispatched to
      production. **Playbooks/templates — inherited from M7 — was carved out of
      this gate by Mitchell on 2026-08-28 and is its own follow-on**, so the
      four Playbooks `<Preview>` shells stay M11-tagged in
      `preview-registry.ts` with nothing else left in the milestone. Gate
      evidence and retro are in the milestone file.)*
- [ ] **M11b Playbooks / templates** — **approved, unplaced** (not "next").
      The piece carved out of M11's gate.
      *(Carved out 2026-08-28 when M11's gate closed: the milestone's file
      said its Playbooks scope stayed, none of its eight exit-gate boxes tested
      it, and none of the six links touched it. Still shelled and still
      M11-tagged: `home-playbooks-strip`, `playbooks-route`, `insert-playbook`,
      `wizard-playbook-panel` — plus a whole `/playbooks` route rendering mock
      cards. Needs its own scope and exit gate written before it opens; saved
      days (link 6) is the data model it would build on.)*
- [ ] **M12 Community** — all trust & safety scope
      lives here, nowhere earlier.
- [ ] **M13 Collaboration** — realtime transport ADR and concurrent-edit
      conflicts. *(**Narrowed 2026-08-27**: invites, roles and revocation moved
      into M11, because they are the same `AccessPolicy` change as share links
      and opening that boundary twice costs twice.)*
- [ ] **M14 Rich layer** — the macro vocabulary deferred out of M8 returns here.
      *(Also owns the whole Notebook redesign from the 2026-08-23 design sync —
      `.design-sync/handoff/SPEC.md` §7. Opens with a **repeaters ADR**: a loop
      macro with an author-supplied row template is the one genuinely new
      engineering decision that sync created, and every macro today is
      `NoParams`.)*
- [x] **M15 Front door** → `docs/milestones/M15-front-door.md`
      *(Gate closed 2026-08-26, PR #56. **Ran ahead of M10's Phase 9 gate and
      M16**, superseding ADR-021/ADR-022's stated ordering — decision 1 in the
      milestone file, reconciled into `docs/milestones/README.md`'s roadmap
      table and Current milestone in this same gate-close commit. Landing
      page, custom sign-in/sign-up (Google + dev-login), Home's empty-state
      first-run moment via the existing `NewTripWizard`'s "Create empty" (the
      designed one-field first-run screen was dropped, decision 3), and the
      header account menu (already shipped in M10 Phase 8b). Both open
      questions resolved: no separate first-run screen, and the landing copy
      ships verbatim selling M11/M12. M10's Phase 9 gate closed after this, on
      2026-08-27; **M18** is the next work.)*
- [ ] **M9 AI as a planning partner** → `docs/milestones/M9-ai-planning-partner.md`
      *(**Moved to last, after M14 — ADR-022, 2026-08-25.** Mitchell's call: the
      data layer beneath a planning partner should exist first, and UI polish and
      sharing come before it. M16 builds the read half, so M9 adds conversation,
      write tools and approval **to a working agent** and inherits its eval
      harness. Do not start early.)*

## Candidate ideas (unscheduled)

Captured so they aren't lost; not committed to a milestone yet.

- **Drop Travelers from the trip header bar (2026-08-30, Mitchell, on PR #89's
  preview — "Drop Travelers from this bar, its not needed, it can live just in
  the trip settings").** It is a delete, not a move, and smaller than it sounds
  — checked before filing:
  - The control is the avatar stack plus "N travellers" in
    `components/trip/TripMetaPill.tsx:39-58`, beside days / stops / cities.
  - **Its `onClick` is already `onOpenSettings`** — it opens the same
    `SettingsSheet` the trip title does. So the routing Mitchell describes is
    not something to build; the control is a link there already.
  - **Settings already lists members.** `SettingsSheet.tsx:327` has a "Who is
    invited" section whose `TravelersPanel` shows the effective members and, for
    an owner, creates, copies and revokes invite links (M11 link 3). Nothing is
    lost by removing the header display.
  So the work is deleting the `<Button>` and its avatar stack from
  `TripMetaPill`, and its assertions from `TripMetaPill.test.tsx`. Watch the
  divider: each meta item is preceded by a `bg-hairline` spacer, so the one
  before it goes too or the pill ends on a stray rule.
  The one judgement left is what it costs on a **shared** trip: after M11 the
  avatar stack is the only at-a-glance sign that a trip has other people on it.
  On a solo trip it reads "1 travellers" and earns nothing, which is the case
  Mitchell was looking at. Removing it unconditionally is the literal ask;
  hiding it below two members is the smaller-blast-radius alternative.
  Deliberately not done in PR #89 — that PR closed M18's gate, and removing a
  control from a different surface would have made the gate evidence harder to
  read.

- **Timeline: scrolling should move the day chips, the way the map rail
  already does (2026-08-28, Mitchell, walking PR #71's preview — "Add this to
  the future tasks").** The timeline's focus binding is one-way today. A chip
  click scrolls the timeline (`TimelineLens`'s `scrollIntoView` effect on
  `focusedDay`), but nothing reads scroll position back out, so scrolling never
  moves the chips. `MapRail.tsx:186` is the only scroll listener in the app and
  there are no IntersectionObservers at all.
  It reads as a regression because **the behaviour already exists on another
  lens**: the map rail focuses whichever day its focus line is over, through
  the same `onFocus` callback a click uses, and `m10-map-rail.spec.ts`
  ("scrolling tracks focus through every day") pins it. Having it in one place
  and not the other is what makes its absence feel like breakage rather than
  an unbuilt feature.
  Build it by reusing the rail's approach rather than inventing a second one —
  measure the day headers, cache the offsets, refresh with a `ResizeObserver`,
  and pick whichever header is nearest a focus line on each scroll. The rail's
  own comment argues against an IntersectionObserver for two reasons that
  apply here unchanged: a header sitting at ratio 1.0 never re-reports while
  its real position keeps moving, and IO delivers nothing in a backgrounded
  tab — both leave focus on stale data.
  The one thing to get right is the feedback loop: focus-on-scroll must not
  re-trigger the `scrollIntoView` effect, or the view fights the user. The rail
  avoids it by calling `onFocus` only when the resolved day actually changes;
  the timeline additionally needs that effect to skip scrolling when the change
  came *from* scrolling.
  **Raised a second time on 2026-08-30**, on PR #89's preview — "As i scroll
  through the timeline, it should select the day you are passing, and show the
  selection at the top bar to". Same request as the 2026-08-28 one above, now
  with the top-bar half stated explicitly: the day chips should show the
  selection, not just the timeline. Two asks for the same thing in two days is
  the strongest signal on this list that it is worth scheduling.

- **Save light: move Retry out of the mark and into a popover on it
  (2026-08-26, Mitchell, PR #55 — "nice to have, to do later").** SPEC's "The
  logo is the save light" justifies putting trip-scoped save state in an
  account-scope bar on the grounds that it is *status, not an action* — which
  is exactly the exemption `RULES.md` 1 needs. What shipped makes the mark
  itself a Retry **button** while a send has failed, because the design gives
  the failure a colour and no way out of it and this queue only retries when
  asked (KI-36); that keeps `RULES.md` 6's "recover from the worst" but spends
  the very justification SPEC used.
  The better shape, deferred rather than rejected: the mark stays status-only
  and **clicking it opens a small popover** carrying the failure detail and the
  Retry control. The top bar then holds status, the action sits one level in,
  and rule 1 is clean again. It also gives the failure message and
  `failure.at` timestamp somewhere to live — today nothing renders either, and
  `SaveLight.tsx` documents why it will not fake a relative "(since …)" without
  a ticking clock.
  Not free: a popover on the logo is a new interaction on the one element
  present on every route, so it needs its own dismiss/focus behaviour and a
  decision about whether it opens at rest (probably not — there is nothing to
  say when everything is saved).

- **Design-sync items with no milestone yet (2026-08-23).** From
  `docs/design-feedback/2026-08-23-design-sync-review.md`, which writes each one
  up in full. Decided items are struck through with where they went:
  - **`TripSummary.startDate`** — one field, so home's "next trip" is real
    rather than `visibleTrips[0]`. The data already exists on
    `TripDetail.startDate`; only the summaries read model lacks it. Per
    `AGENTS.md` a contract change is its own reviewed step, so it goes **before**
    M10 Phase 8's home-hero task, not inside it. **This subsumes the "Trip list
    row: richer, human-readable metadata" idea below** — that item wants exactly
    this field.
  - ~~**Start-only trip dates**~~ — **DECIDED 2026-08-23, landed 2026-08-24.**
    The end is always start + day count; there is no end-date input anywhere.
    Shipped as **Task 8b.6** of M10 Wave 2 — its plan file was deleted at the
    gate close per `docs/plans/README.md`; the durable record is
    `docs/milestones/M10-visual-craft.md`'s Wave-2 retro. Phase 7's wizard
    already matched (its length chips predate this task). It turned out to be UI-only: `endDate` is stored nowhere — not on
    `TripState`, not on `TripDetail` — and `TripHeader.tsx:228` already
    derives it from the plan's last day, so no contract, command or domain
    change was involved. **This also closed the "trip end-date picker may
    drift from the day count" item that used to sit below** (removed from
    Candidate ideas by this task): not stored-field drift, but a derived
    value presented in an editable field.
  - **Design coverage the build is still owed** — History beyond the popover,
    `MapRail`, trip lifecycle (delete → undo → restore, duplicate), and
    error/empty states for the new landing, auth and first-run screens. Design
    work, not build work. (The three undesigned extra lenses this used to name
    alongside them — Itinerary, Daily overview, Full trip — are gone: **KI-20**
    was closed by retiring them, not by designing a home for them.)

- **M8 Wave C/D trim: quick-add, search-to-add button, move-via-menu,
  first-run state, empty states (Mitchell, 2026-08-07).** Deferred out of M8
  rather than done reflexively, once Wave A merged. None of these close a
  capability gap: an activity — including one with a real geocoded place —
  can already be added via the existing `+ Add activity` editor
  (`ActivityEditor.tsx`/`LocationInput.tsx`), and reordering already works by
  dragging. What's deferred is speed (a faster input, a dedicated search
  button, a menu instead of a drag) and presentation (first-run/empty-state
  copy and layout) — genuine ergonomics and polish, but not blockers against
  the Phase 1 gate, and exactly the surface a separate, already-underway
  design-tool brainstorm for the product's future look and feel is likely to
  reshape. Building it now risks the "redone twice" cost M5's own Wave 1
  re-skin already paid once when the layout moved underneath it — the same
  argument M10's own scope doc makes about not polishing a structure that is
  still moving, applied here to interaction/ergonomics work instead of visual
  polish. **Kept, not deferred:** the KI-5 visible-sync-state indicator
  (correctness/trust, not ergonomics — doesn't depend on quick-add existing)
  and the M8 e2e gate script, resized to exercise the existing
  add-activity/drag-and-drop flow. Full reasoning in
  `docs/milestones/M8-make-it-real.md`'s "Scope trim" section — the original
  step-by-step plan (`docs/plans/2026-07-28-M8-make-it-real.md`, including
  the deferred C1–C3/D1–D2 task write-ups) was deleted at M8's gate close
  per `docs/plans/README.md`'s staging-area rule. Revisit once M10's
  direction is set — these are exactly the kind of task that direction
  should inform, not the reverse.

- **Trip list row: richer, human-readable metadata (Mitchell, 2026-08-01, from
  M8 dogfooding).** The "Your trips" list currently shows each row's
  `createdAt` as a raw ISO timestamp (`2026-08-01 23:52:35.026+00`) — should be
  human-readable, and more useful than the creation date anyway: start date,
  trip length (day count), and cost are all already on `TripSummary`/derivable
  from `TripDetail` and would tell the user more at a glance than when the row
  was created.

- **Duplicate and the undo-toast's Restore: no optimistic update yet (Mitchell,
  2026-08-01, from M8 dogfooding).** Delete's optimism (page.tsx's
  `deletingIds` filter-set, M8/A15 follow-up) and the rename/date/budget
  optimism fix (TripHeader reading `activeTrip` instead of `trip`) both landed
  as small, well-scoped fixes. Duplicate (network round-trip before the
  redirect fires) and Undo (`page.tsx`'s `undoDelete` does a full `load()`
  refetch rather than re-inserting the row locally) are lower-value/more work
  for now — deferred rather than done reflexively.

- **Expose geocoding as a model tool — now scoped into M9 as "Grounding"
  (`SearchPlaces` + `placeRef`).** Filed 2026-08-01 (Mitchell, M8 dogfooding)
  as the deferred half of the geocoding work: server-side auto-geocode was
  landing as the fix for the model guessing `Location.lat/lng` (observed:
  `lat: 0, lng: 0`), and giving the model a tool to *disambiguate candidates
  itself* was held back as more steps/tokens for cases "auto-geocode's 'take
  the top match' can't — e.g. two same-named places in different cities the
  model needs to pick between using trip context."
  **The 2026-08-02 dogfood run hit that exact case and the deferral proved
  wrong.** "The Red Coach Inn" top-matched to a coaching inn in Shropshire,
  England and overwrote coordinates the model had gotten right; seven more
  lookups were silently dropped by a rate limit (KI-15). Auto-geocode is not
  a weaker version of the tool — it is strictly worse than doing nothing when
  it is confidently wrong, because it launders a guess into a stored fact.
  Kept here only as the record of why it was deferred and what killed the
  deferral; the live scope is M9.

- **Contained activities: a meal inside a day-long activity is not a conflict
  (Mitchell, 2026-08-02, from M8 dogfooding).** Every day of the Rochester run
  raised a `time-overlap` warn, all three the same shape: a long anchor
  activity (Niagara Falls 09:00–16:00, the Strong Museum 10:00–16:00) and a
  lunch sitting *inside* it. The AI was not wrong — you *do* eat lunch during
  a museum day — and the user's reading was "we might want a feature for when
  the lunch is at the event." So this is not a prompt fix: telling the model
  the conflict rules would only teach it to stop scheduling lunch, which is
  worse. **The domain models overlap but has no notion of containment.**
  Directions to weigh in a brainstorm, not yet decided: (a) real nested/child
  activities in `packages/domain`; (b) a span/kind distinction so a long
  activity is a *container* rather than a peer; (c) leave the model alone and
  refine the rule in `conflicts.ts` — suppress `time-overlap` when one window
  fully contains the other and the inner one is short; (d) do nothing and let
  dismissal absorb it (status quo — but three warns on a three-day trip is
  the AI teaching users to ignore the conflict UI, which is the real cost).
  Note (c) is the cheapest and (a) is the most honest; the choice depends on
  whether containment ever needs to mean anything beyond silencing a warn.
  Deliberately kept out of M9 — it is a `packages/domain` contract question
  with conflict-detector consequences and deserves its own design pass.

- **AI "Preview" before apply — now scoped into M9.** Kept here only for the
  two implementation directions it records, which M9's design spec has to choose
  between (Mitchell, 2026-07-25): (a) lean on the event-sourcing/history
  substrate — a single pending "future" branch the user reviews and approves (or
  discards) to fast-forward into the real log; or (b) an intermediate, validated
  model of the proposed batch surfaced to the frontend for approval before it is
  applied. Becomes more valuable again at M13, where multiple actors make
  "propose then approve" a collaboration primitive rather than just an undo
  affordance.

- **AI cost/quality tuning — "best model for my buck" (Mitchell, 2026-07-25).**
  **Thread (1), prompt trimming, was measured on 2026-07-27 and is NOT worth
  doing.** The per-round-trip payload is small: context envelope ~623 tokens for
  a 7-day/21-activity trip (board surface; 858 for `combined`), derived planning
  tool schemas ~816 tokens, system rules ~450 — about **1,900 tokens per model
  round-trip**. The live run that recorded ~33.5k input tokens was therefore
  ~18 round-trips, not a fat prompt: the cost was **step count**, which the
  2026-07-26 step-budget fix already addressed (system prompt now tells the
  model to emit every call in one message; typical runs should be 1–3 steps).
  Trimming `context.ts` would save tens of tokens per step and cost legibility.
  **Watch `meta.steps` instead — that is the cost driver, and it is already
  instrumented.**
  **Thread (2), the model harness, still stands and is the valuable half:**
  build a small harness that runs a fixed set of representative prompts (e.g.
  "plan a N-day trip", "move X to day 2", "add lunch on day 3") against several
  gateway models and records, per model, the `meta` we already emit
  (input/output tokens, steps, durationMs) alongside a quality score (did the
  batch apply? correct day placement? no dropped/duplicate commands?). Goal:
  pick the cheapest model that clears a quality bar. Weak models loop and
  over-generate; the harness makes that measurable instead of anecdotal. This
  doubles as the fix for KI-11 (no test ever calls a real model).

- **Unscheduled rack: drag support is Board-view-only (2026-08-23, manual QA
  on PR #26's preview deploy).** **The drawer now follows this, not the other
  way round (2026-08-26, Mitchell, PR #55):** it renders only where a stop can
  actually be dropped, so closing any of the four gaps below brings the drawer
  back to that lens. The gate is `board/lensAcceptsDrops.ts` — one function,
  deliberately not a lens list, so "the drawer is here" and "you can drop here"
  cannot drift apart. Phase 3 wired `dropTargetForElements` for the
  rack's own drop zone, `Column.tsx`'s day columns, and each `ActivityCard` —
  all inside the Board (day-columns) lens. Nothing under
  `apps/web/src/components/lenses/` registers a drop target, so dragging a
  stop out of the rack does nothing in Calendar or Timeline view even though
  the rack itself is visible there too (it's mounted once, outside the lens
  switch, on purpose — see `TripBoardScreen.tsx`'s own comment). Four related
  gaps, captured together since they're all this same rack/lens boundary:
  1. Drag-from-rack onto a day in Calendar view — no drop target exists.
  2. Drag-from-rack onto Timeline view — no drop target exists.
  3. Whether the drawer should stay mounted across every lens (current,
     deliberate behavior) or collapse/hide itself on a view change is worth
     revisiting now that dragging into it only actually works from Board —
     showing it everywhere reads as "this works here" in views where it
     doesn't. **Decided (Mitchell, preview review, 2026-08-25):** hide it on
     Map only — Map is the one lens where the rack is a `position: fixed`
     overlay over a full-bleed canvas with nothing under it. Timeline and
     Calendar keep it mounted, because unlike Map they have a working
     non-drag path (the day-assign `NativeSelect` → real `MoveActivity`/
     `UpdateActivity`), so hiding it there would remove a capability, not
     just a misleading affordance.
  4. The drawer is `position: fixed; bottom: 0` (`globals.css`) with no
     clearance reserved in any lens's own content — unlike the assistant
     rail, which gets `.trip-board-content`'s right-padding reservation, no
     lens pads its bottom for the drawer. In Timeline (day list) and Calendar
     (month grid), real content can end up sitting underneath it near the
     bottom of the viewport instead of alongside it.
  5. (2026-08-24, Phase 8b cell rebuild) `CalendarLens.tsx`'s day cards and
     stop chips are now built to the design's drag affordance (dc.html:670-
     672's 6-dot grip, `cursor: grab` on both the grip and each chip) but
     are not draggable — `cursor: grab` was deliberately withheld so the UI
     never promises a drag it can't perform (the same failure mode gap 1-2
     already describe). Wiring them needs a drop target registered in the
     calendar lens itself (nothing under `apps/web/src/components/lenses/`
     does today, per the gap above) and reuses `MoveActivity`, the same
     command Board's `ActivityCard` drag already dispatches.

## Deferred work with a resume condition that has already fired

Not a milestone, and not a candidate idea — work that was consciously paused
behind a named trigger, where the trigger has since happened. Listed here
because the only thing that recorded it was a paragraph in `docs/STATUS.md`
marked "history", so nothing live surfaced it and nobody resumed.

- **Test-suite overhaul, Phases 5-7** (`docs/plans/2026-08-23-test-suite-overhaul.md`
  and `docs/plans/test-overhaul/phase-5-prune.md`, `-6-debrittle.md`,
  `-7-guidelines.md`). Phases 0-4 landed 2026-08-23; 5-7 were gated on **M10
  Wave 2's gate closing**, because Wave 2 Phases 5-8 were about to rewrite eight
  of the components whose tests Phase 5 would otherwise prune or rewrite twice.
  **That gate closed 2026-08-27 and nothing resumed.** Measured 2026-08-28: the
  web unit suite is **111 files / 894 tests** against the overhaul's own
  baseline of 95 / 569 — +16 files, +325 tests, +4,603 test LOC, and an
  `environment` cost now *worse* than the number the overhaul was launched to
  fix. `TimelineLens.test.tsx`, flagged then as the canonical brittleness case,
  grew 15 → 41 tests.
  **Re-run the Phase 0 inventory first**, as the plan itself requires — the
  current `docs/testing-inventory.md` predates Wave 2 Phases 5-8 and does not
  know about the tests they added. Its own PR, not a remediation-wave task.

## Standing tasks (every milestone)

- **Preflight (kickoff):** before the milestone's first task, reconcile the
  *previous* milestone's gate-close checklist (`docs/milestones/README.md`) — if
  any flag is unflipped, flip it first. This is the forcing function that catches
  a missed gate-close. Also check for sibling `claude/*` branches on the
  *current* milestone (`git branch -a`, `git ls-remote --heads origin`) that
  might be finished-but-unmerged before starting more independent work on top —
  see `AGENTS.md`'s Workstreams section for why this matters and what it cost
  once already (M10 Wave 2 Phase 3 sat unmerged and diverged while Phase 4 was
  built and merged independently, 2026-08-22).
- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- **At gate time, run the gate-close checklist** in `docs/milestones/README.md`
  (tick here, check the milestone file's exit-gate boxes, append the retro, bump
  Current milestone, update `docs/STATUS.md`, and remove the milestone's plan
  from `docs/plans/` after promoting anything durable out of it) — all in one
  commit, never a trailing manual step.
- Record any irreversible decision as an ADR before acting on it.
