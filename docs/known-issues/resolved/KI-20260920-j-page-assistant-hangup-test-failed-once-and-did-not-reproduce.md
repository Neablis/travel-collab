### KI-2026-09-20-j — the assistant's "hangs up on a turn in flight" test failed once in a full-directory run and has not reproduced — RESOLVED

- **Severity:** unknown, and that is the entry. Either a real race in the
  hang-up path or a scheduling artefact of running twelve files together. One
  observation is not enough to say which.
- **Milestone:** **M9, carried (assigned 2026-09-24, KI pass)** — owned by M9, not a gate box. Parked under Mitchell's 2026-09-01 rule that every open AI known issue belongs to M9; filed after that audit, so it had no owner until now. Listed in `docs/milestones/M9-ai-planning-partner.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/components/pages/PageAssistant.test.tsx` → *"hangs up
  on a turn in flight when the assistant is closed"*.

- **Symptom / What happens:** one run of
  `vitest run -c vitest.unit.config.ts src/components/pages` reported
  `1 failed | 145 passed`, that test being the failure. The same file run alone
  immediately afterwards passed 10/10, and a repeat of the full directory run
  passed 146/146.

- **How it was found:** incidentally, during PR #198 (the widget rail), in the
  scoped subset for a change that touches **none** of the assistant path —
  `WidgetPicker.tsx`, its test, and an e2e spec. Recorded rather than dropped
  because a failure seen once and then explained away is how a real race earns
  another six months.

- **RULE 2 WAS FOLLOWED AND FOUND NOTHING.** `docs/known-issues/open/` was
  grepped for the symptom before calling it anything; the only hit was
  `KI-20260907-d`, which is about where the verification loop runs, not about
  this test. So this is a new observation, not a known one.

- **What the repo's own rule says about it, and why that is not conclusive
  here.** `CLAUDE.md` rule 2: *"a failure whose location moves between runs is a
  timeout; a real defect fails in the same place every time."* This failed in
  the same place — but only once, so the rule's discriminator does not apply.
  **What distinguishes the two cases is isolation**: it failed only when twelve
  files shared a worker and passed alone, which is the signature of a test whose
  timing depends on the machine rather than on the code.

- **What it would take:** run that file under load in a loop
  (`vitest --repeat`, or the whole directory a dozen times) and see whether it
  comes back. If it does, the hang-up path's cancellation is worth reading
  closely — a turn in flight being cancelled as the component unmounts is
  exactly the shape that races. **Do not "fix" it by adding a wait**; that
  converts a race into a slower race.

- **Deliberately not chased in PR #198.** That PR is a widget rail; the
  assistant is not in its diff, and chasing a one-off there would have widened
  it for something it did not cause.

- **Resolved 2026-09-24 — a test bug, not a race in the hang-up path.**
  Reproduced under load: three concurrent `vitest run -c vitest.unit.config.ts
  src/components/pages` runs with the test at `{ repeats: 60 }` failed it in
  3/3, as did its sibling *"refuses a turn's insert once the page has left
  Editing"*, both with `expected "vi.fn()" to not be called at all, but
  actually been called 1 times` — and the one PATCH carried the page's own
  unchanged `"Notes"`, not the turn's insert. On demand: a 1 s wait after
  `openRail()` fails it 3/3 on an idle machine. **Mechanism:** entering Editing
  runs `PageEditor`'s `editor.setEditable(true)`, which emits tiptap's `update`
  (`@tiptap/core` 2.27.2, `emitUpdate` defaults to true), which reaches
  `PageScreen`'s 800 ms autosave debounce — so `onUpdate` stays uncalled only if
  the test finishes inside 800 ms. Confirmed by passing `emitUpdate: false`
  (temporarily): the delayed reproduction went green. The abort, the identity
  guard and the insert refusal were correct throughout. **Fix:** the three
  `expect(onUpdate).not.toHaveBeenCalled()` assertions in
  `PageAssistant.test.tsx` (the third, the page-error test, had the same latent
  window) now assert what they meant — every save is the page as opened
  (`expectOnlyUnchangedSaves`). **Proof:** the 1 s-delay reproduction is 3/3
  red before and 3/3 green after; the 3×-concurrent directory run with 60
  repeats no longer fails either test; with `useAskThread`'s per-frame identity
  guard removed (and a wait past the debounce) the new assertion goes red on
  `"Bring a raincoat"`. Unrelated: the no-op autosave on every Reading/Editing
  toggle is a real (harmless-content) PATCH, reported, not changed here.
- **Superseded the same day: the fix moved from the test to the cause.** The
  test-side helper above accepted "unchanged" saves, which left the product
  sending a pointless PATCH on every Reading/Editing switch (and once on mount).
  `PageEditor.tsx` now calls `setEditable(editable, false)` — `emitUpdate: false`,
  the same rule the file already states for `setContent` — so a mode switch is
  not an edit, and `PageAssistant.test.tsx` is back to its strict
  `expect(onUpdate).not.toHaveBeenCalled()`. **Proof:** a new
  `PageEditor.test.tsx` case, *"does not report a change when the document
  merely becomes editable"*, failed before the fix with `expected "vi.fn()" to
  not be called at all, but actually been called 2 times` (mount + switch) and
  passes after. With a temporary 1s wait after `openRail()` in the PageAssistant
  tests (the on-demand reproduction), the strict file passes 11/11 with the fix;
  reverting only the `false` makes the three strict assertions fail with
  `called 1 times`. `components/pages/` 159/159, web typecheck and eslint clean.
