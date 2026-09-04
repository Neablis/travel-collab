"use client";
import type { TripDetail, PageContext, TripGlobals, UserPreferences } from "@tc/contracts";
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

export function MacroView({ detail, context, user = null, globals = null, name, params, onBindDay }: {
  detail: TripDetail; context: PageContext; user?: UserPreferences | null;
  globals?: TripGlobals | null; name: string;
  params: Record<string, unknown>; onBindDay?: () => void;
}) {
  const def = getMacro(name);
  const outcome = renderMacro({ trip: detail, page: context, user, globals }, name, params);
  if (outcome.status === "unknown") return <EmptyChip tone="error" label={`unknown macro: ${name}`} />;
  if (outcome.status === "bad-params") return <EmptyChip tone="error" label={`bad params: ${name}`} />;
  // The chip is a control only when something can act on it. `PageScreen`
  // stopped passing `onBindDay` when the page-level day binding went (SPEC §18)
  // — and an `action` chip renders through the Button primitive, so without a
  // handler it was a keyboard-focusable button that did nothing. Both reviewers
  // caught it on #129. Link 4's chrome row passes a handler again, and this
  // goes back to being actionable with no further edit.
  if (outcome.status === "unbound") {
    // **One branch per `UnboundNeeds` member, and the `never` is what keeps it
    // that way.** This used to test for `"trip"` and treat everything else as a
    // day, so widening the union would have rendered "no day set" for a missing
    // person or date range — a widget confidently naming the wrong missing
    // thing, which is worse than a generic answer. Copilot found the union's
    // narrowness; this is the other half of that fix.
    //
    // They read differently to a person, which is why they are separate at all:
    // a day is something they can pick from the chrome row, a trip is not — a
    // notebook created outside a trip has none, and that is the ADR-037 open
    // question 2 case `WidgetContext.trip?` exists for.
    switch (outcome.needs) {
      case "trip":
        return <EmptyChip tone="muted" label="needs a trip" />;
      case "day":
        return onBindDay
          ? <EmptyChip tone="action" label="select a day" onClick={onBindDay} />
          : <EmptyChip tone="muted" label="no day set" />;
      case "days":
        return <EmptyChip tone="muted" label="no days set" />;
      // Unreachable today and rendered anyway: no widget declares a `person`
      // input, because nothing links an activity to a person yet (§18 declares
      // the type; M13/M19 bring the field). A branch that throws or falls
      // through here is how the first person widget ships broken.
      case "person":
        return <EmptyChip tone="muted" label="no one set" />;
      default: {
        const exhaustive: never = outcome.needs;
        return exhaustive;
      }
    }
  }
  if (outcome.status === "empty") return <EmptyChip tone="muted" label={def?.emptyText ?? "—"} />;

  const { rendered } = outcome;
  switch (rendered.kind) {
    case "inline":
      return <Segs segs={rendered.segs} />;
    case "block":
      return <BlockView block={rendered.block} />;
    // A repeat's rows.
    //
    // **`span`, not `div`, and that is not a style preference.** A widget node
    // is inline — it sits inside a paragraph so a chip can read as a word in a
    // sentence — and `<div>` inside `<p>` is not merely unusual markup: the HTML
    // parser closes the paragraph at it, so the server's DOM and the client's
    // disagree. React says so outright, measured on the first repeater to reach
    // this branch: *"In HTML, <div> cannot be a descendant of <p>. This will
    // cause a hydration error."* `display: block` on a span gets the same layout
    // with none of that.
    //
    // The gap is here rather than in the resolver for the same reason the chips
    // are: `resolve` answers what a line means and `render` answers what it
    // looks like (ADR-037 decision 1). Separator segments baked into the payload
    // would put a spacing decision inside the trip data.
    // `role="list"` / `role="listitem"` on the spans, because a repeater IS a
    // list and a reader with a screen reader should hear "list, 3 items" rather
    // than one run-on line. The roles cannot come from `<ul>`/`<li>` for the
    // reason above — those are block elements inside a paragraph — and ARIA
    // roles carry the semantics without the tags.
    //
    // It is also the only non-presentational handle a test has on a ROW. The
    // assertions here checked that "Day 1" and "Day 2" appeared somewhere, which
    // a renderer that put both leads in one row still satisfies (CodeRabbit,
    // PR 139); asserting the container's classes instead is what the
    // test-quality wall forbids. The roles make row cardinality a real query.
    case "rows":
      return (
        <span role="list" className="flex flex-col gap-0.5">
          {rendered.rows.map((segs, i) => (
            <span role="listitem" key={i} className="flex flex-wrap items-baseline gap-x-2"><Segs segs={segs} /></span>
          ))}
        </span>
      );
    default: {
      // The same enforcement `BlockView` carries, for the same measured reason:
      // `strict` does NOT imply `noImplicitReturns` and this repo sets only
      // `strict`, so a fourth `Rendered` kind would compile and make this
      // function return `undefined` — React renders nothing, silently. I wrote
      // that comment on BlockView on #134 and did not apply it here; both
      // reviewers caught it on PR 139.
      const exhaustive: never = rendered;
      return exhaustive;
    }
  }
}
