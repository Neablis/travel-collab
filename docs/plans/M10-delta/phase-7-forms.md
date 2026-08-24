# Phase 7 — Add-stop and new-trip

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first.
>
> **Phases 0, 1 and 3 must be merged** — the add-stop sheet uses `fitIntoDay`
> from Phase 3 for its availability note, and depends on Phase 0's z-index fix to
> be usable at all next to the assistant rail.

**Goal:** the two forms the design specifies in detail — "Add a stop" and the
4-step new-trip wizard — match it, with every field either really wired or
marked incomplete.

---

## Task 7.1: The add-stop sheet

Today this is the pre-M10 `ActivityEditor` inside a `Sheet`, titled "New
activity", with a `Card` nested inside the sheet (a double surface), fields
*Activity title / Start time / End time / Place name / Cost / Notes*, and
*Save* / *Cancel*.

**Design (`current/…dc.html:1030-1090`), in order:**

1. `FormField` **"What or where"**, description
   *"Type a place and we fill in the address, hours and travel time."*, `Input`
   placeholder *"e.g. Dinner at Kikunoi Roan"*.
2. A suggested-matches list — a hairline-bordered, `8px`-radius list of buttons,
   each a 24px `--color-moss` `6px`-radius kind chip, a 14px ink name and a 12px
   slate detail.
3. A 3-up grid (`grid-template-columns: 1fr 1fr 1fr; gap: 10px`):
   **Day** (`NativeSelect` of every day) · **Start** (`Input type="time"`) ·
   **How long** (`NativeSelect`: `30 min`, `1 hour`, `1.5 hours`, `2 hours`,
   `Half day`).
4. A `Banner variant="success"` carrying the slot-availability note.
5. `FormField` **"Cost"**, description *"Rough is fine. It counts against the
   trip budget as an estimate until you confirm."*, `Input` placeholder
   *"e.g. 120"*.
6. **"Who is in"** — 12px slate label, then crew chips (22px moss avatar +
   name, hairline border, 999px radius).
7. `FormField` **"Notes"**, hint *"Confirmation numbers, what to order, who to
   ask for."*, `Textarea rows={3}` placeholder *"Optional"*.
8. Footer: a hairline top border, 12px slate
   *"Booked? Attach a confirmation after saving."* on the left, then ghost
   **Cancel** and primary **Add stop**.

Sheet title: **"Add a stop"** (edit mode keeps "Edit activity").

**Real vs Preview:**

| field | verdict |
|---|---|
| What or where | **real** — `title`, plus the existing `LocationInput` for the place |
| Day | **real** — `AddActivity` takes `dayId` |
| Start + How long | **real** — arithmetic into the existing `timeWindow` |
| Slot-availability banner | **real** — computed from the day's windows via `fitIntoDay` |
| Cost | **real** — `ActivityView.cost`, via the existing `MoneyInput` |
| Notes | **real** |
| Suggested matches | **Preview** — M9 grounding; nothing generates them |
| Who is in | **Preview** — no per-stop attribution field exists |

**Duration → `timeWindow`.** `Half day` is 4 hours. Compute
`end = toTimeString(toMinutes(start) + minutes)` using `lib/time.ts` (Phase 3).
Keep an explicit end-time input **only** in edit mode, where a stop already has
one and forcing it back through a duration dropdown would lose precision.

**Files:**
- Modify: `apps/web/src/components/trip/editor/ActivityEditorSheet.tsx`
- Modify: `apps/web/src/components/board/ActivityEditor.tsx` + test
- Modify: `apps/web/src/lib/preview-registry.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
it("is titled Add a stop in create mode", () => {
  renderEditorSheet({ mode: "create" });
  expect(screen.getByRole("heading", { name: "Add a stop" })).toBeTruthy();
});

it("offers day, start and duration rather than two raw times", () => {
  renderEditorSheet({ mode: "create" });

  expect(screen.getByLabelText("Day")).toBeTruthy();
  expect(screen.getByLabelText("Start")).toBeTruthy();
  expect(screen.getByLabelText("How long")).toBeTruthy();
  expect(screen.queryByLabelText("End time")).toBeNull();
});

it("derives the time window from start plus duration", async () => {
  const dispatch = renderEditorSheet({ mode: "create" });

  await userEvent.type(screen.getByLabelText("What or where"), "Dinner at Gonpachi");
  await userEvent.selectOptions(screen.getByLabelText("Day"), "day-1");
  await userEvent.type(screen.getByLabelText("Start"), "19:00");
  await userEvent.selectOptions(screen.getByLabelText("How long"), "1.5 hours");
  await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: "AddActivity",
    dayId: "day-1",
    title: "Dinner at Gonpachi",
    timeWindow: { start: "19:00", end: "20:30" },
  }));
});

it("treats Half day as four hours", async () => {
  const dispatch = renderEditorSheet({ mode: "create" });
  await userEvent.type(screen.getByLabelText("What or where"), "Museum");
  await userEvent.type(screen.getByLabelText("Start"), "09:00");
  await userEvent.selectOptions(screen.getByLabelText("How long"), "Half day");
  await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    timeWindow: { start: "09:00", end: "13:00" },
  }));
});

it("keeps an explicit end time in edit mode", () => {
  renderEditorSheet({ mode: "edit" });
  expect(screen.getByLabelText("End time")).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

**Unwrap the `Card`** — `ActivityEditorSheet.tsx:111` renders `ActivityEditor`,
which wraps its form in `<Card as="div" className="rounded-lg p-4">`
(`ActivityEditor.tsx:63`). A card inside a sheet is a double surface the design
does not have. Remove the `Card`; the `Sheet` is the surface.

Replace the paper "day note" block (`ActivityEditorSheet.tsx:98-110`) with the
design's `Banner variant="success"` availability note, computed from the target
day's existing windows.

Wrap the suggested-matches list and the "Who is in" chips each in their own
`<Preview size="container">` and register both:

```ts
  'add-stop-suggestions': { milestone: 'M9',  wiredUpBy: 'Grounded place search — nothing generates matches yet' },
  'add-stop-who':         { milestone: 'M13', wiredUpBy: 'Per-stop attribution — no field records who a stop is for' },
```

Match the registry's existing value shape exactly.

- [ ] **Step 4: Run tests; verify in the browser**

At 1280px with the rail open, the whole sheet must be visible and usable
(Phase 0 Task 0.2). Add a stop with a day, a start and a duration; confirm it
lands on the right day with the right window.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/trip/editor/ActivityEditorSheet.tsx apps/web/src/components/board/ActivityEditor.tsx apps/web/src/components/board/ActivityEditor.test.tsx apps/web/src/lib/preview-registry.ts
git commit -m "feat(web): rebuild the add-stop sheet to the redesign"
```

---

## Task 7.2: The new-trip wizard

**Decision (Mitchell, 2026-08-14):** keep `CreateTrip` at one field, build all
four steps, wire every field the data model already supports and mark the rest.

**Commands that already exist** (`packages/contracts/src/trip.ts`):

| command | line | use |
|---|---|---|
| `CreateTrip` | — | carries **only** a name |
| `SetTripName` | 64 | rename |
| `SetTripDates` | 82 | **step 2 is real** |
| `SetTripCurrency` | 144 | **step 3 is real** |
| `SetTripBudget` | 158 | **step 3 is real** |

**Sequence:** create with the name, then apply dates and budget to the returned
`tripId`, then navigate. Do **not** try to widen `CreateTrip`.

**Steps and their verdicts:**

| step | fields | verdict |
|---|---|---|
| 1 — Where | trip name `Input` | **real** (`CreateTrip`) |
| 1 — Where | "Recent and nearby" destination chips | **Preview** — no destination field |
| 1 — Where | "Start from a Playbook" panel | **Preview** — M11 |
| 2 — When | Arrive date input | **real** (`SetTripDates`) |
| 2 — When | ~~Leave date input~~ | **REMOVED 2026-08-23** — see below |
| 2 — When | length chips (five, listed below) | **real** — they set the length; the end follows |
| 3 — Who | invite list | **Preview** — `TripMember.role` is literal `"owner"` |
| 3 — Money | budget total + currency | **real** (`SetTripBudget`, `SetTripCurrency`) |
| 4 — Shape | pace `SegmentedControl`, tag chips | **Preview** — no fields |
| 4 — Shape | "Let the assistant draft it" panel | **Preview** — M9 |

> **Amended 2026-08-23 (Mitchell): there is no Leave date input.** *"I do not
> want us picking an end date, it makes the UI awful. The end date will always be
> start date + number of days in trip = full trip."* Step 2 is **Arrive** plus the
> length chips; the user picks a length, never an end date. At create time that is
> still one atomic `SetTripDates(start, start + N − 1)` — the command is
> unchanged, only the input is. `SPEC.md` §3 and Task 8b.6
> (`phase-8b-design-sync.md`), which removes the same field from the Trip
> settings Dates row, are the same decision. Whichever of the two lands second
> should check the other has been done rather than reintroducing the field.
>
> The test below still asserts `SetTripDates` with a `startDate` and an
> `endDate` — that stays correct, because the chip computes the end. What must
> **not** exist is a control the user types an end date into.

**The length chips, verbatim** (`Trip Planner Redesign.dc.html:3440`'s
`lengthChips`) — five, in this order:

| chip | days | source |
|---|---|---|
| `Long weekend` | 4 | the design's own New Orleans card reads *"Long weekend, four days"* (line 3211) |
| `A week` | 7 | the label |
| `10 days` | 10 | the label |
| `2 weeks` | 14 | the label |
| `Longer` | **unspecified** | see below |

The prototype's chips only `flash(label + ' — dates filled in')`, so the design
states no day count for any of them; the four above are read off the labels and
off that New Orleans line, not invented. **`Longer` has no length the design
implies** — it is presumably an escape hatch to a manual day count. Per the plan
index's own rule ("If a task seems to require a value it does not give you, stop
and ask rather than inventing one"), **ask before giving `Longer` a number.**
Shipping the other four and marking `Longer` is also a legitimate answer.

`endDate` is `startDate + days − 1` (the amendment above): a 14-day trip
arriving `2026-10-03` ends `2026-10-16`, which is what the test below asserts.

**Files:**
- Create: `apps/web/src/components/home/NewTripWizard.tsx`, `NewTripWizard.test.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/lib/preview-registry.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
it("walks four steps with a progress rail", async () => {
  renderWizard();
  expect(screen.getAllByTestId("wizard-step")).toHaveLength(4);
});

it("creates the trip with just a name, then applies dates and budget", async () => {
  const { createTrip, dispatch } = renderWizard();
  createTrip.mockResolvedValue({ ok: true, value: { tripId: "new-trip" } });

  await userEvent.type(screen.getByLabelText("Trip name"), "Japan");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Arrive"), "2026-10-03");
  // Step 2 is Arrive plus a length chip — there is no Leave input to type into
  // (the 2026-08-23 amendment above). "2 weeks" is 14 days, so the end the
  // wizard computes is 2026-10-16, which is what this test then asserts.
  await userEvent.click(screen.getByRole("button", { name: "2 weeks" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Create trip" }));

  expect(createTrip).toHaveBeenCalledWith({ name: "Japan" });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: "SetTripDates", tripId: "new-trip", startDate: "2026-10-03", endDate: "2026-10-16",
  }));
});

// The 2026-08-23 amendment as an enforced rule rather than a stated one:
// AGENTS.md's testing model says an invariant a comment asserts is "a lie with
// a timer on it" unless a test holds it. Task 8b.6 removes the same field from
// the Trip settings Dates row; this is the wizard's half of that decision.
it("offers no way to type an end date", async () => {
  renderWizard();
  await userEvent.type(screen.getByLabelText("Trip name"), "Japan");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByLabelText("Arrive")).toBeTruthy();
  expect(screen.queryByLabelText("Leave")).toBeNull();
});

it("can still create a trip from the name alone", async () => {
  const { createTrip } = renderWizard();
  await userEvent.type(screen.getByLabelText("Trip name"), "Lisbon");
  await userEvent.click(screen.getByRole("button", { name: "Create empty" }));

  expect(createTrip).toHaveBeenCalledWith({ name: "Lisbon" });
});
```

**Check `SetTripDates`' real field names** before writing the assertion —
`sed -n '82,89p' packages/contracts/src/trip.ts`. If they are not
`startDate`/`endDate`, use whatever they are.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

Host it in the existing `Dialog` on `app/page.tsx` (or a `Sheet` — the design
uses a Sheet; either is fine, but do not build a third overlay primitive).
Keep the existing single-field path reachable as **"Create empty"**, which the
design's own footer has, so nobody is forced through four steps.

Register the Preview ids you add — one per marked block, all in the same commit.

- [ ] **Step 4: Run tests; verify in the browser; commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/home/NewTripWizard.tsx apps/web/src/components/home/NewTripWizard.test.tsx apps/web/src/app/page.tsx apps/web/src/lib/preview-registry.ts
git commit -m "feat(web): four-step new-trip wizard — real name, dates and budget"
```

---

## Phase 7 exit checklist

- [ ] The add-stop sheet is titled "Add a stop", has no nested `Card`, and offers
      Day / Start / How long rather than two raw times.
- [ ] `Half day` is four hours; edit mode keeps an explicit end time.
- [ ] The availability note is a real `Banner` computed from the day's windows.
- [ ] The wizard creates with a name only, then applies real dates and budget.
- [ ] Step 2 is Arrive plus the five length chips, and there is **no** control
      the user types an end date into (2026-08-23 amendment; Task 8b.6 is the
      same decision applied to the Trip settings Dates row).
- [ ] "Create empty" still works — nobody is forced through four steps.
- [ ] Every Preview block added here is registered and the sync test is green.
