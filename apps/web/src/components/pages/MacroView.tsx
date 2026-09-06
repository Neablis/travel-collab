"use client";
import { useMemo } from "react";
import type { TripDetail, PageContext, TripGlobals, UserPreferences } from "@tc/contracts";
import { renderMacro, getMacro, type Seg } from "@tc/pages";
import { cn } from "@/lib/cn";
import { cityAccents, CITY_INK, type CityAccents } from "./cityAccents";
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
/**
 * `plain` — a value inside a TABLE, drawn as text rather than as a chip.
 *
 * Mitchell, 2026-09-06, twice on two different widgets: *"text in a widget
 * table shouldn't be color coded like inline text, also add row strips to show
 * it's a table"* and *"all tables should have row stripping, and not color.code
 * the text like other inline text"*.
 *
 * The chip treatment below exists to answer a question a table does not ask.
 * Inline, a resolved value sits in a sentence the author wrote, and the tint
 * says which words came from the trip rather than from them. Every cell of a
 * repeat table came from the trip — the whole widget did — so the tint marks
 * nothing, and at 411px a column of tinted pills reads as a column of buttons.
 *
 * `data-widget-value` stays on either path: it is the non-presentational
 * handle a test asks "how many values came from a widget" with, and that
 * question is still the same question.
 */
function Segs({ segs, accents, plain = false }: { segs: readonly Seg[]; accents: CityAccents; plain?: boolean }) {
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i} className="text-ink">{seg.text}</span>
        ) : (
          // A chip is a resolved value reading as a word in a sentence (§7).
          // `seg.text` is a text node either way — `Seg` has nowhere to put an
          // element, an attribute or a URL, which is ADR-037 decision 3a.
          //
          // **Brand tint under a brand rule, not a hairline underline.** The
          // hairline said "this word is annotated"; it did not say the word
          // came from the trip rather than from the author, and in Reading
          // there is no chrome row left to say it either. Mitchell, on the
          // preview: *"A value coming from a widget in readonly mode should be
          // clearly coming from a widget — see the green text."* dc.html:2368
          // is the treatment: `background: var(--color-brand-tint);
          // border-bottom: 1.5px solid var(--color-brand)`. `border-b-2` is the
          // scale's nearest rule width — 1.5px is not on it, and an arbitrary
          // value is what the color wall exists to refuse.
          //
          // `data-widget-value` is the non-presentational handle: "how many
          // values on this page came from a widget" is a question a test can
          // ask without asserting a class, which the test-quality wall forbids
          // outside `components/ui/**`.
          //
          // **`mx-0.5 px-1`, and the margin is the half that was missing.**
          // Mitchell, on the PR 141 preview: *"These inline elements should
          // have a natural space at the start and end, otherwise ill need to go
          // in and put a unnatural space."* A widget node is an inline atom, so
          // the tinted background butted straight against the character beside
          // it — the author's own typed space landed OUTSIDE the tint and did
          // nothing to separate them, which is what made a second, unnatural one
          // look necessary.
          //
          // Margin rather than more padding, because the two say different
          // things: padding widens the tinted pill around the value (so `$45.00`
          // gets room inside its own highlight), while margin holds the pill off
          // the prose. The complaint was about the second, and padding alone
          // would have grown the highlight without moving it away from anything.
          // `0.5`/`1` are scale steps; an arbitrary value is what the colour
          // wall refuses.
          <span
            key={i}
            data-widget-value={seg.name}
            className={cn(
              plain ? null : "mx-0.5 rounded-sm border-b-2 border-brand bg-brand-tint px-1",
              // A city is the one value with a colour of its own, and it is
              // the trip's colour, not the widget's — see `cityAccents`.
              seg.name === "city" ? CITY_INK[accents.ofCity(seg.text)] : "text-ink",
            )}
            title={seg.name}
          >
            {seg.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Renders a macro widget for the supplied trip and page context.
 *
 * @param name - The macro name to render
 * @param params - Parameters passed to the macro
 * @param onBindDay - Optional handler for rebinding a widget whose selected day was removed
 * @returns The rendered macro widget or an appropriate status chip
 */
export function MacroView({ detail, context, user = null, globals = null, name, params, onBindDay }: {
  detail: TripDetail; context: PageContext; user?: UserPreferences | null;
  globals?: TripGlobals | null; name: string;
  params: Record<string, unknown>; onBindDay?: () => void;
}) {
  const def = getMacro(name);
  // One derivation per render of one widget, memoised on the trip: `cityAccents`
  // walks every day and probes five buckets, and a page can hold a dozen
  // widgets. It is cheap, but it is not free and the answer cannot change
  // between two widgets on the same trip — that invariance is the point.
  const accents = useMemo(() => cityAccents(detail), [detail]);
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
      // **The only way to reach this now is a day that was DELETED.** Under
      // ADR-039 decision 2 an absent day filter means every day — the widest
      // true answer — so a widget with nothing bound is finished, not waiting.
      // What is left is a `DayRef` pointing at a day the trip no longer has,
      // and silently widening that to the whole trip would turn a page about
      // day 100 into a page about everything the moment day 100 was removed.
      //
      // So the label names what actually happened rather than saying "no day
      // set", which would invite the reader to set one when the real news is
      // that theirs is gone. The chrome row's day select reads "All days"
      // beside it, which is what clearing this would give.
      case "day":
        return onBindDay
          ? <EmptyChip tone="action" label="that day was removed" onClick={onBindDay} />
          : <EmptyChip tone="muted" label="that day was removed" />;
      case "days":
        return <EmptyChip tone="muted" label="no days set" />;
      // **Reachable now, and it says the truth about why.** ADR-039 decision 7
      // declares `person` as a filter dimension and states plainly that it
      // cannot resolve: `TripMember` is `{ userId, role }` with no display
      // name, and no stop carries a person at all. So a widget filtered by one
      // answers ADR-037 decision 7's "needs a field" state.
      //
      // "no one set" was the old label and it would now be a lie in the one way
      // that matters: it invites a reader to set somebody, and there is no
      // control to do it with and no field for it to write to. Naming the
      // missing FIELD says whose problem this is — ours, until M13
      // `add-stop-who` / M19 link 3 lands.
      case "person":
        return <EmptyChip tone="muted" label="needs a person field" />;
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
      return <Segs segs={rendered.segs} accents={accents} />;
    case "block":
      return <BlockView block={rendered.block} accents={accents} />;
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
    // A repeat is a TABLE: a label column and a value column, in a bordered
    // card, with the total row set apart. Mitchell, 2026-09-06: *"These were
    // always meant to be tables with columns, and styled … just build it, no
    // need for a ADR."*
    //
    // **`display: table` on spans, not `<table>`.** The reason is the one two
    // paragraphs up: a widget node is inline and lives inside a `<p>`, so a
    // `<table>` would be closed out of the paragraph by the parser exactly as a
    // `<div>` is, and hydration would disagree with the server. The CSS display
    // types give real column alignment — which is the whole point of a table
    // here — with no block element anywhere. `.tc-widget-table` and its two
    // children carry them (globals.css).
    //
    // The ARIA roles do the same job they did as a list: the tags cannot carry
    // the semantics, so the roles do. `role="rowheader"` on the lead is what
    // says which cell names the row.
    // And NO `block` utility on the container. Tailwind v4 orders `utilities`
    // after `components`, and `.tc-widget-table` lives in `@layer components`,
    // so a `block` class beat its `display: table` outright: the rows then
    // formed their own shrink-to-fit anonymous table inside a full-width card
    // — same roles, same text, and the value column floating in the middle of
    // the card instead of at its right edge. Both review bots caught it on PR
    // 149; the geometry walk in `m14-notebook-widgets.spec.ts` is what would
    // have.
    case "rows": {
      // How many columns the table has: the widest row's, so a row that leaves
      // one empty still leaves it open. A resolver emits the same number of
      // cells on every data row (see `RepeatRow.cells`), so this is normally
      // just "that number" — the `max` is what keeps a header row, which has
      // none, from deciding the table's width.
      const columns = rendered.rows.reduce((widest, row) => Math.max(widest, row.cells.length), 0);
      return (
        <span
          role="table"
          className="tc-widget-table my-1 overflow-hidden rounded-md border border-hairline bg-surface"
          // eslint-disable-next-line no-restricted-syntax -- the column count is data, not design: it comes from the widget's own rows and no token can name it
          style={{ gridTemplateColumns: `minmax(0, 1fr)${" auto".repeat(columns)}` }}
        >
          {rendered.rows.map((row, i) => (
            <span
              role="row"
              key={i}
              className={cn(
                // Zebra striping rather than a hairline between every row:
                // *"add row strips to show it's a table"*. The stripe lives in
                // globals.css as an `:nth-child(even)` rule, because the row
                // does not know its own index in CSS terms and the component
                // should not have to hand it one. A hairline as well would be
                // two separators doing one job, and at this row height it read
                // as ruled paper.
                "tc-widget-row",
                // The total keeps its own tint and wins the cascade over the
                // stripe outright: `bg-moss` is a utility, the stripe is a
                // component-layer rule, and Tailwind v4 orders utilities last.
                // (That ordering is also what broke this widget's layout on
                // 2026-09-06, when a `block` utility on the container beat the
                // display type; same rule, working in our favour this time.)
                row.kind === "total" && "bg-moss font-semibold text-ink",
              )}
            >
              <span role="rowheader" className="tc-widget-cell px-3 py-2 text-left">
                <Segs segs={row.lead} accents={accents} plain />
              </span>
              {/* One cell per column, EMPTY ONES INCLUDED. Mitchell,
                  2026-09-06, on a `day.rows` whose date, cities and cost shared
                  one cell: *"The date and the city and the text shouldnt all be
                  rolled into each other. Introduce real columns"*. Skipping a
                  row's empty cells would shift everything after it one column
                  left and undo exactly that.

                  A header row is the exception and has no cells at all: it
                  names a group and has no value of its own, so a second cell
                  would read as a missing number. Its lone rowheader is what
                  `.tc-widget-row > .tc-widget-cell:only-child` widens to the
                  full row — under the `display: table` this started as there
                  was no way to widen it at all, and a long group label was
                  penned into the label column.

                  Last column right, the rest left: figures line up on their own
                  edge, and a date or a city reads from where the column starts
                  rather than drifting with its own width. */}
              {row.cells.map((cell, c) => (
                <span
                  role="cell"
                  key={c}
                  className={cn("tc-widget-cell px-3 py-2", c === columns - 1 ? "text-right" : "text-left")}
                >
                  <Segs segs={cell} accents={accents} plain />
                </span>
              ))}
            </span>
          ))}
        </span>
      );
    }
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
