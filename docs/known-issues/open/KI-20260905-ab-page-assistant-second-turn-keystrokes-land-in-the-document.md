### KI-2026-09-05-ab — `PageAssistant.test.tsx`'s two multi-turn tests fail locally: the second question is typed into the notebook document instead of the composer

- **Severity:** test reliability — **confirmed, and it is a test-environment defect rather than a product one so far**. Two tests fail; nothing user-visible is established. The cost is that the two tests which prove the notebook assistant holds a *conversation* — the whole reason M14 link 8 replaced `ComposePanel` with a rail — are red locally and therefore prove nothing to anyone working in that file.
- **Area:** `apps/web/src/components/pages/PageAssistant.test.tsx`, tests *"accumulates a second turn instead of replacing the first"* (line ~135) and *"posts the whole conversation back on the second turn, assistant turns included"* (line ~160). The code under them is `apps/web/src/components/pages/PageScreen.tsx`'s `page-inserts` handler — `editorRef.current?.chain().focus().insertContent(...)` — and `apps/web/src/components/pages/editor/PageEditor.tsx`.
- **Symptom / What happens:** both tests run one turn, assert its insert landed, then type a **second** question into the rail's composer. The second question never reaches the composer. Captured from the failure's own DOM dump:

  ```
  # the composer, after userEvent.type(composer, "One more thing{Enter}")
  <input placeholder="Ask AI to add to this page…" value="O" />

  # the ProseMirror document, same render
  <div class="tiptap ProseMirror ProseMirror-focused" contenteditable="true">
    <p>Bring a raincoat</p>
    <p>ne more thing</p>
  ```

  The composer keeps the **first** character and the editor swallows the rest; in the second failing test all of `One more thing` lands in the document and the composer is left empty. `askAssistant` is therefore called once, not twice, and the assertions fail as `TestingLibraryElementError: Unable to find an element with the text: And a power adapter` and `AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times`.

  The discriminator that names the mechanism: the seven tests in this file that pass are the ones that type **once**; the two that fail are exactly the two that type again **after** an insert. `insertContent` goes in through `.chain().focus()` (deliberately — a click, a drop and the assistant all share one placement path), which leaves focus in ProseMirror. `userEvent.type` clicks the composer and gets one keystroke in before focus is pulled back to the editor.

- **Reproduction** — deterministic here, not intermittent:

  ```
  pnpm --filter web exec vitest run -c vitest.unit.config.ts src/components/pages/PageAssistant.test.tsx
  # Tests  2 failed | 7 passed (9)
  ```

  Run four times in a row, same two tests, same assertion each time. Reproduced in the **main checkout on a clean tree at `f7d2122`** as well as in a feature worktree, so it is not this branch's and not the SPEC §23 work. Node v26.4.0 locally; CI is Node 22, where these two are believed to pass — that gap is the most likely reason this has gone unrecorded, and it is **not** the same thing as KI-2026-09-02-a (which is `window.localStorage` under Node 26 and fails different files).
- **Why not fixed here:** found while wiring SPEC §23's Ask pill onto `PageScreen`, whose declared scope was the pill and the sheet. The fix is a change to how these two tests drive the composer (or to focus handling after an insert), and both are a different question from the one that turned this up — the second especially, since `.focus()` in the insert chain is load-bearing product behaviour with its own reasoning in `PageScreen.tsx`.
- **Suggested next step:** decide first **which layer is wrong**, because the two answers are very different sizes:
  1. *The test is wrong.* Focus the composer explicitly before the second turn (`await userEvent.click(composer)` immediately before, or `userEvent.type(composer, …, { skipClick: false })` re-fetched from the DOM rather than reusing the node captured before the first turn). Cheap, and it keeps the claim.
  2. *The product is wrong.* If a real user typing into the composer straight after an assistant insert also loses their keystrokes to the document, this is KI-worthy on its own terms and the test is reporting a genuine defect. **Check this before doing (1)** — silencing a true failure is the expensive mistake here, and this is exactly the shape of it: a test that looks flaky because a race decides which of two elements has focus.
  Confirm on Node 22 either way, so the CI-vs-local gap is measured rather than assumed.
- **Cross-reference:** KI-2026-09-02-a (the other Node-26-only local failure, different files, different cause); ADR-035 decision 5 (insert-shaped page tools, which is why the insert focuses the editor at all); `docs/guidelines/testing.md` rule 3 — these two tests were presumably seen to fail and pass when written, which is what makes their going red *later* worth an entry rather than a shrug.
- **First noted:** 2026-09-05, wiring SPEC §23's Ask pill onto `PageScreen`; the failures were already there before the first line of that change and are still there with it reverted.
