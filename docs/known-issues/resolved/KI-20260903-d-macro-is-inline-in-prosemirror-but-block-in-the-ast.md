### KI-2026-09-03-d — `macro` is an inline node in ProseMirror but the AST (and the AI compose path) put it at block position — **RESOLVED 2026-09-03: measured, inert, nothing changed**

- **Severity:** correctness, **was unproven and is now measured to be inert.**
  The divergence is real and remains; it does not produce a user-visible
  failure, and the schema was left alone.
- **Area:** `packages/contracts/src/pageDoc.ts` (`PageNode`'s block union),
  `packages/contracts/test/fixtures/pageDocV1.ts` (`PAGE_DOC_V1_GOLDEN`),
  `apps/web/src/server/ai/pageTools.ts` (`MacroBlock` and `toPageDoc`),
  `apps/web/src/components/pages/editor/MacroNodeExtension.ts`.
- **What was wrong:** `MacroNodeExtension` declares `group: "inline",
  inline: true`, and ProseMirror agrees `doc` does not accept one as a direct
  child — `doc.contentMatch.matchType(schema.nodes.macro) === null`. `PageDoc`'s
  block union, the v1 golden and the live AI compose path all put one there.
- **The measurement this entry asked for, done 2026-09-03.** The test is the
  shape the entry specified: build a doc with a top-level `macro`, mount it in
  `PageEditor`, type a character, read `onChange`. Both results are now pinned
  in `apps/web/src/components/pages/editor/PageEditor.test.tsx`, *"PageEditor
  given a macro at block position (KI-2026-09-03-d)"*.

  1. **It is inert on the path that matters.** The document mounts with **no
     warning**, the macro's NodeView renders (`<span class="react-renderer
     node-macro">` is in the DOM), and `getJSON()` returns the macro still at
     block position, unchanged, alongside the user's own edited paragraph.
     `Node.fromJSON` does not content-check, so there is no `RangeError` for
     TipTap to catch and therefore no fallback to an empty document. This is
     **not** the ADR-038 discard behaviour, and the feared direction — our
     parser blessing a shape the editor rejects — does not materialise.
  2. **ProseMirror's own checker does reject it.** `editor.state.doc.check()`
     throws `RangeError: Invalid content for node doc: <paragraph("…"), macro>`.
     Nothing in the production path calls `check()` — it is a debug assertion —
     which is precisely why (1) holds. That is the latent part, and it is
     pinned by its own test rather than left as folklore: a ProseMirror or
     TipTap release that starts checking content on load would turn this shape
     into the whole-document discard, and that test is where it would surface.
- **Why nothing was changed.** The entry's fix path said "if it is inert:
  document that `doc` tolerates inline children in practice and close this."
  It is inert. Beyond that, the speculative fix was measured to be actively
  harmful: flipping `MacroNodeExtension` to `group: "block", inline: false`
  makes *"preserves an existing macro node through load and edit"* fail — the
  inline macro inside a paragraph, which is the common case and the one every
  stored page uses, stops surviving the round trip. Narrowing the AST's block
  union instead would have broken the v1 golden and every AI-composed page
  already stored, which is why the entry was filed rather than guessed at.
- **What the guard does about it.** Nothing, and deliberately.
  `inspectStoredPageDoc` (ADR-038 decision 4) compares a document's node
  *vocabulary* against the editor's schema; it does not reproduce ProseMirror's
  content expressions, for the same reason `pageDoc.ts` does not — position
  rules are something the editor repairs, and rejecting them would lock pages
  over a defect that costs nothing. A top-level `macro` is `mountable`, which
  the measurement says is the truth.
- **Cross-reference:** `ADR-038` (the amendment section, and decision 4),
  `ADR-037` decision 8 (a widget's name is a stored identifier),
  `KI-2026-09-03-c` (resolved).
- **First noted:** 2026-09-03, widening `PageDoc` to the real v1 vocabulary.
  **Resolved:** 2026-09-03, in the editor-integration PR.
