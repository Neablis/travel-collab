# M9 Plan 4 — New trip is four turns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `NewTripWizard`'s four-step stepper with the scripted four-turn conversation the design asks for — `where` · `when` · `pace` · `feel` — inside the same sheet, with both exits live throughout, and close `KI-2026-09-12-e` while that file is open. A person can walk the whole thing on a preview and come out holding a real trip.

**Architecture:** The questions are a **fixed local script**, not a conversation with a model. `SPEC.md` §30.2 is the load-bearing sentence of this whole design: *"The questions, their order, their chips and the commit behaviour are all local; the first model call happens after the [last] answer, once."* A build that makes the questions themselves conversational turns every abandoned New-trip sheet into billed turns. So the script is a pure data module with a pure reducer over it, and the React layer renders that reducer's output into the shared `components/assistant/Transcript.tsx` — the flow becomes a **third consumer** of that component rather than a fourth implementation of a transcript. The trip-creating half is unchanged: `createTrip({ name })` then `SetTripDates`, exactly the sequence `submit()` runs today, with the latch that KI-2026-09-12-e is about.

**Tech Stack:** TypeScript, React 19, Next.js (app router), Radix Dialog (`components/ui/sheet.tsx`), Vitest + Testing Library, Playwright.

**Spec:** `docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md` §3 (the four turns), §4 (the fork — **out of scope here**, see below), §10 (open decisions), §11 (recorded deltas). Design handoff: `.design-sync/handoff/SPEC.md` §30, and `.design-sync/handoff/design/Trip Planner Redesign.dc.html` (`NT_QS`, `ntBub`, `ntPin`, `ntFlow`) for the literal script and behaviour. Milestone: `docs/milestones/M9-ai-planning-partner.md`.

**This is plan 4 of 8**, and it is **the first shippable slice** (design §8's build order, item 4). Build order item 4 covers *"the four-turn transcript and the deterministic free path"*; this document is **only the transcript half**. The deterministic free path is gated by the theme-authoring pass (item 3) and gets its own plan. Nothing in this one is gated by it — see Correction 1 below.

**Depends on:** nothing in plans 1–3 *as code*. It reads no quota, charges no step, calls no model.

**Both sequencing preconditions cleared on 2026-09-15**, after this document was written and before it was merged. Recorded because the first draft of this paragraph named them as live blockers:

- **Plan 1 (KI-94/KI-97) merged** — `cacc1af`, [#178](https://github.com/Neablis/travel-collab/pull/178). That is also the commit that put `docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md` and `docs/plans/2026-09-15-M9-01-step-quota-concurrency.md` on `main`; until it landed, neither existed there. **Read the spec from `main`** — an earlier draft of this line sent readers to an unmerged branch.
- **M21's open PRs merged** — [#180](https://github.com/Neablis/travel-collab/pull/180) (`ec53a39`) and [#181](https://github.com/Neablis/travel-collab/pull/181) (`649ca04`), leaving the repo with no open PRs. That satisfies the retro's rule that the current milestone's work lands before the next milestone's code starts. **M21's gate is still 9/17 and not closed**, which the rule does not require; M9 sits earlier in the order regardless.

**Overlaps plan 2 (the transcript rebuild) in exactly one place** and nowhere else: Task 2 below moves scroll pinning off `scrollIntoView`, which is design §2c. Plan 2 must not redo it. Plan 2 keeps §2a (no bubbles), §2b (collapsed steps) and §2d (tokens); this plan touches none of those three.

---

## Corrections carried into this plan

Three things an earlier reading of this milestone got wrong. They are recorded here because getting any of them wrong again changes what gets built.

1. **The theme-authoring pass does NOT gate this.** It gates the *free tier's deterministic generation*, where the `feel` answer picks which library days to assemble (design §4b). The conversation UI needs no theme vocabulary at all: `feel` is collected as text, and nothing in this plan consumes it. `Create with this` making a real trip from the answers is enough to click the whole flow through.
2. **Every call site in this plan was verified by grep before the task was written**, because the previous plan for this milestone named the wrong admission call site, missed an unmigrated integration test, missed five stale interface implementations, and missed a type the change had to thread through — all four caught by a pre-flight scan rather than by the plan (`docs/retros/2026-09-15-m9-planning-session-scope-drift-retro.md` §4). Every file path, symbol and count below was read. Two findings that a plan written from memory would have missed are called out where they land: **15 e2e call sites** (Task 1) and **`preview.test.tsx` using `wizard-longer-chip` as a fixture id** (Task 6).
3. **`NewTripWizard.tsx` carries an open defect — KI-2026-09-12-e** — whose retry is safe against a *rejected* command but not a *lost response*, so a committed write can duplicate a trip or deadlock the sheet. Rewriting that file into a transcript is the moment to close it. Task 5 is that task. Rewriting around it and leaving it is not acceptable.

---

## Scope

### In scope

- The transcript of four questions (`where` · `when` · `pace` · `feel`), in fixed order, from a local script.
- Chips **and** composer live on every turn. Chips commit on click; the composer commits on Enter or Send.
- Empty and whitespace-only answers do not commit.
- `when` additionally offers the two real date inputs inline with a **Use these** button.
- `feel` is the one multi-select turn; unpicked, it commits **"A bit of everything"** rather than blocking.
- An answered turn collapses to the user's own words with a quiet **Change** that returns to that turn and **keeps later answers**.
- Both exits always available: **Create empty** from turn one, **Create with this** from the first answer onward.
- Once a trip exists, the footer's primary becomes **Open the trip**.
- No typing indicator, no artificial delay, no streaming during the four turns.
- Scroll pinning by `scrollTop`, never `scrollIntoView`.
- KI-2026-09-12-e closed.
- All four wizard `<Preview>` shells resolved, and `lib/preview-registry.ts` updated.

### Out of scope, deliberately

State these in the PR body too; each is a real capability a reviewer will look for and not find.

- **The generation itself.** Nothing assembles days from `content/playbooks/`. The trip this flow produces has a name, and dates when the answers supply them — nothing more.
- **The entitlement fork** (design §4). Both branches are the same branch in this slice: no `ntAIAccess`-equivalent, no *See plans* button, no live composer after the last turn.
- **The draft-trip status** (design §4c). `TripStatus` gains no third value here; that is its own contracts PR.
- **Grounding** (design §5) and **KI-93**.
- **The theme-authoring pass** (design §4b) and the 148-day content edit.
- **The transcript typography rebuild** — no bubbles, collapsed steps, tokens (design §2a/2b/2d). Plan 2 owns those. This plan renders into `Transcript` as it finds it.
- **Conversation durability** (design §6). No `localStorage`. Closing the sheet loses the answers, exactly as today.
- **`who`.** Dropped on Mitchell's instruction, 2026-09-15. `SPEC.md` §30.1 says five turns; this is a recorded delta and `.design-sync/handoff/DRIFT.md` is owed the row (Task 7).

---

## Decisions Mitchell owes before this is executed

**ANSWERED 2026-09-16, all four, in one sitting before the first build commit.** Each
answer is recorded under its own heading below.

Two of them — D-B and D-D — needed the plan's conditional branches rather than its
default, and **Task 6 already carries both**, which a first version of this preamble got
wrong by claiming the task had to be rewritten. It does not; it has to be read. D-B also
reverses a decision recorded in source, so `NewTripWizard.tsx` carries the reversal as
well as this file, in the commit that moves the code.

Three things the design does not settle. **Flagged, not invented.** Each one has a concrete consequence named, so the answer is a sentence rather than a design session.

### D-A. "Recent and nearby" has no data source

Design §10.7, and `DRIFT.md`'s own line 299: *"drop the two `unplaced` wizard shells from the design, or get them a data source."*

`NT_QS[0].label` in the design file is literally `'Recent and nearby'`, and the six chips under it are a hardcoded list (`Lisbon`, `Mexico City`, `Seoul`, `Copenhagen`, `Big Sur`, `Back to Kyoto`). **No destination field exists on `TripSummary` or `TripDetail`**, which is the exact reason `wizard-destination-chips` was retagged `unplaced` on 2026-08-31 rather than assigned to a milestone. The chips themselves become real in this plan — clicking one commits an answer, which is real behaviour. **The label is the unsupported claim, and it decides the registry entry:**

- **If the label drops** (recommended — the chips become plain suggestions, no label or a neutral one like "Or pick one"), `wizard-destination-chips` leaves `preview-registry.ts` in Task 6, because there is nothing left unbuilt.
- **If the label stays**, the entry **must stay** and the chip row stays `<Preview>`-wrapped, because "Recent and nearby" over a hardcoded list is a fabricated note — the precise thing a `<Preview>` shell exists to mark. Storing destinations is D6/KI-34's neighbourhood, not M9's.

Task 6 is written against the first answer and says what to change for the second.

> **ANSWERED 2026-09-16 — the label drops.** The chips become plain suggestions with no
> label. `wizard-destination-chips` **leaves** `preview-registry.ts` in Task 6, because
> once the unsupported claim is gone there is nothing unbuilt left to mark. Storing
> destinations stays D6/KI-34's neighbourhood and is not pulled into M9.

### D-B. `Longer` acquired a day count

`NT_NIGHTS` in the design file maps `Longer → 21`. `NewTripWizard.tsx:26-30` records the opposite decision in a comment: *"`Longer` has no day count the design implies (Mitchell, 2026-08-23 decision) — it ships as an inert Preview badge."* **The design reverses a recorded decision without recording that it did.** Confirm which holds:

- **21 confirmed** → `Longer` becomes a fifth real length chip and `wizard-longer-chip` leaves the registry.
- **2026-08-23 holds** → `Longer` either drops from the chip row entirely (the composer already accepts "three weeks" as prose) or stays an inert `<Preview>` badge, and the registry entry stays.

> **ANSWERED 2026-09-16 — 21 nights is confirmed, and this REVERSES the 2026-08-23
> decision.** `Longer` becomes a fifth real length chip mapping to 21 nights, and
> `wizard-longer-chip` **leaves** `preview-registry.ts`.
>
> **Correction to this note as first written.** It said Task 6 "was written against the
> other answer and is now wrong as drafted". That is false, and reading Task 6 rather
> than remembering it is what showed so: Step 3 spells out **both** branches, and the one
> this answer selects — *"Longer becomes a fifth length chip and the entry is removed"* —
> is already written there. Task 6 needs following, not rewriting.
>
> Its Step 4 also names the trap the removal creates, which this note would have lost:
> `preview.test.tsx:74-80` uses `wizard-longer-chip` as a **fixture id**, so dropping the
> entry narrows `PreviewId` and breaks the typecheck of a file with nothing to do with
> the wizard.
>
> **The reversal has to reach the source comment, and only when the code moves with it.**
> `NewTripWizard.tsx:25-30` states the 2026-08-23 decision as live fact, so a reader who
> never finds this file believes it. Task 6 rewrites that comment **in the same commit
> that adds the fifth chip** — writing the new decision above code still implementing the
> old one is the comment-contradicts-code defect that cost #184 two findings.
>
> The design file reversed this decision *without* recording that it did, which is the
> entire reason D-B existed. Repeating that in the other direction would be worse, not
> symmetrical.

### D-C. What the closing turn is allowed to say

The design's `made` copy reads *"N days in X at a Y pace, laid out as Day 1 to Day N around Z. Every stop is yours to move."* **Two-thirds of that sentence is not true in this slice.** `pace` and `feel` are collected as text and stored nowhere — no field models either, and nothing consumes them until the theme pass and the fork land. A closing turn claiming the trip was "built around" the `feel` answer is a fabricated note in a repo that maintains a registry specifically to mark those.

Proposed closing copy, which is true of what this slice actually creates:

> *"{name} is created, {N} days from {start}. The days are empty and yours to fill — what you said about pace and what the trip is about is not built in yet."*

…with the dates clause omitted when no dates were supplied. Confirm, or supply different words. **Do not ship the design's `made` copy as written.**

> **ANSWERED 2026-09-16 — use the proposed copy.** Task 4 ships exactly the sentence
> above, dates clause omitted when no dates were supplied. The design's `made` copy is
> not shipped, and Task 7 records why: `pace` and `feel` are collected and stored
> nowhere, so a closing turn claiming the trip was built around them would be a
> fabricated note in a repo that keeps a registry to mark exactly those.

---

## Global Constraints

- **The four turns make zero model calls and zero network calls.** The only network traffic this flow may produce is `POST /api/trips` and `POST /api/trips/:id/commands`, and only when an exit is pressed. `SPEC.md` §30.2.
- **Never `scrollIntoView`.** Banned repo-wide (`SPEC.md` §30.6); `Board.tsx:231` and `Column.tsx:168` both carry comments about it moving every scrollable ancestor, and **KI-2026-09-13-a is an open bug in exactly that family**. Pin with `scrollTop`.
- **No typing indicator, no artificial delay, no streaming** during the four turns. A fake delay to make it feel like a model is explicitly wrong (§30.2).
- **The per-turn "Change" affordance belongs to this consumer, not to `Transcript`.** "Change" has no meaning in the assistant panel; the shared component stays about two voices and one disclosure (design §3, §30.5).
- **No arbitrary Tailwind values.** The element wall is `no-restricted-syntax` and KI-2026-09-05-v already carries 128 line-level disables; do not add a 129th. If a value has no token, that is plan 2's typography task, not this one.
- **No static city `<option>` list.** `preview-registry.test.ts`'s "has no static city `<option>` list anywhere in src" fires on any `<option>` literal naming a demo city, and on an `aria-label="City"` select with literal options. The destination chips are buttons, not a select — keep them that way.
- **`crypto.randomUUID()` is already used in this file** (`NewTripWizard.tsx:253`), so it is available in the app and in the jsdom unit lane. No polyfill task.
- **A test is not done until you have seen it fail for your reason** (CLAUDE.md rule 3). Break the code it protects, watch it go red for *your* reason, restore, watch it go green. The PR template asks for the source edit and the real failure text.
- **Tier 2 while the branch is open:** run the `minimal-check-subset` skill's output, not `pnpm check`. **Tier 3 once, at final review:** `pnpm check` plus `pnpm --filter web test:e2e:ci-like`, because a user flow changed. An e2e verdict only counts from `test:e2e:ci-like` (CLAUDE.md rule 1) — plain `test:e2e` serves `pnpm dev` and produces timeouts CI does not have.
- **Before calling any failure environmental or flaky, `grep -r "<symptom>" docs/known-issues/`** (CLAUDE.md rule 2). A failure whose location moves between runs is a timeout; a real defect fails in the same place every time.

---

### Task 1: Give the e2e suite one seam onto the wizard, before changing it

**This is the finding a plan written from memory misses.** `getByLabel("Trip name")` followed by `Create empty` is inlined in **15 places across 10 spec files**, and the new flow has no field called "Trip name". Extracting the sequence into one helper **against today's wizard**, and proving the suite still passes, means the UI rewrite later costs one edit instead of fifteen.

**Files:**
- Modify: `apps/web/e2e/helpers.ts`
- Modify: `apps/web/e2e/m1-board.spec.ts` (1), `m2-history.spec.ts` (1), `m3-place-and-time.spec.ts` (1), `m4-money-and-lenses.spec.ts` (1), `m6-optimistic.spec.ts` (2), `m7-solo-delight.spec.ts` (3), `m8-make-it-real.spec.ts` (2), `m14-notebook-widgets.spec.ts` (2), `m15-front-door.spec.ts` (1), `smoke.spec.ts` (1)
- Modify: `apps/web/e2e/responsive.spec.ts` (**not** a create sequence — see Step 4)

**Interfaces:**
- Produces: `createEmptyTripViaWizard(page: Page, name: string): Promise<void>` in `helpers.ts`.
- Consumes: nothing new. Same locators the specs use today.

- [ ] **Step 1: Confirm the count before you touch anything**

```bash
grep -rn 'name: "Create empty" }).click()' apps/web/e2e/*.ts | wc -l
for f in $(grep -rln 'name: "Create empty" }).click()' apps/web/e2e/*.ts); do
  echo "$(basename "$f"): $(grep -c 'name: "Create empty" }).click()' "$f")"
done
```

Expected: **15 clicks across 10 files**, distributed as the Files list above.

**Match the `.click()`, not the words.** A bare `grep -c 'Create empty'` counts the prose too — `m7-solo-delight.spec.ts:146`, `m14-notebook-widgets.spec.ts:74` and `:545` all *explain* what a Create-empty trip leaves behind without clicking anything — and reading those as call sites inflates the figure to 18. `responsive.spec.ts` is an eleventh file that asserts `getByLabel("Trip name")` **without creating anything**; it is Step 4's, not this step's. **If the counts differ from this plan, the tree moved — reconcile before writing the helper, and say so in the PR body.**

- [ ] **Step 2: Write the helper**

In `apps/web/e2e/helpers.ts`, beside `createMappedTrip` (which is the existing precedent for "a spec needs a trip and does not want to re-derive how"):

```ts
/**
 * A trip from a name alone, through the New-trip sheet's own UI.
 *
 * Deliberately NOT `createMappedTrip`'s API shortcut: these specs are the ones
 * that exercise the sheet as a real entry point, and replacing the clicks with
 * a POST would quietly delete that coverage from ten files at once.
 *
 * It exists as a helper because the sheet's first affordance is about to stop
 * being a field called "Trip name" (SPEC §30.1 — the wizard becomes a
 * transcript). Fifteen inlined copies of that locator is fifteen edits;
 * this is one.
 *
 * Leaves the browser on the trip list, not on the trip — "Create empty" has
 * never navigated (NewTripWizard.tsx's `onCreated` comment, and the CI failure
 * on PR #32 that put it there), and every caller below clicks the new trip's
 * own link afterwards.
 */
export async function createEmptyTripViaWizard(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(name);
  await page.getByRole("button", { name: "Create empty" }).click();
}
```

- [ ] **Step 3: Replace all 15 call sites**

Each becomes `await createEmptyTripViaWizard(page, tripName);` with the `New trip` click folded in. **Check each site individually** — `m15-front-door.spec.ts` uses `getByLabel(/trip name/i)` — a regex, not the exact string, so a literal search misses it; `m14-notebook-widgets.spec.ts` has two distinct helper functions that both do this. Add the import to each file.

- [ ] **Step 4: Handle `responsive.spec.ts` separately — it is not a create**

`responsive.spec.ts:893-894` clicks `FirstTripStart`'s "Name your trip" and asserts `getByLabel("Trip name")` is visible. It is asserting **that the sheet opened and is operable at this width**, not creating anything. Leave it inlined and add a comment saying what it is really asserting, so Task 5 knows to re-point it at the first question rather than delete it:

```ts
    // Asserts the sheet OPENED and is operable at this width — the locator is
    // just the first thing inside it. When the sheet becomes a transcript
    // (SPEC §30.1) re-point this at the first question, do not drop it.
    await expect(page.getByLabel("Trip name")).toBeVisible();
```

- [ ] **Step 5: Prove the migration changed nothing**

Run: `pnpm --filter web test:e2e:ci-like`

Expected: PASS, with the same specs passing as before. **This is the one place in this plan where a full e2e run is earned mid-branch** — the change is a mechanical edit across ten spec files and its whole purpose is to be behaviour-preserving, which only the suite can show. Say so in the PR body (`AGENTS.md`: *"A mid-branch full-suite run is a judgment call to justify, not a reflex"*).

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/
git commit -m "test(e2e): one seam onto the New-trip sheet, not fifteen

getByLabel(\"Trip name\") + \"Create empty\" was inlined in 15 places across 10
spec files. The sheet is about to stop having a field by that name (SPEC §30.1),
so the sequence moves into createEmptyTripViaWizard first, against the wizard
as it stands, where the suite can prove the migration changed nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

---

### Task 2: `Transcript` stops scrolling itself, and gains a per-turn slot

Two changes to the shared component, both minimal, both required before a third consumer can use it.

**Why it stops scrolling itself:** `Transcript.tsx:142-147` calls `endRef.current.scrollIntoView({ block: "end" })`. It owns no scrollport — `AssistantRail.tsx:561` does (`overflow-y-auto overscroll-contain`). `scrollIntoView` moves **every** scrollable ancestor, which is why it is banned repo-wide and why KI-2026-09-13-a is open. Dropped into the New-trip sheet, that call would fight the sheet's own pinning. So pinning moves to whoever owns the scrollport, as a shared hook.

**Why it gains a slot:** the flow needs a **Change** control under each answered user turn, and `Transcript` maps its own turns. "Change" has no meaning in the assistant panel (design §3), so the component must not learn the word — it takes an optional render prop and knows nothing about what comes back.

**Files:**
- Modify: `apps/web/src/components/assistant/Transcript.tsx`
- Create: `apps/web/src/components/assistant/usePinToBottom.ts`
- Create: `apps/web/src/components/assistant/usePinToBottom.test.ts`
- Modify: `apps/web/src/components/assistant/AssistantRail.tsx` (the scrollport at `:561`)
- Modify: `apps/web/src/components/assistant/Transcript.test.tsx`

**Interfaces:**
- Produces: `usePinToBottom(ref: RefObject<HTMLElement | null>, deps: unknown[]): void` — sets `ref.current.scrollTop = ref.current.scrollHeight` when `deps` change, and no-ops on a null ref.
- Produces: `Transcript`'s new optional prop `renderTurnFooter?: (turn: AssistantTurn) => ReactNode`. **Optional** — `AssistantRail` passes nothing and renders identically.
- Consumes: `AssistantTurn`, `ToolNote` — unchanged, not widened.

- [ ] **Step 1: Write the failing hook test**

`usePinToBottom.test.ts`, driven with `renderHook` and a plain object standing in for the element (jsdom gives every element `scrollHeight: 0`, so assert the *assignment*, not a layout outcome):

```ts
it("pins the scrollport to its own scrollHeight when a dep changes", () => {
  const node = { scrollTop: 0, scrollHeight: 500 } as HTMLElement;
  const ref = { current: node };
  const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), { initialProps: { n: 1 } });
  expect(node.scrollTop).toBe(500);
  node.scrollTop = 0;
  node.scrollHeight = 900;
  rerender({ n: 2 });
  expect(node.scrollTop).toBe(900);
});

it("does not throw when the scrollport is not mounted", () => {
  const ref = { current: null };
  expect(() => renderHook(() => usePinToBottom(ref, [1]))).not.toThrow();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter web test -- usePinToBottom`
Expected: FAIL — the module does not exist. Write the hook, re-run, confirm green.

- [ ] **Step 3: Delete the `scrollIntoView` effect from `Transcript`**

Remove `endRef`, the effect at `:142-147`, and the `<div ref={endRef} />` at `:205`. Replace the effect's comment with one that says where the job went and why:

```
 * **This component does not scroll.** It has no scrollport — its consumers do
 * (AssistantRail's `overflow-y-auto` column, and the New-trip sheet's thread).
 * It used to call `scrollIntoView({ block: "end" })` on a trailing div, which
 * moves EVERY scrollable ancestor, not just the intended one: banned repo-wide
 * by SPEC §30.6, and KI-2026-09-13-a is an open bug in that family. Pinning is
 * `usePinToBottom` now, called by whoever owns the scrollport with the right
 * scrollTop to set. The jsdom feature-guard goes with it — `scrollTop` exists
 * in jsdom, `scrollIntoView` does not.
```

- [ ] **Step 4: Call the hook from `AssistantRail`**

Put a ref on the existing `overflow-y-auto` column at `AssistantRail.tsx:561` and call `usePinToBottom(scrollportRef, [turns])`. **`[turns]` reproduces the old dependency exactly** — the effect it replaces depended on `turns` and nothing else. Do not widen it here; the rail's own follow-up-count and phase pinning is plan 2's business, not this plan's.

- [ ] **Step 5: Add the per-turn footer slot**

```ts
  /**
   * Rendered under a turn by the CONSUMER, which is the only thing that knows
   * what belongs there. The New-trip flow puts its "Change" control here
   * (SPEC §30.1); the assistant panel passes nothing, because "Change" means
   * nothing mid-conversation with a trip open. Deliberately a render prop and
   * not a `changeable` flag: this component must not learn the word.
   */
  renderTurnFooter?: (turn: AssistantTurn) => React.ReactNode;
```

Render `renderTurnFooter?.(turn)` inside both branches of the map, after the turn's own content.

- [ ] **Step 6: Prove both halves, including that the rail is untouched**

Add to `Transcript.test.tsx`:

```ts
it("renders a consumer's per-turn footer under each turn, and nothing when none is given", () => { /* … */ });
it("never calls scrollIntoView", () => {
  const spy = vi.fn();
  // jsdom implements no scrollIntoView at all, so an accidental reintroduction
  // would throw rather than be silently ignored — this asserts it even so,
  // because a future feature-guard would hide the throw.
  Element.prototype.scrollIntoView = spy as Element["scrollIntoView"];
  render(<Transcript turns={[/* … */]} />);
  expect(spy).not.toHaveBeenCalled();
});
```

Run: `pnpm --filter web test -- Transcript AssistantRail usePinToBottom`

Expected: PASS, with `AssistantRail.test.tsx` **unchanged and still green**. If it needed an edit, the prop was not optional — go back to Step 5.

- [ ] **Step 7: See it fail for your reason**

Revert Step 3's deletion (put `scrollIntoView` back) and confirm the new test goes red naming `scrollIntoView`. Restore. Then delete the `renderTurnFooter?.()` call and confirm the footer test goes red on a missing element. Restore. Paste both failure texts into the PR body.

- [ ] **Step 8: Narrowed check subset, then commit**

Invoke `minimal-check-subset` with the changed files and run exactly what it prints. Do **not** run `pnpm check`.

```bash
git add apps/web/src/components/assistant/
git commit -m "refactor(assistant): Transcript stops scrolling itself, and gains a per-turn slot

scrollIntoView moves every scrollable ancestor — banned by SPEC §30.6, and
KI-2026-09-13-a is an open bug in that family. Pinning moves to whoever owns
the scrollport (usePinToBottom), which is AssistantRail today and the New-trip
thread next. The optional renderTurnFooter slot lets a consumer put its own
control under a turn without this component learning what \"Change\" means.

Closes design §2c. §2a/2b/2d (bubbles, collapsed steps, tokens) stay with the
transcript rebuild plan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

---

### Task 3: The question script, and a pure reducer over it

Everything that decides *what is asked, what commits, and what an answer means* lives here, with no React in it. That is what makes the "no model call" property assertable and the edge cases cheap to test.

**Files:**
- Create: `apps/web/src/components/home/newTripScript.ts`
- Create: `apps/web/src/components/home/newTripScript.test.ts`

**Interfaces:**
- Produces: `NEW_TRIP_QUESTIONS` — four entries, `{ id, ask, placeholder, chipLabel, chips, dates?, multi? }`, ids `"where" | "when" | "pace" | "feel"`.
- Produces: `type NewTripAnswers = Partial<Record<NewTripQuestionId, string>>`.
- Produces: `type NewTripState = { turn: number; answers: NewTripAnswers; picked: string[] }`.
- Produces: `commitAnswer(state, value): NewTripState`, `changeTo(state, turn): NewTripState`, `togglePick(state, chip): NewTripState`, `commitMulti(state): NewTripState`.
- Produces: `FEEL_DEFAULT = "A bit of everything"`.
- Consumes: nothing. No imports from `@/lib`, no React, no fetch.

- [ ] **Step 1: Write the failing tests first**

```ts
it("has exactly four turns, in the design's order, with `who` absent", () => {
  expect(NEW_TRIP_QUESTIONS.map((q) => q.id)).toEqual(["where", "when", "pace", "feel"]);
});

it("does not commit an empty or whitespace-only answer", () => {
  const s = { turn: 0, answers: {}, picked: [] };
  expect(commitAnswer(s, "")).toEqual(s);
  expect(commitAnswer(s, "   ")).toEqual(s);
  expect(commitAnswer(s, "\n\t ")).toEqual(s);
});

it("trims what it does commit, and advances one turn", () => {
  const s = commitAnswer({ turn: 0, answers: {}, picked: [] }, "  Lisbon  ");
  expect(s).toEqual({ turn: 1, answers: { where: "Lisbon" }, picked: [] });
});

it("commits `feel` as the default when nothing is picked", () => {
  const s = { turn: 3, answers: { where: "Lisbon" }, picked: [] };
  expect(commitMulti(s).answers.feel).toBe(FEEL_DEFAULT);
});

it("commits the picked `feel` chips together, in pick order", () => {
  const s = { turn: 3, answers: {}, picked: ["Food", "Markets"] };
  expect(commitMulti(s).answers.feel).toBe("Food, Markets");
});

// SPEC §30.1: "Later answers are kept, not cleared — you re-answer forward."
it("Change returns to a turn and keeps every later answer", () => {
  const s = { turn: 4, answers: { where: "Lisbon", when: "A week", pace: "Slow", feel: "Food" }, picked: [] };
  const back = changeTo(s, 0);
  expect(back.turn).toBe(0);
  expect(back.answers).toEqual(s.answers);
  expect(back.picked).toEqual([]);
});

it("re-answering an earlier turn overwrites only that answer", () => {
  const s = changeTo({ turn: 4, answers: { where: "Lisbon", when: "A week", pace: "Slow", feel: "Food" }, picked: [] }, 0);
  const next = commitAnswer(s, "Seoul");
  expect(next.answers).toEqual({ where: "Seoul", when: "A week", pace: "Slow", feel: "Food" });
  expect(next.turn).toBe(1);
});
```

- [ ] **Step 2: Run them and watch every one fail**

Run: `pnpm --filter web test -- newTripScript`
Expected: FAIL — the module does not exist. **Do not write the module until you have seen this.**

- [ ] **Step 3: Write the script data, verbatim from the design**

From `Trip Planner Redesign.dc.html:5260-5271` (`NT_QS`), **minus the `who` entry**:

| id | ask | placeholder | chips |
|---|---|---|---|
| `where` | Where are you going? | Type a city, or pick one below | Lisbon · Mexico City · Seoul · Copenhagen · Big Sur · Back to Kyoto |
| `when` | How long, roughly? | e.g. nine nights in April | Long weekend · A week · 10 days · 2 weeks (+ `Longer`, see D-B) — `dates: true` |
| `pace` | What pace do you want? | Or describe it | Slow · Balanced · Packed |
| `feel` | What is the trip about? | Or say it in your own words | Food · Art · Hiking · Nightlife · Markets · Architecture · With kids · Slow mornings — `multi: true` |

`where`'s `chipLabel` is **D-A's decision** — write it as `""` (no label) pending confirmation, with a comment naming D-A. `when`'s is "Pick a length, or set the exact dates"; `feel`'s is "Pick as many as fit"; `pace`'s is empty.

Carry `NewTripWizard.tsx:31-36`'s existing `LENGTH_CHIPS` day counts across unchanged — `Long weekend: 4`, `A week: 7`, `10 days: 10`, `2 weeks: 14` — as a separate `LENGTH_DAYS` map, because they are what `SetTripDates` needs and the chip labels are what the transcript shows. **Do not add `Longer: 21` until D-B is answered.**

- [ ] **Step 4: Write the reducer, re-run, confirm green**

Run: `pnpm --filter web test -- newTripScript` → PASS.

- [ ] **Step 5: See one of them fail for your reason**

Delete the `.trim()` guard in `commitAnswer` and confirm the whitespace test goes red on a state that advanced when it should not have. Restore. Paste the failure text into the PR body.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/home/newTripScript.ts apps/web/src/components/home/newTripScript.test.ts
git commit -m "feat(new-trip): the four-turn question script, as local data

SPEC §30.2's load-bearing property in one module: the questions, their order,
their chips and the commit behaviour are local, so nothing is generated and
nothing is billed while a person is answering. No React, no fetch, no imports
from lib — which is what makes \"zero model calls\" a thing a test can hold.

`who` is absent: four turns, not five (Mitchell, 2026-09-15 — a recorded delta
from SPEC §30.1, owed to DRIFT.md).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

---

### Task 4: The sheet becomes a transcript

The visible half. `WizardBody`'s stepper and four step forms are replaced; `submit()` and the `progress` latch survive almost intact and are Task 5's business.

**Files:**
- Modify: `apps/web/src/components/home/NewTripWizard.tsx`
- Modify: `apps/web/src/components/home/NewTripWizard.test.tsx`
- Modify: `apps/web/src/components/home/FirstTripStart.tsx` (`WIZARD_STEPS` at `:28-34`)
- Modify: `apps/web/src/app/(app)/page.test.tsx` (the comments and assertions at `:165-167`, `:199-206`, `:226`, `:565`, `:598-615`)
- Modify: `apps/web/e2e/helpers.ts` (the one locator inside `createEmptyTripViaWizard`)
- Modify: `apps/web/e2e/responsive.spec.ts` (`:893-894`, per Task 1 Step 4)

**Interfaces:**
- Consumes: `NEW_TRIP_QUESTIONS`, `commitAnswer`, `changeTo`, `togglePick`, `commitMulti`, `LENGTH_DAYS` (Task 3); `Transcript`, `usePinToBottom` (Task 2).
- Consumes, unchanged: `NewTripWizardProps` — `createTrip`, `dispatch`, `onCreated`, `size`, `firstRun`, `browseHref`. **The prop surface does not change**, so `page.tsx:417-443` needs no edit.
- Produces: nothing new outside the file.

- [ ] **Step 1: Read the two call sites before you change anything**

```bash
sed -n '410,445p' 'apps/web/src/app/(app)/page.tsx'
sed -n '160,230p' 'apps/web/src/app/(app)/page.test.tsx'
```

`page.tsx` passes `createTrip={createTripApi}` and `dispatch={sendTripCommand}` and takes `onCreated(tripId, { navigate })`. **`navigate` is false for "Create empty" and true for the full path, and that asymmetry is load-bearing** — every pre-Phase-7 e2e spec clicks Create-empty and then clicks the new trip's own link, and a version that always navigated broke all of them (CI, PR #32; the comment is at `NewTripWizard.tsx:81-91`). Keep it.

- [ ] **Step 2: Write the failing component tests**

Rewrite `NewTripWizard.test.tsx`'s suite around the transcript. The four existing retry tests (`:190`, `:220`, `:276`, `:329`) are about `submit()` and must keep passing with only their *setup* changed — they are the regression cover for KI-2026-09-08-a and they are not this task's to weaken. New cases:

```ts
it("opens on turn one and asks where, with chips and a composer both live", async () => { /* … */ });
it("commits a chip on click and collapses the turn to your own words", async () => { /* … */ });
it("commits the composer on Enter, and rejects an empty or whitespace answer", async () => { /* … */ });
it("offers Change under an answered turn, returns to it, and keeps the later answers", async () => { /* … */ });
it("commits feel as \"A bit of everything\" when nothing is picked", async () => { /* … */ });
it("offers Create empty from turn one and Create with this from the first answer", async () => { /* … */ });
it("makes the footer's primary \"Open the trip\" once a trip exists", async () => { /* … */ });
it("never renders a typing indicator or a step rail", async () => {
  // SPEC §30.2: there is nothing to wait for during the four turns. §30.1: the
  // stepper is not replaced with a progress bar — a transcript shows its own
  // progress, and the stepper was what made the sheet grow.
  expect(screen.queryAllByTestId("wizard-step")).toHaveLength(0);
  expect(screen.queryByText(/thinking/i)).toBeNull();
});
it("sends nothing to the network while the four turns are being answered", async () => {
  // The §30.2 property, asserted where it can actually be held: walk all four
  // turns and assert createTrip and dispatch were never called.
  expect(createTrip).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter web test -- NewTripWizard`
Expected: FAIL on the new cases, and the four retry tests failing only on setup. **Do not start the rewrite until the failures read as "the transcript is not there", not as a typo.**

- [ ] **Step 4: Rewrite `WizardBody`**

The shape, and the decisions inside it:

- **State** is Task 3's `NewTripState` plus `phase: "asking" | "made"`, plus the existing `arrive`, `submitting`, `error`, `progress`.
- **The thread** renders through `<Transcript>`: each asked question is an `assistant` turn (`tools: []`, `pending: false`), each answer a `user` turn. `renderTurnFooter` returns the **Change** control for answered user turns and `null` otherwise.
- **Scroll pinning** is `usePinToBottom(threadRef, [state.turn, phase])` on the thread's own `overflow-y-auto` column, mirroring the design's `ntPin` key (`Trip Planner Redesign.dc.html:5301-5308`). **`scrollTop`, never `scrollIntoView`.**
- **The composer** is one `Input` whose `aria-label` is the current question's `ask`, its placeholder the question's own `placeholder`, committed by `submitOnEnter` (already imported at `:19`) and by a Send button. **Its accessible name is the question, not "Trip name"** — that is the honest name, and it is why Task 1 exists.
- **Chips** are `Button variant={picked ? "primary" : "secondary"} size="sm" className="rounded-full"`, exactly the existing length-chip treatment at `:402-413`. Buttons, never a `<select>` — see the static-city-list wall in the Global Constraints.
- **Turn 2 additionally** renders the existing `Arrive` date input (`:425-433`) and an end date, with a **Use these** button. **Only the date inputs can produce a dated trip.** A length chip gives a day count with no arrival; free text like "nine nights in April" gives neither, because parsing it would be a model call. `SetTripDates` fires only when `ISO_DATE.test(arrive) && days !== null`, which is exactly today's rule at `:236` — carry it over unchanged.
- **Turn 4** toggles chips and commits them together with a button reading `"That is it — build it"` when something is picked and `"Nothing in particular"` when nothing is.
- **`Create empty`** is rendered from turn one and enabled once there is a non-blank name to use — the composer's uncommitted text, or the committed `where` answer. **That preserves today's "type a name, press Create empty" flow exactly**, which is what all 15 e2e sites do, and keeps the button honest rather than creating an unnamed trip (`CreateTrip.name` is `z.string().min(1)`, `packages/contracts/src/trip.ts:48`).
- **`Create with this`** appears from the first committed answer and runs `submit(true)` — create, then dates if they exist, then navigate.
- **Turn 4's commit** runs the same create-from-answers path and moves `phase` to `"made"`, whose primary is **Open the trip**. The closing assistant turn's copy is **D-C** — do not ship the design's `made` sentence, which claims the trip was built around `pace` and `feel`. Nothing stores either.
- **The stepper, `STEP_LABELS`, `TOTAL_STEPS`, `step`, `Next`, `Back` and the `data-testid="wizard-step"` rail all go.** So do the budget, currency and "Who is coming?" step-3 forms — `who` is dropped, and budget/currency have no turn in a four-turn script. **`submit()`'s budget and currency branches stay**, because Task 5's retry tests cover them and a later plan may reintroduce the fields; they simply never fire from this UI. Say that in a comment rather than deleting code the tests hold.

- [ ] **Step 5: Re-point the five stale references**

Every one of these was found by grep; do not trust this list without re-running it.

```bash
grep -rn 'Trip name\|Create empty\|wizard-step\|four steps\|4-step' \
  'apps/web/src/app/(app)/page.tsx' 'apps/web/src/app/(app)/page.test.tsx' \
  apps/web/src/components/home/FirstTripStart.tsx apps/web/e2e/helpers.ts apps/web/e2e/responsive.spec.ts
```

1. `FirstTripStart.tsx:28-34` — `WIZARD_STEPS`, *"The four steps `NewTripWizard` walks, said before it opens"*. It is a promise about the wizard's shape, made on the screen before it. Rewrite as the four **questions**, not four steps: Where · How long · What pace · What it is about.
2. `page.test.tsx:165-167`, `:199-206`, `:226`, `:565`, `:598-615` — comments saying "4-step NewTripWizard" and "Step 1 of 4", and the `getByLabelText("Trip name")` typing at `:187` and `:226`.
3. `helpers.ts` — the one locator inside `createEmptyTripViaWizard`, now the first question's composer.
4. `responsive.spec.ts:893-894` — re-point at the first question, per Task 1 Step 4's comment.
5. `page.tsx:66` and `:73` — comments describing "the 4-step NewTripWizard" and the Preview-wrapped chips.

- [ ] **Step 6: Re-run, confirm green, then see it fail for your reason**

Run: `pnpm --filter web test -- NewTripWizard page FirstTripStart` → PASS.

Then break one thing and watch the right test go red: delete the `.trim()` guard on the composer commit and confirm the whitespace test fails naming an extra turn. Restore. Paste the failure text into the PR body.

- [ ] **Step 7: Narrowed check subset, then the e2e lane**

Invoke `minimal-check-subset` with the changed files; run exactly what it prints. Then, because a user flow changed:

Run: `pnpm --filter web test:e2e:ci-like`

**Only this command counts** (CLAUDE.md rule 1). If something fails, `grep -r "<symptom>" docs/known-issues/` **before** calling it flaky (rule 2) — a failure that moves between runs is a timeout, one that fails in the same place every time is a defect.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/home/ 'apps/web/src/app/(app)/page.test.tsx' apps/web/e2e/
git commit -m "feat(new-trip): the sheet is four turns, not four steps

Where · when · pace · feel, asked one at a time from a local script, with chips
and a composer live on every turn and both exits open throughout. An answered
turn collapses to your own words with a Change that returns to it and keeps the
later answers. SPEC §30.1, design §3.

No stepper, no progress bar, no typing indicator and no artificial delay: a
transcript shows its own progress, and there is nothing to wait for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

---

### Task 5: Close KI-2026-09-12-e — the retry survives a lost response

The defect, in the KI's own words: the wizard's retry is safe against a *rejected* command but not a *lost response*. If `CreateTrip` commits on the server and the browser loses the response, `createTrip` returns `ok: false`, the latch never receives the `tripId`, and retrying **mints a second trip**. Same shape for `SetTripDates`: the server commits, the fetch fails, the latch is unchanged, the retry re-sends the identical value, the domain rejects it as `no-op`, and the wizard reports that rejection as the failure — the exact dead end KI-2026-09-08-a closed, reached through a different door.

**Three grep-verified corrections to the KI's own scope line**, which was written without opening the files:

1. **This is not a `packages/contracts` change, so it is not its own reviewed PR.** `CreateTrip` in `packages/contracts/src/trip.ts:46-54` **already carries `tripId`**. What mints it is `randomUUID()` inside the route (`apps/web/src/app/api/trips/route.ts:47`), and what forbids a client from supplying one is `CreateTripBody` at `:34` — a route-local zod schema in `apps/web`. AGENTS.md invariant 5 is not engaged.
2. **The server already distinguishes the case.** `decideCreateTrip` returns `reject("trip-already-exists", …)` (`packages/domain/src/trip/decide.ts:37-39`), and `okUnlessNoOp` returns `reject("no-op", …)` (`:23-30`).
3. **Half the wiring exists.** `POST /api/trips/:id/commands` already returns `{ error, code }` and `sendTripCommand` already surfaces `code` on the `ApiError` (`apiClient.ts:172-176`, `:38`). **`POST /api/trips` returns only `{ error }`**, and `createTrip` drops the code. That asymmetry is the whole gap on the create half.

**This is D-D, and Mitchell owes it** — the KI says the choice between an idempotency key and a read-back reconcile is his. The recommendation below is the key, because the read-back costs a round trip on every retry and needs a list-and-match heuristic on a name that is not unique. **Confirm before executing this task.** Tasks 1–4 and 6–7 do not depend on it.

> **ANSWERED 2026-09-16 — the idempotency key.** The client mints the `tripId` and sends
> it; `CreateTripBody` accepts it as an optional uuid. Read-back is not taken, for the
> reason above. This task is **in** this slice rather than deferred.

**Files:**
- Modify: `apps/web/src/app/api/trips/route.ts` (`CreateTripBody` at `:34`, the POST handler at `:36-54`)
- Modify: `apps/web/src/lib/apiClient.ts` (`createTrip` at `:72-91`)
- Modify: `apps/web/src/components/home/NewTripWizard.tsx` (`submit()` at `:198-299`)
- Modify: `apps/web/src/components/home/NewTripWizard.test.tsx`
- Modify: `apps/web/src/app/api/trips/route.int.test.ts` *(verify this path before writing the task — `ls apps/web/src/app/api/trips/`; if no integration test covers POST, add one rather than assuming)*

**Interfaces:**
- Changes: `createTrip(input: { name: string; tripId?: string })`, and its `ApiError` now carries `code`.
- Changes: `CreateTripBody` gains `tripId: z.string().uuid().optional()`.
- Consumes: `progress` — unchanged shape, but seeded with a client-minted `tripId` before the first attempt.

- [ ] **Step 1: Write the two failing tests**

```ts
it("a retry after a lost create response does not mint a second trip", async () => {
  // First attempt: the server commits, the response is lost.
  createTrip.mockResolvedValueOnce({ ok: false, error: { status: 0, message: "Network error" } });
  // Retry: the same client-minted tripId replays, and the server says so.
  createTrip.mockResolvedValueOnce({
    ok: false,
    error: { status: 400, message: "A trip with this id already exists.", code: "trip-already-exists" },
  });
  // … walk the flow, press Create empty twice …
  expect(createTrip).toHaveBeenCalledTimes(2);
  expect(createTrip.mock.calls[0][0].tripId).toBe(createTrip.mock.calls[1][0].tripId);
  expect(onCreated).toHaveBeenCalledWith(expect.any(String), { navigate: false });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("a no-op rejection on a replayed command counts as landed, not as a failure", async () => {
  dispatch.mockResolvedValueOnce({ ok: false, error: { status: 0, message: "Network error" } });
  dispatch.mockResolvedValueOnce({
    ok: false,
    error: { status: 400, message: "This change would have no effect.", code: "no-op" },
  });
  // … retry … the wizard proceeds rather than reporting "setting dates failed".
  expect(screen.queryByText(/setting dates failed/i)).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter web test -- NewTripWizard -t "lost"` and `-t "no-op"`
Expected: FAIL — the first because `tripId` is not in the call at all, the second because `!result.ok` is the only thing `submit()` looks at.

- [ ] **Step 3: Let the route accept a client-minted id and return its code**

```ts
// A client may mint the id so a replayed create is the SAME trip rather than a
// second one (KI-2026-09-12-e: the browser cannot tell "committed but unheard"
// from "never committed"). `.uuid()` is the whole guard it needs — a replay of
// an id the caller minted collides with nothing, and an id someone else's trip
// already holds is refused by the access policy on every later command.
const CreateTripBody = z.object({ name: z.string().min(1).max(200), tripId: z.string().uuid().optional() });
```

…and return `{ error: result.error.message, code: result.error.code }` on the failure path, matching what the commands route at `[tripId]/commands/route.ts:31` already does.

**Correct the now-stale comment in `packages/contracts/src/trip.ts:50-53`**, which reads *"No client can forge it: `POST /api/trips` accepts a name and nothing else."* That sentence is about `forkedFrom` and stays true — zod strips unknown keys, so `forkedFrom` is still unforgeable — but its stated reason has changed. Say what is actually true now: the body accepts a name and optionally a `tripId`, and `forkedFrom` is not in the schema.

- [ ] **Step 4: Surface the code through `createTrip`**

Add `code: data.code` to the error branch at `apiClient.ts:81-84`, and take `tripId` in the input. **Do not touch the `try/catch`**: `apiClient.ts:41-51` records that every helper must resolve and never reject, and `apiClient.test.ts`'s "never rejects" suite enforces it.

- [ ] **Step 5: Teach `submit()` the two "already landed" codes**

Mint `tripId` once per sheet open (`crypto.randomUUID()`, already used at `:253`) and pass it on every create attempt. Then:

```ts
// "Already there" is success, not failure. The client cannot distinguish a
// committed-but-unheard write from one that never happened, so the server's own
// two verdicts are what settle it:
//   trip-already-exists — this exact id is ours, minted here; the create landed.
//   no-op               — the server already holds the value we are sending.
// Both mean "stop retrying and move on", and treating either as an error is the
// dead end KI-2026-09-08-a closed, reached through a different door.
```

Apply the same reading to `SetTripDates`, `SetTripBudget` and `SetTripCurrency` — **all three**, not just dates. `no-op` is universally safe here because these are set-commands: the rejection means server state already equals the request.

- [ ] **Step 6: Re-run, confirm green, then see them fail for your reason**

Run: `pnpm --filter web test -- NewTripWizard apiClient` → PASS, with the four pre-existing retry tests still green.

Then remove the `trip-already-exists` branch and confirm the lost-response test goes red naming a second `createTrip` call. Restore. Paste the failure text into the PR body.

- [ ] **Step 7: Prove the route half against a real database**

Run the integration lane for the trips route — a client-supplied `tripId` is honoured, a replay of it returns 400 with `code: "trip-already-exists"`, and an absent one still mints server-side. **Unit tests cannot show this**; the route's zod schema and the domain's rejection only meet in the integration lane.

- [ ] **Step 8: Narrowed check subset, then commit**

```bash
git add apps/web/src/app/api/trips/route.ts apps/web/src/lib/apiClient.ts \
        apps/web/src/components/home/NewTripWizard.tsx apps/web/src/components/home/NewTripWizard.test.tsx \
        packages/contracts/src/trip.ts
git commit -m "fix(new-trip): the retry survives a lost response, not just a rejection

Closes KI-2026-09-12-e. The client mints the tripId, so a replayed CreateTrip is
the same trip rather than a second one, and the server's own verdicts settle
what the browser cannot see: trip-already-exists and no-op both mean the write
landed. POST /api/trips now returns its error code, which the commands route
already did.

Not a contracts change: CreateTrip has always carried tripId — the route minted
it, and the route's own body schema is what withheld it from clients.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

---

### Task 6: The four Preview shells stop being shells

`preview-registry.ts`'s own rule: *"a shell's milestone tag is a claim that that milestone will wire it up. Retag when the claim stops being true; do not retag to make a gate box pass."* Two of these four are wired up outright. Two are **D-A** and **D-B** and their treatment depends on the answers.

**Files:**
- Modify: `apps/web/src/lib/preview-registry.ts`
- Modify: `apps/web/src/components/ui/preview.test.tsx` (`:74-80`)
- Modify: `apps/web/src/components/home/NewTripWizard.tsx` (any `<Preview>` left from Task 4)
- Modify: `.design-sync/handoff/DRIFT.md` (D11 at `:58`, and the open-questions list at `:299`)

**Interfaces:**
- Changes: `PREVIEW_REGISTRY`, and so the `PreviewId` union derived from it at `:116`.

- [ ] **Step 1: The two that are unconditionally wired up**

- **`wizard-pace-tags`** (`{ milestone: "M9", wiredUpBy: "Pace and tags exist only to feed the assistant's draft" }`) — turns 3 and 4 are real answer affordances now. **Remove.**
- **`wizard-assistant-draft`** (`{ milestone: "M9", wiredUpBy: "M9 proactive drafting" }`) — this is the fork, which is **out of scope here**. It does not become real in this plan. **Keep it, tagged M9**, and update its `wiredUpBy` to name what is actually outstanding: the entitlement fork and the generation (design §4), not "proactive drafting". Do not delete a shell for a capability that still does not exist.

**Note the correction:** the build constraint as briefed said all four *"become real answer affordances or the fork"*. Three become affordances; the fourth **is** the fork and the fork is out of scope, so its shell survives this plan. Removing it would move a false claim rather than remove one.

- [ ] **Step 2: `wizard-destination-chips` — conditional on D-A**

- **D-A answered "drop the label"** → remove the entry. The chips are real committing affordances and nothing about them is unbuilt.
- **D-A answered "keep 'Recent and nearby'"** → keep the entry at `unplaced`, keep the chip row `<Preview>`-wrapped, and leave `wiredUpBy` as it stands. A hardcoded list under that label is a fabricated note.

- [ ] **Step 3: `wizard-longer-chip` — conditional on D-B**

- **D-B answered "21 nights is intentional"** → `Longer` becomes a fifth length chip and the entry is removed.
- **D-B answered "2026-08-23 holds"** → the entry stays, and `Longer` stays inert. **Update `wiredUpBy`**, which currently reads *"Manual day-count entry beyond the four preset lengths. NOT blocked on a field"* — still true, but it should name the 2026-08-23 decision as the reason nothing wired it, so the next reader does not treat it as free work.

- [ ] **Step 4: The call site a plan written from memory misses**

`apps/web/src/components/ui/preview.test.tsx:74-80` uses `wizard-longer-chip` **as a fixture id** for "reserves space for the compact badge instead of overlapping the host", with a comment explaining it inherited the slot from `share-button` when M11 link 4 made Share real. If the entry leaves the registry, `PreviewId` narrows and **this test stops typechecking** — a compile error in a file that has nothing to do with the wizard.

Re-point it at a surviving compact-shell id and update the comment to record the second hand-off, the way it already records the first. **Run `pnpm --filter web typecheck` after this step specifically** — this is the failure mode the change creates.

- [ ] **Step 5: Confirm the registry's own guards still hold**

Run: `pnpm --filter web test -- preview-registry preview`

Three assertions must stay green, and each fails for a different reason:
- *"every used `<Preview id>` is registered"* — a shell left in the tree whose entry you removed.
- *"every registered id is used at least once (no orphans)"* — an entry kept whose `<Preview>` you deleted. Note this scans only code **reachable from a Next.js entry point**, so a shell in an unrendered file does not count.
- *"has no static city `<option>` list anywhere in src"* — fires if the destination chips became a `<select>`. They must stay buttons.

- [ ] **Step 6: Answer D11 in `DRIFT.md`**

`DRIFT.md:58` (D11) describes *"a five-turn scripted conversation"* and says all four shells *"survive as answer affordances on turns 1, 2, 4 and 5"*. Four turns, not five, and the fork's shell survives. Update the row, and record the `who` delta — `DRIFT.md` is owed it the way M11b recorded its two (design §11). `DRIFT.md:299`'s *"Resolve D11: drop the two `unplaced` wizard shells from the design, or get them a data source"* is answered by D-A and D-B; record which way.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/preview-registry.ts apps/web/src/components/ui/preview.test.tsx \
        apps/web/src/components/home/NewTripWizard.tsx .design-sync/handoff/DRIFT.md
git commit -m "chore(preview-registry): the wizard's shells stop being shells

Pace and tags are real answer affordances now. The destination chips and the
Longer chip follow their decisions (D-A, D-B). wizard-assistant-draft STAYS —
it is the entitlement fork, which this slice does not build, and deleting its
shell would move a false claim rather than remove one.

preview.test.tsx borrowed wizard-longer-chip as a compact-shell fixture; it
moves to a surviving id, as it once moved off share-button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

> **`.design-sync/**` is not prose.** It is a build input (`AGENTS.md`'s Tier 1 trap), so this commit keeps the branch Tier 2 regardless. The branch already carries code, so it was Tier 2 for life anyway — see the Verification section below.

---

### Task 7: Close the known issue and record what this slice does and does not claim

**Files:**
- Delete: `docs/known-issues/open/KI-20260912-e-newtripwizard-retry-cannot-survive-a-lost-response.md`
- Create: `docs/known-issues/resolved/KI-20260912-e-newtripwizard-retry-cannot-survive-a-lost-response.md`
- Modify: `docs/milestones/M9-ai-planning-partner.md` (the Exit gate at `:294`)
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Move the entry with `git mv`**

```bash
git mv docs/known-issues/open/KI-20260912-e-newtripwizard-retry-cannot-survive-a-lost-response.md \
       docs/known-issues/resolved/
```

`git mv`, not delete-and-create: KI-2026-08-30-d records that a squash-merged PR makes the next branch's `git mv` reappear as a duplicate in both directories with no conflict. A rename keeps that detectable.

- [ ] **Step 2: Append the resolution, and say which of the two options was taken**

The entry's own Scope line offers *"an idempotency key on the command envelope"* or *"reconciling against server state before retrying"*, and says the key would be a contracts change. **Record that the third reading is what shipped**, and why — `CreateTrip` already carried `tripId`, so no contract moved:

```markdown
- **Resolved 2026-09-15**, M9 plan 4, while `NewTripWizard.tsx` was being
  rewritten into a transcript. The client mints the `tripId`, so a replayed
  `CreateTrip` is the same trip rather than a second one, and `trip-already-
  exists` and `no-op` are both read as "the write landed" rather than as
  failures. **Not the contracts change this entry predicted:** `CreateTrip` has
  always carried `tripId` (`packages/contracts/src/trip.ts:46`) — the route
  minted it and the route's own body schema withheld it from clients, so the
  change is `apps/web`-local and needed no CHANGELOG entry. Regression tests:
  a lost create response followed by a replay, and a `no-op` rejection on a
  replayed `SetTripDates` (`NewTripWizard.test.tsx`), neither of which any
  previous test covered.
```

- [ ] **Step 3: Add the two gate boxes this slice bears on — unticked**

Design §7 grows M9's gate from ten boxes to eighteen, four of them for New trip. **Two of the four are this plan's**; the other two (*"a free account's entire flow makes zero model calls, asserted"* and *"the fork reads entitlements and never a plan rank"*) belong to the free-path and fork plans and are not added here. Add these, unticked — **a box is ticked at gate close, not when its code merges** (`TODO.md`'s standing rule, and the M9 file's own note at `:296-298`):

```markdown
- [ ] **Four answers produce a named, dated trip.**
      *(Implemented 2026-09-15, M9 plan 4 — the four-turn transcript. Dates
      come from the two date inputs; a length chip alone gives a day count with
      no arrival, and free text gives neither, because parsing it would be the
      model call §30.2 forbids. Confirm at the gate; do not rebuild.)*
- [ ] **Both exits stay open, and *Create with this* works from the first
      answer.**
      *(Implemented 2026-09-15, M9 plan 4. Confirm at the gate; do not
      rebuild.)*
```

- [ ] **Step 4: Check nothing still calls the KI open**

```bash
grep -rn "KI-2026-09-12-e\|KI-20260912-e" docs/ apps/ packages/ .design-sync/ --include=*.md --include=*.ts --include=*.tsx | grep -v resolved/
```

Expected: `.design-sync/handoff/DRIFT.md:264` (which cross-references it) and this plan. Update the DRIFT line; fix anything else that still calls it open.

- [ ] **Step 5: Update `docs/STATUS.md`**

Say where the work actually is: M9's first shippable slice has landed, what it does not include (the generation, the fork, the draft status, durability), and that the theme pass does not gate it. `STATUS.md` is the file every session reads first and the one this milestone's confusion was about — *"i dont really know what got built. Wheres my new trip builder ui?"*

- [ ] **Step 6: Commit**

```bash
git add docs/ .design-sync/handoff/DRIFT.md
git commit -m "docs: resolve KI-2026-09-12-e, and say what the four turns do not do

The new-trip sheet is four turns and produces a real trip. It does not generate
one, does not fork on entitlement, does not create a draft, and keeps nothing
across a reload — each of those is its own plan, and STATUS.md now says so
rather than leaving \"the new trip builder\" to mean all of them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V41cyiCnBLyGbCrU672qsF"
```

---

## Verification

**The branch carries code from Task 1 onward, so it is Tier 2 for the rest of its life** — a docs-only commit pushed onto it still re-runs the full suite, because GitHub evaluates `paths-ignore` against the whole PR diff on `pull_request` events (`AGENTS.md`, measured on #103 and again on #141).

- **Tier 2, per task:** the `minimal-check-subset` skill's output and nothing more. Record the subset in the PR body.
- **The one justified exception:** Task 1 Step 5 runs the full e2e lane mid-branch, because a mechanical migration across ten spec files can only be shown behaviour-preserving by the suite that exercises them. Say so in the PR body.
- **Tier 3, once, at final review:** `pnpm check`, plus `pnpm --filter web test:e2e:ci-like` because a user flow changed. **No `pnpm seed:verify`** — no contract field and no fixture changed (Task 5 changes a route's body schema, not a contract).
- **The browser walk.** *On the preview, what does a person click to see this?* Open **New trip**, answer four questions — one by chip, one by typing, one with the date inputs, one by picking nothing on `feel` — press **Change** on turn one, re-answer forward, then take both exits. That walk is the whole point of this slice; dispatch `phase-verifier`, which drives the PR's Vercel preview and needs no local infrastructure.
- **Every test in this plan is seen failing for its own reason before it counts** (CLAUDE.md rule 3). The PR template asks for the source edit and the real failure text; Tasks 2, 3, 4 and 5 each name the edit to make.

## What must not happen

- **No model call, and no network call, during the four turns.** If a task starts wanting one to interpret an answer, it is the wrong task: that is precisely what §30.2 designs out, and the cost lands on every abandoned sheet.
- **No `scrollIntoView` anywhere in this change**, including inside `Transcript` after Task 2. KI-2026-09-13-a is an open bug in that family.
- **`Transcript` does not learn the word "Change."** If the render prop feels awkward, the answer is a better prop, not a `changeable` flag — the assistant panel has no such affordance and never will.
- **No typing indicator, no artificial delay, no streaming** in the four turns. A fake delay to make it feel like a model is explicitly wrong.
- **No stepper and no progress bar.** The stepper is the element that made the sheet grow; a transcript shows its own progress.
- **Do not ship the design's `made` closing copy** (D-C). `pace` and `feel` are stored nowhere and nothing consumes them; a closing turn claiming the trip was built around them is a fabricated note.
- **Do not delete `wizard-assistant-draft` from the registry.** It is the fork, the fork is out of scope, and the registry's rule is that a tag is a claim — deleting the shell would move the false claim rather than remove it.
- **Do not weaken the four retry tests** at `NewTripWizard.test.tsx:190`, `:220`, `:276`, `:329`. They are KI-2026-09-08-a's regression cover; their setup changes, their assertions do not.
- **Do not add an arbitrary Tailwind value.** KI-2026-09-05-v already carries 128 line-level disables. Typography is plan 2's.
- **Do not build the deterministic free path here.** It needs the theme vocabulary that does not exist yet (design §4b), and this slice is clickable without it.
