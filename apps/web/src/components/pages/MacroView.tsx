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
function Segs({ segs, accents }: { segs: readonly Seg[]; accents: CityAccents }) {
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
              "mx-0.5 rounded-sm border-b-2 border-brand bg-brand-tint px-1",
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
    case "rows":
      return (
        <span role="list" className="flex flex-col gap-0.5">
          {rendered.rows.map((segs, i) => (
            <span role="listitem" key={i} className="flex flex-wrap items-baseline gap-x-2"><Segs segs={segs} accents={accents} /></span>
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
