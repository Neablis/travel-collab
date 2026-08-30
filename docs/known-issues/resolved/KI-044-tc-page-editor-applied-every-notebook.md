### KI-44 — `.tc-page-editor` is applied to every notebook page and defined nowhere — RESOLVED

- **Severity:** cosmetic (every notebook page renders with no typography)
- **Area:** `apps/web/src/components/pages/editor/PageEditor.tsx:41`,
  `apps/web/src/app/globals.css`
- **Symptom (as filed):** `<EditorContent editor={editor}
  className="tc-page-editor" />` was the only occurrence of that class name in
  `apps/web/src` — there was no matching rule in `globals.css` or anywhere
  else. With Tailwind's preflight reset in force and nothing restoring it,
  `heading`, `paragraph` and list nodes all rendered at the same size and
  weight. On the seeded "Trip Overview" page, the `<h2>` "Overview" was
  visually identical to the sentence beneath it.
- **Why it went unnoticed:** the class *looks* intentional at the call site, and
  no test asserted rendered type scale. `PageEditor.test.tsx` covered behaviour,
  not appearance.
- **Reproduction (2026-08-26):** compiled the real `globals.css` with the real
  Tailwind 4.3.2 compiler and asked which declarations reached the editor's
  nodes. The compiled sheet contained **no `.tc-page-editor` rule at all**, and
  the only rule matching the editor's `<h2>` was preflight's
  `h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit }` —
  nothing matched its `<p>` at all, and `ol, ul, menu { list-style: none }`
  removed list markers too. Rendering `PageEditor` with the seeded
  `trip-overview` template confirmed the DOM side: TipTap emits bare elements
  with no class attribute —
  `<div class="tc-page-editor"><div class="tiptap ProseMirror"><h2>Overview</h2><p>What's this trip about? …</p>…`
  — so both nodes inherited body's 14px/400 and were pixel-identical.
- **Fix (2026-08-26):** defined the rule in `globals.css`'s `@layer components`.
  `h1`–`h6`, `p`, `ul`/`ol`/`li` are `@apply`ed from the *same* utilities
  `Heading` (`components/ui/heading.tsx`) and `Text` (`components/ui/text.tsx`)
  use — `font-display text-2xl/xl/lg/md`, `text-base text-ink` — so the editor
  and the rest of the app share one type scale and cannot drift; h4–h6 collapse
  onto `Heading level={4}` rather than inventing a fifth step. The column gets
  `max-w-measure` (design-system.md's prose tier), left-aligned so it stays
  flush with the page title, because `PageScreen` mounts the editor in a
  default 1120px `PageContainer`. Spacing is Tailwind's own 4px grid and
  nothing else. This is deliberately *only* the missing type — the Notebook
  redesign is audit finding C1, routed to a later milestone by
  `docs/plans/M10-delta/phase-9-gate.md`.
- **Proof:** the same compile now emits eleven `.tc-page-editor` rules;
  `h2` resolves to `font-size: var(--text-xl)` (24px) `font-weight:
  var(--font-weight-semibold)` against `p`'s `var(--text-base)` (14px), and
  `ul` to `list-style-type: disc`. Two regression tests were added to
  `PageEditor.test.tsx` (`PageEditor typography (KI-44)`): they render the
  editor, compile the real `globals.css`, and use `Element.matches()` against
  the real emitted DOM to assert every node type the editor produces is matched
  by a rule and that the heading's and paragraph's font sizes differ. Confirmed
  failing on the pre-fix `globals.css` (`expected 0 to be greater than 0`;
  `expected '' to contain 'list-style-type: disc'`) and passing after —
  `PageEditor.test.tsx` 4/4, `src/components/pages` 19/19, `tsc --noEmit`
  clean, `eslint` clean, color wall OK.
- **What a browser would still have to confirm:** jsdom applies no stylesheets
  and does no custom-property substitution, so no unit test can assert computed
  pixels here. The evidence is CSS-level (the rules exist and resolve to
  distinct tokens) plus DOM-level (the selectors match the nodes TipTap emits).
  The final visual read of the Notebook surface belongs to a real browser.
- **Cross-reference:** the broader Notebook gap is C1 in the audit; this was the
  one piece of it that was a plain bug rather than unbuilt design.
- **First noted:** 2026-08-26 (design-sync UI audit, A3). **Fixed:** 2026-08-26.
