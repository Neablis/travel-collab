### KI-2026-09-03-d — `macro` is an inline node in ProseMirror but the AST (and the AI compose path) put it at block position

- **Severity:** correctness, **unproven**. The divergence is measured; whether it produces a
  user-visible failure is not. That gap is the entry — see *What has NOT been checked*.
- **Area:** `packages/contracts/src/pageDoc.ts` (`PageNode`'s block union),
  `packages/contracts/test/fixtures/pageDocV1.ts` (`PAGE_DOC_V1_GOLDEN`),
  `apps/web/src/server/ai/pageTools.ts` (`MacroBlock` and `toPageContent`),
  `apps/web/src/components/pages/editor/MacroNodeExtension.ts`.
- **What is wrong:** `MacroNodeExtension` declares `group: "inline", inline: true`, and it was
  measured — `doc.contentMatch.matchType(schema.nodes.macro) === null`, i.e. ProseMirror's
  `doc` node does **not** accept a `macro` as a direct child. Three things nonetheless place
  one there:
  - `PageDoc`'s block union accepts `macro` at top level;
  - `PAGE_DOC_V1_GOLDEN` contains a top-level `macro`;
  - **the live AI compose path writes them**: `pageTools.ts`'s `MacroBlock` is one of the
    three block shapes, and `toPageContent` emits it as a direct child of `doc`.
- **Why it matters, and why it is the wrong direction:** ADR-038 decision 4 makes our parser
  the gate — a document that does not round-trip opens read-only. That is safe when our
  parser is *stricter* than the editor. Here it is **looser**: the AST blesses a shape the
  editor's schema does not declare valid. If ProseMirror rejects it at mount, the measured
  behaviour from ADR-038 applies — TipTap discards the **entire document** and autosave
  persists the empty one — and our parser would have said the document was fine.
- **What has NOT been checked, and is the whole job here:** whether ProseMirror actually
  rejects a top-level `macro` at mount. `Node.fromJSON` does **not** content-check, so it may
  well pass silently and this may be inert. The test is the same shape as the one that found
  the discard behaviour: build a doc with a top-level `macro`, mount it in `PageEditor`, type
  a character, read `onChange`. **Do that before changing any schema** — the fix differs
  completely depending on the answer.
- **Fix path, once measured.** If it is inert: document that `doc` tolerates inline children
  in practice and close this. If it is not: the wrong end to change is the AST — narrowing
  the block union would break the golden and every AI-composed page already stored. The
  likely fix is that `toPageContent` should wrap a macro block in a paragraph, plus a v2
  migration doing the same for stored documents.
- **Why it was left:** found while widening the AST (ADR-038 amendment). Narrowing the union
  there would have broken the v1 golden and collided with the settled decision not to touch
  the `macro` discriminator, and the measurement it needs is a task of its own. Recorded
  rather than guessed at.
- **Cross-reference:** `ADR-038` (the amendment section, and decision 4),
  `ADR-037` decision 8 (a widget's name is a stored identifier), `KI-2026-09-03-c` (resolved).
- **First noted:** 2026-09-03, widening `PageDoc` to the real v1 vocabulary.
