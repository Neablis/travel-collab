### KI-2026-09-05-a — the caret parks behind a block widget instead of selecting it — RESOLVED

- **Severity:** defect (user-visible, and it makes a block widget feel unselectable —
  the reader clicks it, sees a text cursor appear *behind* the card, and has no obvious
  way to delete or move the widget).
- **Area:** `apps/web/src/components/pages/editor/MacroNodeExtension.tsx` and the node
  view it renders — the ProseMirror selection behaviour of a `macro` node whose rendered
  output is a block (`day.detail` wide, `city.detail`, `costs`-shaped payloads).
- **What is wrong:** a widget node is an **inline atom** (ADR-035: "one node type, not
  two"), so ProseMirror places a text cursor in the paragraph position it occupies. When
  that atom renders as a bordered table taking its own visual line, the caret is drawn as
  a vertical bar *behind* the card rather than as a node selection around it. Clicking
  the card should produce a `NodeSelection`; today it produces a `TextSelection` beside
  one.
- **Reported:** Mitchell, on the PR 141 preview (2026-09-04): *"We still have the weird
  bug where the cursor vertical bar sits behind a block, it should select the block
  instead."* The "still" is accurate — it predates ADR-039 and was visible on the M14
  builder-half preview against `itinerary.trip`, which is `day.detail{}` now.
- **Why it is filed rather than fixed here:** the honest fix is one of two things, and
  both are decisions rather than patches. Either the node view opts into node selection
  for block-shaped widgets (`selectable: true` plus a click handler that dispatches a
  `NodeSelection`, and a visible selected state that is not the `ring-2` an inline atom
  gets), or block widgets stop being inline atoms — which is the **block-level editor
  node** the M14 gate already records as unowned, with a `PageDoc` migration behind it
  (ADR-038 makes the document a versioned AST precisely so that is possible). Picking
  the first inside a PR about the widget vocabulary would quietly foreclose the second.
- **Fix path:** decide the node-shape question first (it is on M14's gate as "the
  block-level editor node block widgets actually want"). If the answer is "stay inline",
  the selectable-node-view change is small and local, and wants an e2e assertion that
  clicking a block widget yields a node selection rather than a caret. If the answer is
  "a real block node", this resolves as part of that migration.
- **Cross-reference:** `docs/milestones/M14-rich-layer.md` (the unowned block-node box),
  ADR-035 decision 1, ADR-038, Vercel toolbar thread `khxE1i54SgN4`.
- **First noted:** 2026-09-04, on the PR 141 preview.
- **2026-09-05 overnight review — shares one cause with KI-2026-09-05-c:**
  stream B's read of the widget layer concluded that this entry and
  KI-2026-09-05-c (the inline chrome row) are two symptoms of the same thing —
  the macro node is an **inline atom** in ProseMirror while the AST treats it as
  a block (the shape recorded in resolved KI-2026-09-03-d) — and that
  KI-2026-09-05-b (the unreachable Reading/Editing toggle) is unrelated to
  both. Fixing the atom's node spec is expected to move both. Context:
  `../../reviews/2026-09-05-overnight-review/README.md` §"B — Notebook and widget AST".

---

- **Reproduced in a real browser before fixing, and the entry's stated mechanism did
  not survive it.** A throwaway Playwright walk against a production build (insert
  `day.detail` into Trip Overview, then probe `window.getSelection()` and
  `getBoundingClientRect()` after each interaction) measured, in order:
  ```
  CONTROL caret in ordinary prose   rangeRects [[474.09, 231.59, 0, 18]]        selectedNodeEls 0
  A  right after inserting          rangeRects []   caretRect [153, 326.08, 0, 18]  selectedNodeEls 0
                                    widgetBox [153, 262.89, 640, 54.19]
  B  click the card's value         collapsed false                             selectedNodeEls 1
  D  click a chrome select          collapsed false                             selectedNodeEls 1
  E  click the card's empty edge    collapsed false                             selectedNodeEls 1
  ```
  Two of the entry's three claims are **false on the current build**:
  1. *"Clicking the card should produce a `NodeSelection`; today it produces a
     `TextSelection` beside one."* It produces a `NodeSelection` — every click on
     the card (B, D, E) put `.ProseMirror-selectednode` on the node's outer element
     and left the selection uncollapsed. ProseMirror's own `selectClickedLeaf`
     already handles an inline atom, and nothing here overrides it.
  2. *"a text cursor appear[s] **behind** the card."* The only caret in play is the
     one the insert leaves at the paragraph position after the atom, and it is
     measured at `y = 326.08` against a card occupying `y = 262.89 … 317.08` — nine
     pixels **below** the card, i.e. on the trailing line of the same paragraph.
     The `display: block` rule in `globals.css` (the previous caret fix) had already
     taken it out of the card's line box; the entry describes the state before it.
- **What WAS reproducible is the entry's severity line** — *"it makes a block widget
  feel unselectable … no obvious way to delete or move the widget."* The cause is not
  the selection; it is the feedback. `MacroNodeView` painted the selected state as
  `ring-2` on `NodeViewWrapper`, an inline `<span>`, while the card it wraps is a
  block box. A ring on an inline box is painted **per line fragment**: measured on a
  selected `day.detail`, `innerDisplay: "inline"` inside `outerDisplay: "block"`, and
  the ring rendered as two stubs at the card's left and right edges instead of an
  outline around it. So ProseMirror selected the node and said so in a way nobody
  could read, and the stray caret below the card was the only visible response to a
  click.
- **Fix (2026-09-05):** `apps/web/src/components/pages/editor/MacroNodeView.tsx` gives
  a `block`/`repeat`-shaped widget's wrapper the same block display its outer element
  already has, so the ring has a box the shape of the card to hug. `single` keeps the
  inline ring — it IS a word in a sentence (SPEC §7) and a ring around the word is
  right. The shape lookup moved into one exported `macroShape()` beside the node view,
  which `MacroNodeExtension.ts` now also uses for its `data-macro-shape` attribute, so
  the attribute and the ring cannot disagree about what shape a widget is. No layout
  moved: re-running the same probe after the fix returned byte-identical geometry for
  every box (`innerBox` and `outerBox` both `[153, 262.89, 640, 54.19]`), with
  `innerDisplay` now `block`; the screenshot goes from two edge stubs to a closed
  rounded outline around the card.
- **Regression test:** `apps/web/src/components/pages/editor/MacroNodeView.test.tsx`
  renders one `block` and one `single` widget, dispatches a real `NodeSelection` at
  each, and compiles `globals.css` with Tailwind for the exact classes the node view
  wrote — asserting the block widget's selected classes resolve to `display: block`
  **and** a `box-shadow`, and the single widget's to a `box-shadow` and *not*
  `display: block`. **Proven to fail for its own reason**, not assumed: dropping the
  `block` class from the node view turns it red with
  `AssertionError: expected ' --tw-ring-shadow: var(--tw-ring-inse…' to contain 'display: block'`;
  restored, 1/1 passes.
- **Verified:** `pnpm --filter web typecheck` and `pnpm --filter web lint` clean; the
  four page-editor unit files 37/37 (`vitest run -c vitest.unit.config.ts
  MacroNodeView.test.tsx MacroNodeExtension.test.ts PageEditor.test.tsx
  WidgetChrome.test.tsx`); `e2e/m14-notebook-widgets.spec.ts` 7/7 against a real
  `pnpm build`.
- **Left open deliberately:** the caret can still park on the trailing line of a
  paragraph a block widget fills, because the macro node is still an inline atom.
  That is the block-level editor node on M14's gate (ADR-038's `PageDoc` migration),
  which this entry already said was the honest fix and already declined to make here.
  Nothing about the node's shape in the schema changed.
- **First noted:** 2026-09-04, on the PR 141 preview. **Resolved:** 2026-09-05 (KI sweep).
