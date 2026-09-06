### KI-2026-09-06-d — RESOLVED 2026-09-06 — repeat widgets render as tables

**Resolved by Mitchell's decision, same day:** *"These were always meant to be
tables with columns, and styled, attaching design, just build it, no need for a
ADR."*

Both blockers below turned out to be answerable without the ADR this entry
asked for, and the second one was **wrong**:

1. **The inline-node blocker is real and was routed around, not removed.** A
   `<table>` inside a `<p>` still breaks hydration exactly as `<div>` does. The
   table is built from `display: table` / `table-row` / `table-cell` on spans
   (`.tc-widget-table`, globals.css) with `role="table"/"row"/"rowheader"/"cell"`
   carrying the semantics the tags cannot. Real column alignment, no block
   element.
2. **The "no cell model" blocker was a mistake in this entry.** The cell model
   already existed: `RepeatRow` has always been `{ lead, values }`. It was the
   RENDER SEAM that threw the boundary away — `renderRows` flattened it to
   `Seg[]` — so the columns looked absent when they were only discarded one
   step before use. Preserving the split (`RenderedRow`) was a change to one
   shared function, not a new concept in the document.

`RepeatRow.kind` was added for `"header" | "total"`, which `rows.ts`'s own
comment had argued against; that comment is corrected in place. The argument
held while a repeat was a list of lines and stopped holding the moment a
renderer had to keep a group header out of the value column.

The original entry follows, including the reasoning that was wrong, because the
mistake is the useful part: *a missing model and a discarded one look identical
from the far side of a seam.*

---

### (original) a repeat widget cannot render as a real table: it is an inline node, and its rows have no columns

- **Severity:** design gap. The rows render correctly; they do not render as the design's table.
- **Area:** `apps/web/src/components/pages/MacroView.tsx:188-195` (the `rows` case); `packages/pages/src/macros/primitives/rows.ts:124-133` (`Rendered.rows` as `Seg[][]`, and the recorded refusal to widen it).
- **The request:** Mitchell, 2026-09-06 preview, on `day.rows`: *"This also doesnt look like the design, these should literally be a table"*.
- **Two independent blockers, and the first is the harder one.**
  1. **A widget node is inline, inside a `<p>`.** `MacroView`'s own comment records this being measured: *"In HTML, `<div>` cannot be a descendant of `<p>`. This will cause a hydration error."* — which is why the rows are `role="list"` spans with `display: block` rather than `<ul>`/`<li>`. A `<table>` is a block element and the HTML parser closes the paragraph at it identically, so a literal `<table>` is unavailable for exactly the reason `<div>` is. Making block widgets real block nodes is a ProseMirror **schema** change and runs into ADR-035's "one node type, not two".
  2. **The rows have no columns to put in cells.** `Rendered.rows` is `Seg[][]`, and a `Seg` is a heterogeneous text-or-chip fragment, not a field: one row of `day.rows` is text + chip + text + chip, and a header row (`headerRow`) is a single label segment. Rendering seg-per-cell would produce ragged columns that align nothing. A table needs a cell model, which is precisely what `rows.ts:127-131` declines to push through the render seam — *"Giving `RepeatRow` a `kind` would push a grouping concept through the render seam and into `apps/web` for one widget's benefit"*.
- **The one thing that is available cheaply, and why it is not enough on its own:** CSS `display: table` on the existing spans would give true column alignment without any block element, sidestepping blocker 1. It does not touch blocker 2 — without a cell model there is still nothing to align.
- **What would actually resolve it:** an ADR extending the widget render contract with a cell/column model (an ADR-039 follow-up), which then makes the CSS-table rendering meaningful. Both blockers, in that order.
- **Cross-reference:** `docs/design-feedback/2026-09-06-preview-ui-feedback.md` finding 6.
- **First noted:** 2026-09-06.
