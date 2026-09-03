"use client";
import type { TripDetail, PageContext, UserPreferences } from "@tc/contracts";
import { renderMacro, getMacro, type Seg } from "@tc/pages";
import { EmptyChip } from "./EmptyChip";
import { BlockView } from "./BlockView";

// Renders one widget instance. **It no longer knows any widget's name.**
//
// It used to end in `switch (name)` mapping three widget names to three block
// components, with `default:` rendering `no renderer: <name>` — a
// hand-maintained duplicate of the registry, living in `apps/web`, which meant a
// widget could not be added inside `packages/pages` without editing this file
// (ADR-037 decision 1). What replaced it: the registry hands back `Rendered`,
// this walks it, and `BlockView` picks a component by payload SHAPE.
//
// The C-era swap seam is unchanged and now stated by the types rather than by a
// comment: block components consume resolver payloads, never markup.
function Segs({ segs }: { segs: readonly Seg[] }) {
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i} className="text-ink">{seg.text}</span>
        ) : (
          // A chip is a resolved value reading as a word in a sentence (§7).
          // `seg.text` is a text node either way — `Seg` has nowhere to put an
          // element, an attribute or a URL, which is ADR-037 decision 3a.
          <span key={i} className="text-ink underline decoration-hairline underline-offset-2" title={seg.name}>
            {seg.text}
          </span>
        ),
      )}
    </>
  );
}

export function MacroView({ detail, context, user = null, name, params, onBindDay }: {
  detail: TripDetail; context: PageContext; user?: UserPreferences | null; name: string;
  params: Record<string, unknown>; onBindDay?: () => void;
}) {
  const def = getMacro(name);
  const outcome = renderMacro({ trip: detail, page: context, user }, name, params);
  if (outcome.status === "unknown") return <EmptyChip tone="error" label={`unknown macro: ${name}`} />;
  if (outcome.status === "bad-params") return <EmptyChip tone="error" label={`bad params: ${name}`} />;
  // The chip is a control only when something can act on it. `PageScreen`
  // stopped passing `onBindDay` when the page-level day binding went (SPEC §18)
  // — and an `action` chip renders through the Button primitive, so without a
  // handler it was a keyboard-focusable button that did nothing. Both reviewers
  // caught it on #129. Link 4's chrome row passes a handler again, and this
  // goes back to being actionable with no further edit.
  if (outcome.status === "unbound") {
    return onBindDay
      ? <EmptyChip tone="action" label="select a day" onClick={onBindDay} />
      : <EmptyChip tone="muted" label="no day set" />;
  }
  if (outcome.status === "empty") return <EmptyChip tone="muted" label={def?.emptyText ?? "—"} />;

  const { rendered } = outcome;
  switch (rendered.kind) {
    case "inline":
      return <Segs segs={rendered.segs} />;
    case "block":
      return <BlockView block={rendered.block} />;
    // A repeat's rows. Nothing emits one until M14 link 6 builds repeaters —
    // the shape exists here for the same reason `PageDoc` understands a `repeat`
    // node before the editor does (ADR-038): the renderer has to know a shape
    // before the document can contain it.
    case "rows":
      return (
        <>
          {rendered.rows.map((segs, i) => (
            <div key={i}><Segs segs={segs} /></div>
          ))}
        </>
      );
  }
}
