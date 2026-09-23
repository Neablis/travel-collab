import type { ItineraryDayPayload } from "@tc/pages";
import { dayMetaParts } from "./dayMeta";

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
    <span className="block overflow-hidden rounded-md border border-hairline bg-surface">
      {/* **The day's own header, restored with SPEC §24's timeline.** This card
          rendered a bare list of stops — no date, no city, no total — so a
          notebook page pointed at one day said less about that day than the
          board's own column header did. `dayMetaParts` is the same line the
          day-by-day table draws, so one day reads the same whichever widget is
          looking at it.

          **It is the design's caption strip, and it was drawn as inset text.**
          `NotebookBlock.dc.html:19` gives a block's caption a full-bleed band —
          `--color-paper` ground, a bottom hairline, `8px 13px` — not a line of
          text with a stub rule under it. The content stays as it is: the strip
          here carries the day's meta line, and the design's mono micro-caps are
          for a LABEL ("A day's stops"), which would mangle a date. */}
      <span className="block border-b border-hairline bg-paper px-3 py-2 text-xs text-slate">
        {`Day ${payload.ordinal} · ${dayMetaParts(payload).join(" · ")}`}
      </span>
      <span role="list" className="block">
        {payload.activities.map((activity, i) => (
          <span
            role="listitem"
            key={i}
            className="flex items-baseline justify-between gap-3 border-b border-hairline px-3 py-2 last:border-b-0"
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
