### KI-2026-10-24-g — a page that holds a widget whose macro was removed cannot be saved (400 Unknown macro)

- **Severity:** correctness. Every later edit to that page is refused until the widget is
  deleted by hand, and the error does not say which widget.
- **Area:** `packages/pages/src/writeCheck.ts` (about line 40,
  `Unknown macro "<name>" is not in the registry.`); the page save route that runs it.
- **Symptom / What happens:** a page saved with a widget whose macro was later taken out of the
  registry (M52's dropped `assistant.prompts` *Ask* widget, on preview data from part 8's earlier
  heads) answers every save with 400 `Unknown macro "<name>"`.
- **Why not fixed here:** prose-only part 0, and no production page holds that macro (it never
  merged). Fix direction: the write check should refuse only a macro this save **adds**, and let
  an existing node it no longer knows through (`MacroView` already draws an unknown macro as *this
  widget isn't available in this version*). Or, when a macro is retired, keep a tombstone in the registry that renders nothing
  and passes the check.
- **Cross-reference:** KI-2026-09-24-d (the page write check's other leftovers).
- **First noted:** 2026-10-24, M52 part 8 preview.
