import type { ItineraryDayPayload } from "@tc/pages";

// Read-only block: renders a single day's activity list from the resolver
// payload only — no markup ever crosses the resolver boundary (C-era swap seam).
//
// **Spans with ARIA roles, not `<div>`/`<ul>`/`<li>`.** A widget node is an
// INLINE atom (`MacroNodeExtension`), so this renders inside a paragraph, and
// `<div>` inside `<p>` is not merely unusual markup: the HTML parser closes the
// paragraph at it, so the server's DOM and the client's disagree. That was
// measured once already on the repeater's rows — React said so outright, *"In
// HTML, <div> cannot be a descendant of <p>. This will cause a hydration
// error."* — and fixed there while all three block widgets kept doing it.
// Copilot found the rest on PR 139.
//
// The roles carry the semantics the tags would have: a screen reader still
// hears a list of N items. `display: block` on a span gets the same layout with
// none of the parser's opinion.
//
// **The real answer is a block-level editor node**, and it is deliberately not
// taken here: `PageDoc` is a versioned AST (ADR-038) and every stored document
// carries `macro` as an inline atom, so a second node type is a schema decision
// with a migration behind it — Mitchell's call, recorded in the M14 gate rather
// than made in a component.
export function ItineraryDayBlock({ payload }: { payload: ItineraryDayPayload }) {
  return (
    <span className="block rounded-md border border-hairline bg-surface p-3">
      <span role="list" className="flex flex-col gap-2">
        {payload.activities.map((activity, i) => (
          <span
            role="listitem"
            key={i}
            className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 last:border-b-0 last:pb-0"
          >
            <span className="flex flex-col">
              <span className="text-base text-ink">{activity.title}</span>
              {activity.timeWindow && <span className="text-xs text-slate">{activity.timeWindow}</span>}
            </span>
            {activity.cost && <span className="text-sm text-slate">{activity.cost}</span>}
          </span>
        ))}
      </span>
    </span>
  );
}
