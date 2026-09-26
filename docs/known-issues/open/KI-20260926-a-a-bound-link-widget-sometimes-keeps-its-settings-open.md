### KI-2026-09-26-a — right after a link widget is bound, the first click into the page sometimes leaves its settings open

- **Severity:** minor (a click that does nothing, once; the second one works).
- **Milestone:** M30, carried. Found by `e2e/m30-notebooks-and-links.spec.ts`.
- **Area:** `apps/web/src/components/pages/editor/useSelectionReport.ts`, `PageScreen`'s
  selection queue (`winningReport`), `LinkTargetPicker` / `FieldPicker`.
- **Symptom / What happens:** insert "Link to a notebook or tab" from the rail, pick a
  notebook in its settings (by Enter or by clicking the option), then click a heading in
  the page. In 3 of 8 `--repeat-each` runs (2026-09-26, production build) the settings
  panel stayed on the link widget and the caret did not reach the heading: the walk's
  following `End`/`Enter` made no new paragraph. It always fails at that one step and
  nowhere else, so it is a defect and not a timeout (CLAUDE.md rule 2).
- **Not the cause, checked:** the notebook list landing (the card already shows the
  notebook's first line before the click), and the pick being a keypress (a click on the
  option fails the same way). The same click after binding a *field* widget from the
  same combobox (`m14-notebook-widgets.spec.ts`, "a field the reader picks…") has not
  been seen to fail — the difference that remains is that a link turns from an inline
  ghost into a block card when it is bound.
- **Worked around in the walk, not in the product:** the M30 spec clicks until the panel
  lets go, with this entry named at the line. A person clicks again.
- **First noted:** 2026-09-26, M30.
