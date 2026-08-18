# Phase 9 — Gate close

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first.
>
> **Every other phase must be merged before this one.**

**Goal:** close M10's Wave-2 gate honestly, and leave the repo's status documents
telling the truth.

**Read `docs/milestones/README.md`'s "Gate-close checklist" before starting.** It
requires every status flag to flip in **one commit** — that rule exists because
M2 once stayed unticked for weeks.

---

## Task 9.1: Close the gate

- [ ] **Step 1: Add the narrow-viewport e2e project — this is a gate condition**

This is the single most important item in the phase. Wave 1's gate passed 11/11
while the trip page was completely inert below 1180px, because
`apps/web/playwright.config.ts` sets `use: { baseURL }` and **no `viewport`**, so
every spec ran at Playwright's 1280×720 default — above the 1179px breakpoint
where the blocking scrim turns on. That is **KI-19**.

Add a second project so the suite exercises both sides of the breakpoint:

```ts
projects: [
  { name: "desktop", use: { viewport: { width: 1280, height: 720 } } },
  { name: "narrow",  use: { viewport: { width: 1100, height: 800 } } },
],
```

Then add a spec that would have caught the original bug — it must **fail** on a
tree without Phase 0:

```ts
test("the trip page is usable below the assistant rail's overlay breakpoint", async ({ page }) => {
  await signInAsDevUser(page);            // e2e/helpers.ts
  await openSeededTrip(page);

  await page.getByRole("tab", { name: "Day columns" }).click();
  await expect(page.getByTestId("day-column").first()).toBeVisible();

  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByTestId("timeline-lens")).toBeVisible();
});
```

**Verify it is a real guard:** stash Phase 0's `AssistantRail.tsx` change, run the
spec in the `narrow` project, and confirm it fails. A gate test that passes on
the broken code is worthless. Restore, confirm it passes.

Then move **KI-19** to Resolved in `docs/known-issues.md`.

- [ ] **Step 2: Run the full Definition of Done**

```bash
pnpm typecheck
pnpm lint                      # root, NOT `pnpm --filter web lint` — see below
pnpm --filter web test
pnpm --filter web test:int     # needs real Postgres
node scripts/check-color-wall.mjs
```

**Use root `pnpm lint`.** The Wave-1 retro records that `pnpm --filter web lint`
runs only ESLint and skips the colour-wall script entirely, which let real
arbitrary-value violations through four already-reviewed tasks.

- [ ] **Step 3: Run e2e against a production build, twice**

```bash
pnpm build && pnpm start &
pnpm --filter web test:e2e
pnpm --filter web test:e2e
```

Against a **production build**, not dev-mode Turbopack — the M8 retro records
that Turbopack's cold-compile delay on first navigation reads as a real failure.
Twice, to catch order-dependent flake.

If a spec fails, **do not assume it is pre-existing.** The Wave-1 retro records a
subagent confidently reporting a real regression as "confirmed pre-existing on an
unmodified baseline"; independently re-running against real `main` showed it
passing. Verify that claim yourself before letting it close a gate.

- [ ] **Step 4: Walk every surface at three widths**

At **1280**, **1100** and **820** px, with the assistant rail both shown and
hidden, walk Timeline, Day columns, Calendar and Map plus the home and Playbooks
routes. Confirm nothing is covered, nothing is inert, and the unscheduled rack
clears the assistant pill in every combination.

- [ ] **Step 5: Confirm the exit gate in the milestone file**

Tick each box in `docs/milestones/M10-visual-craft.md`'s **"Wave 2 exit gate"**
section, with evidence — not from memory.

- [ ] **Step 6: Append the Wave-2 retro**

Append to `docs/milestones/M10-visual-craft.md`, below the Wave-2 gate. Cover at
minimum:

- What shipped, and what stayed behind a `<Preview>` and why.
- **How much of the design turned out to be already modelled** — cost, budget,
  backlog, conflicts, coordinates. The delta shrank substantially once the
  contracts were read rather than assumed. Worth recording as a habit: read the
  contracts before estimating a design's data cost.
- The viewport gap (KI-19) and what the new `narrow` project now guards.
- Whether Task 1.3's header-height change fixed the drag-and-drop root cause
  `Board.tsx:83-103` describes — and if so, whether
  `autoScrollWindowForElements()` is still earning its place.
- Anything found late that per-task review could not see.

- [ ] **Step 7: Flip every status flag in ONE commit**

Per `docs/milestones/README.md`'s gate-close checklist:

1. `TODO.md` — tick **M10 Visual craft pass**; unblock M9.
2. `docs/milestones/M10-visual-craft.md` — every Wave-2 gate box ticked, retro appended.
3. `docs/milestones/README.md` — M10's row back to done; **Current milestone → M9**.
4. `docs/STATUS.md` — "Where we are" and "In flight" rewritten to M9.
5. `docs/known-issues.md` — KI-16, KI-17, KI-18, KI-19 all moved to Resolved;
   the deliberate gaps (unreachable lenses, unmodelled fields, `TripSummary` with
   no start date, no area field) left **Open** with their reasons.
6. **Delete `docs/plans/2026-08-14-M10-redesign-delta.md` and all of
   `docs/plans/M10-delta/`** — same commit. `docs/plans/README.md`: plans are
   staging-area scaffolding, and anything worth keeping is promoted to an ADR, a
   milestone note or a known issue *before* the plan goes. Check you have
   promoted everything you care about first.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(M10): close the Wave-2 redesign-delta gate

Every surface matched to design_handoff_update/current/, or behind a registered
<Preview>. Adds a narrow-viewport e2e project so the 1180px breakpoint is
covered (closes KI-19, the gap that let Wave 1's gate pass while the trip page
was inert below 1180px). Closes KI-16, KI-17, KI-18."
```

---

## Phase 9 exit checklist

- [ ] A `narrow` (sub-1180px) e2e project exists and its guard spec **fails**
      without Phase 0 — verified, not assumed.
- [ ] typecheck / root lint / unit / int / colour wall all green.
- [ ] Full e2e green against a production build, twice.
- [ ] All four views walked at 1280, 1100 and 820px, rail shown and hidden.
- [ ] Wave-2 retro appended.
- [ ] All five status documents flipped in one commit, with the plan files deleted
      in that same commit.
