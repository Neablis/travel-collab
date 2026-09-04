import type { CostsTablePayload } from "@tc/pages";

// Read-only block: renders the cost breakdown from the resolver payload only.
//
// **It was a real `<table>`, and that was the worst of the three block widgets.**
// A widget node is an inline atom, so this renders inside a paragraph — and a
// `<table>` there is not merely unusual markup: the HTML parser hoists it out of
// the paragraph entirely, so the server's DOM and the client's disagree about
// the shape of the document, not just its nesting. Found by Copilot on PR 139,
// the same defect class already measured on the repeater's rows.
//
// The DS `Table` primitives are therefore NOT used here, which is a deliberate
// deviation rather than an oversight: they emit `<table>`/`<tr>`/`<td>`, and
// there is no valid way to put those inside a paragraph. The ARIA table roles
// carry the same semantics — a screen reader still hears a table with rows and
// cells — on elements a paragraph may legally contain.
//
// **The real answer is a block-level editor node**, and it is deliberately not
// taken here: `PageDoc` is a versioned AST (ADR-038) and every stored document
// carries `macro` as an inline atom, so a second node type is a schema decision
// with a migration behind it — Mitchell's call, recorded in the M14 gate rather
// than made in a component. If that lands, this goes back to the DS `Table`.
export function CostsTableBlock({ payload }: { payload: CostsTablePayload }) {
  return (
    <span className="block rounded-md border border-hairline bg-surface p-3">
      <span role="table" className="flex flex-col gap-1">
        <span role="row" className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1 text-xs font-medium text-slate">
          <span role="columnheader">Item</span>
          <span role="columnheader">Amount</span>
        </span>
        {payload.rows.map((row, i) => (
          <span role="row" key={i} className="flex items-baseline justify-between gap-3 text-sm text-ink">
            <span role="cell">{row.label}</span>
            <span role="cell" className="font-mono">{row.amount}</span>
          </span>
        ))}
        <span role="row" className="flex items-baseline justify-between gap-3 border-t border-hairline pt-1 text-sm font-medium text-ink">
          <span role="rowheader">Total</span>
          <span role="cell" className="font-mono">{payload.total}</span>
        </span>
      </span>
    </span>
  );
}
