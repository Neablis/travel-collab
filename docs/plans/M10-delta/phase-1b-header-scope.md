# Phase 1b — the header learns what you are looking at

> **STATUS: CANCELLED 2026-08-26 (Mitchell). Never built — no code from this
> plan exists.** The header keeps no trip-scoped actions: *"top bar is for
> functionality larger than a trip, and the elements below the top bar are trip
> scoped actions"*, and on the header's Quick add, *"Only 'Add stop' where it is
> now"*. That reverts to `AppHeader.tsx:6-9`'s original Phase 1 decision and to
> `DRIFT.md` D3, both of which this plan was written to override. `SPEC.md` §1's
> focus-scope model is rejected as a whole — see
> `docs/design-feedback/2026-08-23-design-sync-review.md` §1. The gate-scope
> narrowing is recorded in `docs/milestones/M10-visual-craft.md`.
>
> **Two claims below are factually wrong about the code as it stands**, found
> while scoping the phase and left visible here rather than deleted, so a future
> reader does not rediscover them:
>
> 1. *"`FocusProvider` already distinguishes these"* (ring vs. scope) — it does
>    not. `components/trip/context/FocusProvider.tsx` holds exactly one field,
>    `focusedDay: number | null`. Task 1b.4 would have had to build the scope
>    state, not read it.
> 2. *"`MapRail` already has this pattern as `_railLock`"* — there is no
>    `_railLock` anywhere in the repo (`grep -rn railLock` is empty).
>    `MapRail.tsx:143-175` has a leading+trailing scroll **throttle**,
>    explicitly documented as *not* a settle-debounce; a throttle cannot
>    distinguish a programmatic scroll from a user scroll, so it could not have
>    served as the 900ms lock. That lock would have been written from scratch.
>
> One fragment was checked for salvage and **deliberately not adopted**: §1's
> rule that Calendar drops day scope and hides the unscheduled rack.
> `TripBoardScreen.tsx:409-414` gates the rack on `lens !== "Map"` for a
> documented reason — its day-assign `NativeSelect` is a real scheduling path in
> Timeline and Calendar. Hiding it would delete working functionality.
>
> Original approval record follows.
>
> **STATUS: APPROVED 2026-08-23 (Mitchell).** An explicit revisit of the merged
> Phase 1, adopting `.design-sync/handoff/SPEC.md` §1's focus-scope model. This
> is a gate-scope amendment to M10, recorded in
> `docs/milestones/M10-visual-craft.md`.
>
> **Order: after Phase 7 and Phase 8b, before Phase 9's gate.** It depends on
> Phase 7's add-stop sheet (Quick add needs something to open) and on Phase 8b's
> `AccountMenu` (which this phase absorbs).

Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first; its Global
Constraints apply verbatim. Design source of truth:
`.design-sync/handoff/design/Trip Planner Redesign.dc.html`, companion spec
`.design-sync/handoff/SPEC.md` §1.

---

## Why this is a revisit and not a bug fix

`AppHeader.tsx:3-7` carries a decision written when Phase 1 shipped:

> *Deliberately a server component with no trip context — it must not force
> `layout.tsx` client-side. The prototype's "Quick add" is omitted: it needs a
> trip to add to, so it belongs on the trip surface, not here.*

That was a good decision against the information available. `SPEC.md` §1 arrived
afterwards and supplies the thing it was missing: a **model**, not a button
placement. There is exactly one focus scope at a time — **account → trip → day**
— and it decides what the global header, the trip header and the assistant each
show.

| scope | when | global header shows |
|---|---|---|
| account | trips list, Playbooks | `New trip`, avatar |
| trip | inside a trip, no day selected | `Share`, `Quick add`, avatar |
| day | inside a trip, a day explicitly selected | same as trip |

Note `DRIFT.md` D3 says "Code is right to omit Quick add" while the DC and
`SPEC.md` §1 both place it in the header — **the bundle disagrees with itself.**
Mitchell's call is §1. Build §1.

Rules from §1 that are not about buttons, and that this phase must not lose:

- **Trip actions never appear outside a trip.** No Share, no Quick add on the trips list.
- **Day scope is entered explicitly** (a day chip, a calendar cell, a map-rail row) and **left by scrolling**. A programmatic scroll caused by the selection itself must not clear it — the design locks for 900ms, and `MapRail` already has this pattern as `_railLock`. Reuse it; do not write a second one.
- **Calendar and Map are trip-scope views by definition.** Entering one drops day scope and hides the day-chips row and the unscheduled rack.
- **The day-chip ring is not scope.** It marks the day most central to the screen and follows scroll. Scope says what you are acting on; the ring says where you are. Keep them separate — `FocusProvider` already distinguishes these, so read it before adding any state.

---

## The architectural question, and the recommended answer

Making the header trip-aware must not client-ify the root layout. Three ways:

| option | cost |
|---|---|
| **A. Header slot + portal (recommended)** | `AppHeader` stays a server component in the root layout and renders an empty, client `HeaderActions` slot. The trip screen — already a client component — portals its scope-appropriate actions into it. One client boundary, no layout change, and the trip screen keeps owning the actions that need its data |
| B. Nested layout | `app/trips/[tripId]/layout.tsx` renders its own header variant. Duplicates the bar, so the wordmark and nav exist twice and can drift |
| C. Client `AppHeader` | Simplest to write, and exactly what the Phase 1 comment refused: forces `layout.tsx` client-side and drags the whole tree's server-rendering benefit with it |

**Take A.** It is the only one that satisfies §1 without reversing the *reason*
behind the Phase 1 decision — the header stays a server component; only a small
island inside it is client.

**Absorb Phase 8b's `AccountMenu` into that island** rather than leaving two
independent client boundaries in one bar. 8b builds it context-free precisely so
this can happen without a rewrite.

---

## What each action actually is today

Check these before writing anything — two of the three already exist and must be
**moved**, not rebuilt:

- **Share** — `apps/web/src/components/trip/ShareButton.tsx`, already wrapped in `<Preview id="share-button">` (M11). **Move it** from `TripHeader` to the header slot. Do not un-Preview it: unauthenticated read of a trip is M11's work.
- **New trip** — exists on `app/page.tsx`. In account scope the header's `New trip` should open the same thing, not a second dialog. After Phase 7 that is `NewTripWizard`.
- **Quick add** — does not exist. It opens Phase 7 Task 7.1's add-stop sheet, scoped to the focused day when there is one. **This phase is blocked on Phase 7** for exactly this.

---

## Task 1b.1: A header slot the trip screen can fill

**Files:** `apps/web/src/components/AppHeader.tsx`, new
`apps/web/src/components/HeaderActions.tsx` + test, `TripBoardScreen.tsx`.

- [ ] **Step 1** — read `AppHeader.tsx`, `FocusProvider.tsx` and `TripBoardScreen.tsx` before designing the slot. Do not add a second source of "what is focused".
- [ ] **Step 2** — failing test: the header renders nothing extra on the trips list, and renders the trip actions when a trip screen fills the slot.
- [ ] **Step 3** — implement option A. `AppHeader` stays a server component; delete or amend its Phase 1 comment so it records the *new* decision rather than contradicting the code.
- [ ] **Step 4** — `pnpm typecheck && pnpm lint && pnpm --filter web test`; commit `refactor(web): a header slot the focused surface can fill`.

## Task 1b.2: Share and Quick add move into trip scope

**Files:** `TripHeader.tsx` + test, `ShareButton.tsx` (move only), the add-stop
sheet from Phase 7, `HeaderActions.tsx` + test.

- [ ] **Step 1** — failing tests: Share and Quick add appear in the header inside a trip and **not** on the trips list; Quick add opens the add-stop sheet; Share is still inside its `share-button` Preview region.
- [ ] **Step 2** — run, confirm they fail.
- [ ] **Step 3** — move Share out of `TripHeader`. Check what `TripHeader`'s action cluster looks like with it gone (`TripHeader.tsx:155` comments the cluster as ghost "Share" · primary "Add stop") — if "Add stop" and header "Quick add" now duplicate each other, say so and pick one rather than shipping both.
- [ ] **Step 4** — update `TripHeader.test.tsx:294`, which asserts Share is inert inside the Preview; commit `feat(web): trip actions live in the header, in trip scope only`.

## Task 1b.3: Absorb the account menu

- [ ] Fold Phase 8b's `AccountMenu` into `HeaderActions` so one client island owns the whole right-hand cluster. Behaviour unchanged; tests should need no rewrite beyond their mount point.
- [ ] Keep `SPEC.md` §5's stable-element-identity rule for the `Popover` trigger (`docs/guidelines/design-system.md`) — it hard-locks the main thread when violated.
- [ ] Commit `refactor(web): one client island for the header's right-hand cluster`.

## Task 1b.4: Scope transitions

- [ ] **Step 1** — failing tests: entering Calendar or Map drops day scope and hides the day-chips row and the rack; a day chip enters day scope; a user scroll leaves it; a *programmatic* scroll caused by the selection does not.
- [ ] **Step 2** — implement, reusing `MapRail`'s existing `_railLock` (900ms) rather than writing a second lock.
- [ ] **Step 3** — verify by hand at a narrow width too; the responsive e2e project (`e2e/responsive.spec.ts`) exists because a header/scrim regression was invisible at 1280px.
- [ ] **Step 4** — commit `feat(web): one focus scope — account, trip, day`.

---

## Phase 1b exit checklist

- [ ] `AppHeader` is still a server component and `layout.tsx` is still a server component.
- [ ] Share and Quick add appear only inside a trip; neither is reachable from the trips list or Playbooks.
- [ ] Share is still `<Preview id="share-button">` — no unauthenticated trip read was built to satisfy it.
- [ ] Quick add opens Phase 7's add-stop sheet, scoped to the focused day when there is one; `TripHeader` does not also offer a duplicate of it.
- [ ] One client island owns the header's right-hand cluster, account menu included.
- [ ] Day scope enters explicitly, leaves on a real scroll, survives a programmatic one, and is dropped by Calendar and Map.
- [ ] The day-chip ring still tracks the most central day and is not wired to scope.
- [ ] `AppHeader.tsx`'s comment records the current decision, not the superseded one.
- [ ] `pnpm typecheck && pnpm lint`, unit, int and full e2e green against a **production** build with `CI=true` (KI-27), including the narrow-viewport project.
