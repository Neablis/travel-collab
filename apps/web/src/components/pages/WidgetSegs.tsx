import type { Seg } from "@tc/pages";
import { cn } from "@/lib/cn";
import { CITY_INK, type CityAccents } from "./cityAccents";

// A widget's resolved segments, drawn: `MacroView`'s inline and table values,
// and the landing's notebook page (M42 part 9), which is handed segments the
// snapshot resolved rather than a trip to resolve them against.

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
export function Segs({ segs, accents, plain = false }: { segs: readonly Seg[]; accents: CityAccents; plain?: boolean }) {
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i} className="text-ink">{seg.text}</span>
        ) : seg.kind === "ghost" ? (
          // The SHAPE of a value that is not bound yet (framework spec, "The
          // ghost"): mono, hatched, dashed underline, warning ink — an
          // invitation, never danger and never an alert icon. `.tc-widget-ghost`
          // carries the hatch and the rule (globals.css).
          //
          // `role="img"` so the glyph is presentational and the NAME is what is
          // read: `$XXX` aloud says nothing, "cost — not set up" says what to do.
          <span
            key={i}
            role="img"
            aria-label={`${seg.label} — not set up`}
            data-widget-ghost={seg.valueKind}
            className="tc-widget-ghost mx-0.5 px-1 font-mono text-warning-ink"
          >
            {seg.text}
          </span>
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
          // outside `components/ui/**`. The segment name goes there and
          // nowhere visible: as the `title` it put a tooltip reading "value"
          // on every widget value (Mitchell, PR #221 preview), and the
          // no-raw-syntax guard now fails on that.
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
          >
            {seg.text}
          </span>
        ),
      )}
    </>
  );
}
