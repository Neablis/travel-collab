### KI-2026-09-05-a — the caret parks behind a block widget instead of selecting it

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
